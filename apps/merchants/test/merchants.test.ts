import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { describe, expect, test, vi } from "vitest";
import type { FacilitatorClient } from "@x402/core/server";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { MERCHANT_REGISTRY, requestHash } from "@kakashi/contracts";
import { createApp, toMirrorTxId } from "../src/app.js";
import type { MerchantsConfig } from "../src/config.js";
import { INJECTED_NOTE } from "../src/data.js";
import { openStore } from "../src/store.js";

const FEE_PAYER = "0.0.9185802";
const PAYER = "0.0.5005";
const NOW = new Date("2026-11-06T10:00:00.000Z");
const QUERY = { tokenId: "0.0.731861" };
const P = (id: string) => MERCHANT_REGISTRY.find((m) => m.id === id)!.path;

const baseConfig: MerchantsConfig = {
  network: "hedera:testnet",
  asset: "0.0.0",
  payTo: { quickcast: "0.0.101", hourlypro: "0.0.102", groundtruth: "0.0.103", gouger: "0.0.104" },
  swapPayTo: "0.0.2",
  facilitatorUrl: "http://facilitator.test",
  mirrorUrl: "http://mirror.test",
  tokenMirrorUrl: "http://mainnet-mirror.test",
  demoMode: true,
  fixtureMode: true,
  port: 0,
  dbPath: ":memory:",
};

function fakeFacilitator() {
  const calls = { verify: 0, settle: 0 };
  let n = 0;
  const client: FacilitatorClient = {
    async getSupported() {
      return { kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet", extra: { feePayer: FEE_PAYER } }], extensions: [], signers: {} };
    },
    async verify() {
      calls.verify++;
      return { isValid: true, payer: PAYER };
    },
    async settle(_p, r) {
      calls.settle++;
      return { success: true, transaction: `${FEE_PAYER}@1793981706.00000000${++n}`, network: r.network, payer: PAYER };
    },
  };
  return { client, calls };
}

async function setup(opts: { config?: Partial<MerchantsConfig>; fetch?: typeof fetch } = {}) {
  const facilitator = fakeFacilitator();
  const store = openStore(":memory:");
  const app = await createApp({
    config: { ...baseConfig, ...opts.config }, facilitator: facilitator.client, store,
    fetch: opts.fetch ?? (vi.fn(async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch),
    now: () => NOW, log: () => {},
  });
  return { app, store, calls: facilitator.calls };
}

/** Gets a 402 for path, then returns a PAYMENT-SIGNATURE header that accepts its first requirement. */
async function paymentHeader(app: Awaited<ReturnType<typeof setup>>["app"], path: string) {
  const res = await request(app).get(path).query(QUERY);
  expect(res.status).toBe(402);
  const pr = decodePaymentRequiredHeader(res.headers["payment-required"]);
  return encodePaymentSignatureHeader({ x402Version: 2, resource: pr.resource, accepted: pr.accepts[0]!, payload: { transaction: "dGVzdA==" } });
}

describe("402 quotes", () => {
  test.each(MERCHANT_REGISTRY.map((m) => [m.id, m] as const))("%s advertises its registry price and payTo", async (id, m) => {
    const { app } = await setup();
    const res = await request(app).get(m.path).query(QUERY);
    expect(res.status).toBe(402);
    const pr = decodePaymentRequiredHeader(res.headers["payment-required"]);
    expect(pr.x402Version).toBe(2);
    expect(pr.accepts).toEqual([
      {
        scheme: "exact", network: "hedera:testnet", asset: "0.0.0", amount: m.priceAtomic,
        payTo: baseConfig.payTo[id], maxTimeoutSeconds: 60, extra: { feePayer: FEE_PAYER },
      },
    ]);
  });

  test("catalog is free and hides env var names", async () => {
    const { app } = await setup();
    const res = await request(app).get("/catalog");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(JSON.stringify(res.body)).not.toContain("PAYTO");
    expect(res.body[0]).toMatchObject({ id: "quickcast", priceAtomic: "10000" });
  });

  test.each([[{}], [{ tokenId: "SAUCE" }], [{ tokenId: "0.0.x" }]])("bad query %j is rejected before any quote", async (q) => {
    const { app } = await setup();
    const res = await request(app).get(P("quickcast")).query(q);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid query: expected tokenId (0.0.N)");
  });
});

describe("paid requests", () => {
  test("verify, settle, then respond with PAYMENT-RESPONSE and the required metadata", async () => {
    const { app, calls } = await setup();
    const header = await paymentHeader(app, P("quickcast"));
    const res = await request(app).get(P("quickcast")).query(QUERY).set("PAYMENT-SIGNATURE", header);
    expect(res.status).toBe(200);
    expect(calls).toEqual({ verify: 1, settle: 1 });
    expect(decodePaymentResponseHeader(res.headers["payment-response"])).toMatchObject({ success: true, payer: PAYER });
    expect(res.body).toMatchObject({
      merchant: "quickcast", source: "fixture", tokenId: "0.0.731861", generatedAt: NOW.toISOString(),
      token: { symbol: "SAUCE", keys: { admin: true, supply: true, freeze: false } },
    });
  });

  test("idempotent replay returns the cached body without a new 402 or a second settlement", async () => {
    const { app, calls } = await setup();
    const header = await paymentHeader(app, P("hourlypro"));
    const first = await request(app).get(P("hourlypro")).query(QUERY).set("PAYMENT-SIGNATURE", header);
    const second = await request(app).get(P("hourlypro")).query(QUERY).set("PAYMENT-SIGNATURE", header);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(second.headers["payment-response"]).toBe(first.headers["payment-response"]);
    expect(calls.settle).toBe(1);
  });

  test("live mode reads only the mainnet mirror: token, balances above 1%, treasury transactions", async () => {
    const token = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/token.json"), "utf8"));
    const urls: string[] = [];
    const live = vi.fn(async (url: string | URL) => {
      const u = String(url); urls.push(u);
      if (u.includes("/balances")) return Response.json({ balances: [{ account: "0.0.1077627", balance: "500000000000000" }] });
      if (u.includes("/transactions")) return Response.json({ transactions: [] });
      return Response.json(token);
    });
    const { app } = await setup({ config: { fixtureMode: false }, fetch: live as unknown as typeof fetch });
    for (const id of ["quickcast", "groundtruth", "hourlypro"]) {
      const res = await request(app).get(P(id)).query(QUERY).set("PAYMENT-SIGNATURE", await paymentHeader(app, P(id)));
      expect(res.body).toMatchObject({ source: "hedera-mainnet-mirror", tokenId: "0.0.731861" });
    }
    const gt = BigInt(token.total_supply) / 100n;
    expect(new Set(urls)).toEqual(new Set([
      "http://mainnet-mirror.test/api/v1/tokens/0.0.731861",
      `http://mainnet-mirror.test/api/v1/tokens/0.0.731861/balances?account.balance=gt:${gt}&limit=100`,
      "http://mainnet-mirror.test/api/v1/transactions?account.id=0.0.1077627&limit=100&order=desc",
    ]));
    expect(urls.some((u) => u.startsWith(baseConfig.mirrorUrl))).toBe(false);
  });

  test("a token missing on mainnet gets the NOT_FOUND body", async () => {
    const missing = vi.fn(async () => new Response("{}", { status: 404 }));
    const { app } = await setup({ config: { fixtureMode: false }, fetch: missing as unknown as typeof fetch });
    const q = { tokenId: "0.0.1" };
    const head = await request(app).get(P("quickcast")).query(q);
    const pr = decodePaymentRequiredHeader(head.headers["payment-required"]);
    const sig = encodePaymentSignatureHeader({ x402Version: 2, resource: pr.resource, accepted: pr.accepts[0]!, payload: { transaction: "dGVzdA==" } });
    const res = await request(app).get(P("quickcast")).query(q).set("PAYMENT-SIGNATURE", sig);
    expect(res.body).toMatchObject({ source: "hedera-mainnet-mirror", tokenId: "0.0.1", token: null, flags: ["NOT_FOUND: no such token on Hedera mainnet"] });
  });

  test("a network failure falls back to fixtures that keep their real tokenId", async () => {
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const { app } = await setup({ config: { fixtureMode: false }, fetch: down as unknown as typeof fetch });
    const q = { tokenId: "0.0.456858" };
    const head = await request(app).get(P("groundtruth")).query(q);
    const pr = decodePaymentRequiredHeader(head.headers["payment-required"]);
    const sig = encodePaymentSignatureHeader({ x402Version: 2, resource: pr.resource, accepted: pr.accepts[0]!, payload: { transaction: "dGVzdA==" } });
    const res = await request(app).get(P("groundtruth")).query(q).set("PAYMENT-SIGNATURE", sig);
    expect(down).toHaveBeenCalled();
    expect(res.body).toMatchObject({ source: "fixture", tokenId: "0.0.731861" });
  });

  test.each(MERCHANT_REGISTRY.map((m) => [m.id] as const))("%s body matches the shared contract", async (id) => {
    const { app } = await setup();
    const res = await request(app).get(P(id)).query(QUERY).set("PAYMENT-SIGNATURE", await paymentHeader(app, P(id)));
    const b = res.body;
    expect(Object.keys(b).sort()).toEqual(["flags", "generatedAt", "merchant", "source", "tokenId",
      id === "groundtruth" ? "holders" : id === "hourlypro" ? "treasury" : "token"].sort());
    expect(b).toMatchObject({ merchant: id, source: "fixture", tokenId: "0.0.731861" });
    expect(b.flags.every((f: unknown) => typeof f === "string")).toBe(true);
    if (id === "groundtruth") {
      expect(b.holders).toMatchObject({ thresholdPct: 1, whaleCount: 9 });
      expect(Object.keys(b.holders).sort()).toEqual(["thresholdPct", "treasurySharePct", "whaleCount", "whaleSharePct", "whales"]);
      expect(typeof b.holders.whales[0].balance).toBe("string");
    } else if (id === "hourlypro") {
      expect(Object.keys(b.treasury).sort()).toEqual(["account", "mints", "outflowTotal", "outflows", "sampled"]);
      expect(b.treasury).toMatchObject({ account: "0.0.1077627", sampled: 100 });
    } else {
      expect(Object.keys(b.token).sort()).toEqual(["createdAt", "customFees", "decimals", "keys", "maxSupply", "memo", "name",
        "pauseStatus", "supplyType", "symbol", "totalSupply", "treasury"]);
      expect(Object.keys(b.token.keys).sort()).toEqual(["admin", "feeSchedule", "freeze", "kyc", "pause", "supply", "wipe"]);
      expect(b.token.customFees).toEqual({ fixed: 0, fractional: 0, royalty: 0 });
    }
  });
});

describe("recovery", () => {
  test("returns the cached body for the paying tx and requestHash, 404 otherwise", async () => {
    const { app } = await setup();
    const res = await request(app).get(P("groundtruth")).query(QUERY)
      .set("PAYMENT-SIGNATURE", await paymentHeader(app, P("groundtruth")));
    const tx = decodePaymentResponseHeader(res.headers["payment-response"]).transaction;
    const rh = requestHash("GET", P("groundtruth"), QUERY);
    const ok = await request(app).get("/recover").query({ tx, requestHash: rh, merchant: "groundtruth" });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(res.body);
    expect((await request(app).get("/recover").query({ tx, requestHash: "wrong" })).status).toBe(404);
    expect((await request(app).get("/recover").query({ tx, requestHash: rh, merchant: "quickcast" })).status).toBe(404);
  });

  test("regenerates from a mirror-node confirmation when the cache is missing", async () => {
    const tx = `${FEE_PAYER}@1793981706.678766160`;
    const mirror = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(`http://mirror.test/api/v1/transactions/${toMirrorTxId(tx)}`);
      return Response.json({
        transactions: [{ result: "SUCCESS", transfers: [{ account: PAYER, amount: -10000 }, { account: "0.0.101", amount: 10000 }, { account: FEE_PAYER, amount: -290413 }] }],
      });
    });
    const { app, store } = await setup({ fetch: mirror as unknown as typeof fetch });
    await request(app).get(P("quickcast")).query(QUERY); // the 402 records the query behind the requestHash
    const rh = requestHash("GET", P("quickcast"), QUERY);
    const res = await request(app).get("/recover").query({ tx, requestHash: rh });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ merchant: "quickcast", tokenId: "0.0.731861" });
    expect(store.byTx(tx)?.payer).toBe(PAYER);
  });

  test("refuses to regenerate when the mirror node shows a different credit", async () => {
    const mirror = vi.fn(async () => Response.json({ transactions: [{ result: "SUCCESS", transfers: [{ account: PAYER, amount: -1 }, { account: "0.0.101", amount: 1 }] }] }));
    const { app } = await setup({ fetch: mirror as unknown as typeof fetch });
    await request(app).get(P("quickcast")).query(QUERY);
    const res = await request(app).get("/recover").query({ tx: "0.0.1@1.2", requestHash: requestHash("GET", P("quickcast"), QUERY) });
    expect(res.status).toBe(404);
  });

  test("toMirrorTxId converts to the mirror form", () => {
    expect(toMirrorTxId("0.0.9185802@1793981706.678766160")).toBe("0.0.9185802-1793981706-678766160");
  });
});

describe("demo faults", () => {
  const setFault = (app: Awaited<ReturnType<typeof setup>>["app"], merchantId: string, fault: string) =>
    request(app).post("/admin/fault").send({ merchantId, fault });

  test("DROP_AFTER_SETTLE settles and stores, then drops the connection", async () => {
    const { app, store, calls } = await setup();
    await setFault(app, "quickcast", "DROP_AFTER_SETTLE").expect(200);
    const header = await paymentHeader(app, P("quickcast"));
    await expect(request(app).get(P("quickcast")).query(QUERY).set("PAYMENT-SIGNATURE", header)).rejects.toThrow();
    expect(calls.settle).toBe(1);
    const tx = `${FEE_PAYER}@1793981706.000000001`;
    expect(store.byTx(tx)?.merchantId).toBe("quickcast");
    const rec = await request(app).get("/recover").query({ tx, requestHash: requestHash("GET", P("quickcast"), QUERY) });
    expect(rec.status).toBe(200);
  });

  test("SWAP_PAYTO advertises the operator account", async () => {
    const { app } = await setup();
    await setFault(app, "quickcast", "SWAP_PAYTO").expect(200);
    const res = await request(app).get(P("quickcast")).query(QUERY);
    expect(decodePaymentRequiredHeader(res.headers["payment-required"]).accepts[0]!.payTo).toBe("0.0.2");
  });

  test("STALE_DATA makes generatedAt 2 days old", async () => {
    const { app } = await setup();
    await setFault(app, "hourlypro", "STALE_DATA").expect(200);
    const res = await request(app).get(P("hourlypro")).query(QUERY).set("PAYMENT-SIGNATURE", await paymentHeader(app, P("hourlypro")));
    expect(Date.parse(res.body.generatedAt)).toBe(NOW.getTime() - 2 * 86_400_000);
  });

  test("INJECT_TEXT adds the injected note", async () => {
    const { app } = await setup();
    await setFault(app, "quickcast", "INJECT_TEXT").expect(200);
    const res = await request(app).get(P("quickcast")).query(QUERY).set("PAYMENT-SIGNATURE", await paymentHeader(app, P("quickcast")));
    expect(res.body.note).toBe(INJECTED_NOTE);
  });

  test("NONE clears a fault, and the admin route is hidden without DEMO_MODE", async () => {
    const { app } = await setup();
    await setFault(app, "quickcast", "SWAP_PAYTO").expect(200);
    await setFault(app, "quickcast", "NONE").expect(200);
    const res = await request(app).get(P("quickcast")).query(QUERY);
    expect(decodePaymentRequiredHeader(res.headers["payment-required"]).accepts[0]!.payTo).toBe("0.0.101");
    const off = await setup({ config: { demoMode: false } });
    expect((await setFault(off.app, "quickcast", "INJECT_TEXT")).status).toBe(404);
  });
});

describe("log hygiene", () => {
  test("redact blanks header-sized tokens and caps length", async () => {
    const { redact } = await import("../src/app.js");
    const header = Buffer.from("x".repeat(200)).toString("base64");
    expect(redact(`facilitator said: bad payload ${header}`)).toBe("facilitator said: bad payload [redacted]");
    expect(redact("a ".repeat(400))).toHaveLength(300);
  });

  test("an internal error is logged without the payment header", async () => {
    const lines: string[] = [];
    const facilitator = fakeFacilitator();
    facilitator.client.verify = async () => { throw new Error("verify blew up"); };
    const app = await createApp({ config: baseConfig, facilitator: facilitator.client, store: openStore(":memory:"), now: () => NOW, log: (m) => lines.push(m) });
    const header = await paymentHeader(app, P("quickcast"));
    const res = await request(app).get(P("quickcast")).query(QUERY).set("PAYMENT-SIGNATURE", header);
    expect(res.status).toBe(502);
    expect(lines.join("\n")).not.toContain(header);
    expect(lines.join("\n")).toContain("verify blew up");
  });
});
