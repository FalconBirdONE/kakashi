import { randomBytes } from "node:crypto";
import request from "supertest";
import { describe, expect, test } from "vitest";
import { decodePaymentRequiredHeader, decodePaymentSignatureHeader, encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { PrivateKey, inspectHederaTransaction } from "@x402/hedera";
import { mintPermit, type PermitFields } from "@tollbooth/contracts";
import { createApp } from "../src/app.js";
import { loadSignerConfig } from "../src/config.js";
import { createSigner, hederaPaymentBuilder, type PaymentBuilder } from "../src/sign.js";
import { openPermitStore } from "../src/store.js";

const SECRET = randomBytes(32).toString("hex");
const AGENT = "0.0.5005";
const FEE_PAYER = "0.0.9185802";
const NOW = new Date("2026-11-06T10:00:00.000Z");

const requirement: PaymentRequirements = {
  scheme: "exact", network: "hedera:testnet", asset: "0.0.0", amount: "10000",
  payTo: "0.0.101", maxTimeoutSeconds: 60, extra: { feePayer: FEE_PAYER },
};
const reqB64 = (r: PaymentRequirements = requirement) =>
  encodePaymentRequiredHeader({ x402Version: 2, resource: { url: "http://127.0.0.1:4200/m/quickcast/forecast" }, accepts: [r] });

let seq = 0;
const permit = (over: Partial<PermitFields> = {}, secret = SECRET) =>
  mintPermit({
    permitId: `pmt_${++seq}`, purchaseId: `pur_${seq}`, mandateId: "mdt_1", mandateVersion: 1,
    network: "hedera:testnet", assetId: "0.0.0", amountAtomic: "10000", payTo: "0.0.101", feePayer: FEE_PAYER,
    quoteHash: "q".repeat(64), issuedAt: new Date(NOW.getTime() - 1000).toISOString(),
    expiresAt: new Date(NOW.getTime() + 59_000).toISOString(), ...over,
  }, secret);

// Real x402 client scheme with a throwaway key. Building and signing is offline; nothing is submitted.
const offlineBuild = hederaPaymentBuilder(AGENT, PrivateKey.generateECDSA(), "hedera:testnet");

function setup(o: { maxPerTx?: bigint; maxTotal?: bigint; build?: PaymentBuilder } = {}) {
  const store = openPermitStore(":memory:");
  const sign = createSigner({
    permitSecret: SECRET, agentAccountId: AGENT, network: "hedera:testnet",
    maxPerTx: o.maxPerTx ?? 100_000n, maxTotal: o.maxTotal ?? 200_000n,
    store, build: o.build ?? offlineBuild, now: () => NOW,
  });
  return { sign, store };
}

describe("valid permit", () => {
  test("returns a payment header whose signed bytes carry the returned tx id", async () => {
    const { sign, store } = setup();
    const r = await sign(permit(), reqB64());
    if (!r.ok) throw new Error(r.reason);
    expect(r.hederaTxId).toMatch(/^0\.0\.9185802@\d+\.\d+$/);
    const payload = decodePaymentSignatureHeader(r.paymentHeader);
    const tx = inspectHederaTransaction(String(payload.payload.transaction));
    expect(tx.transactionId).toBe(r.hederaTxId);
    expect(tx.hbarTransfers).toEqual(expect.arrayContaining([{ accountId: AGENT, amount: "-10000" }, { accountId: "0.0.101", amount: "10000" }]));
    expect(store.totalCommitted()).toBe(10_000n);
  });
});

describe("refusals (SPEC R2)", () => {
  test("wrong MAC", async () => {
    const { sign } = setup();
    expect(await sign(permit({}, randomBytes(32).toString("hex")), reqB64())).toMatchObject({ ok: false, reason: "BAD_MAC" });
    const tampered = { ...permit(), amountAtomic: "9999" };
    expect(await sign(tampered, reqB64())).toMatchObject({ ok: false, reason: "BAD_MAC" });
  });

  test("expired", async () => {
    const { sign } = setup();
    const p = permit({ issuedAt: "2026-11-06T09:00:00.000Z", expiresAt: "2026-11-06T09:01:00.000Z" });
    expect(await sign(p, reqB64())).toMatchObject({ ok: false, reason: "EXPIRED" });
  });

  test("reused permit", async () => {
    const { sign } = setup();
    const p = permit();
    expect((await sign(p, reqB64())).ok).toBe(true);
    expect(await sign(p, reqB64())).toMatchObject({ ok: false, reason: "PERMIT_REUSED" });
  });

  test.each([
    ["amount", { amount: "20000" }, "AMOUNT_MISMATCH"],
    ["payTo", { payTo: "0.0.666" }, "PAYTO_MISMATCH"],
    ["asset", { asset: "0.0.429274" }, "ASSET_MISMATCH"],
    ["network", { network: "hedera:mainnet" }, "NETWORK_MISMATCH"],
    ["feePayer", { extra: { feePayer: "0.0.7162784" } }, "FEEPAYER_MISMATCH"],
  ] as const)("mismatched %s", async (_name, change, reason) => {
    const { sign, store } = setup();
    expect(await sign(permit(), reqB64({ ...requirement, ...change } as PaymentRequirements))).toMatchObject({ ok: false, reason });
    expect(store.totalCommitted()).toBe(0n);
  });

  test("garbage requirements header", async () => {
    const { sign } = setup();
    expect(await sign(permit(), "not-base64-json")).toMatchObject({ ok: false, reason: "BAD_REQUIREMENTS" });
  });

  test("a refused permit is burned and cannot be retried", async () => {
    const { sign } = setup();
    const p = permit();
    expect(await sign(p, reqB64({ ...requirement, payTo: "0.0.666" }))).toMatchObject({ reason: "PAYTO_MISMATCH" });
    expect(await sign(p, reqB64())).toMatchObject({ ok: false, reason: "PERMIT_REUSED" });
  });
});

describe("ceilings (SPEC R3)", () => {
  test("per-transaction ceiling", async () => {
    const { sign } = setup({ maxPerTx: 9_999n });
    expect(await sign(permit(), reqB64())).toMatchObject({ ok: false, reason: "OVER_PER_TX_CEILING" });
  });

  test("running total ceiling", async () => {
    const { sign, store } = setup({ maxTotal: 15_000n });
    expect((await sign(permit(), reqB64())).ok).toBe(true);
    expect(await sign(permit(), reqB64())).toMatchObject({ ok: false, reason: "OVER_TOTAL_CEILING" });
    expect(store.totalCommitted()).toBe(10_000n);
  });

  test("concurrent permits never exceed the total", async () => {
    const { sign, store } = setup({ maxTotal: 30_000n });
    const results = await Promise.all(Array.from({ length: 10 }, () => sign(permit(), reqB64())));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(store.totalCommitted()).toBe(30_000n);
  });

  test("a signing failure does not count toward the total", async () => {
    const { sign, store } = setup({ build: async () => { throw new Error("boom"); } });
    expect(await sign(permit(), reqB64())).toMatchObject({ ok: false, reason: "SIGNING_FAILED" });
    expect(store.totalCommitted()).toBe(0n);
  });

  test("signed bytes that disagree with the permit are refused", async () => {
    const wrongBuild = hederaPaymentBuilder("0.0.7777", PrivateKey.generateECDSA(), "hedera:testnet");
    const { sign, store } = setup({ build: wrongBuild });
    expect(await sign(permit(), reqB64())).toMatchObject({ ok: false, reason: "SIGNED_TX_MISMATCH" });
    expect(store.totalCommitted()).toBe(0n);
  });
});

describe("HTTP surface", () => {
  const app = () => createApp(setup().sign, () => {});

  test("POST /sign returns {paymentHeader, hederaTxId}", async () => {
    const res = await request(app()).post("/sign").send({ permit: permit(), requirementsB64: reqB64() });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["hederaTxId", "paymentHeader"]);
  });

  test("refusal is 403 with a reason and no key material", async () => {
    const res = await request(app()).post("/sign").send({ permit: permit({}, randomBytes(32).toString("hex")), requirementsB64: reqB64() });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "SIGNER_REFUSED", reason: "BAD_MAC" });
  });

  test("bodies over 32 KB, malformed bodies and other routes are rejected", async () => {
    const big = await request(app()).post("/sign").send({ permit: permit(), requirementsB64: "a".repeat(40_000) });
    expect(big.status).toBe(413);
    expect((await request(app()).post("/sign").send({ permit: { permitId: "x" } })).status).toBe(400);
    expect((await request(app()).get("/sign")).status).toBe(404);
    expect((await request(app()).post("/other").send({})).status).toBe(404);
  });

  test("config refuses to bind anywhere but 127.0.0.1", () => {
    expect(() => loadSignerConfig({ SIGNER_HOST: "0.0.0.0" })).toThrow(/127\.0\.0\.1/);
  });
});

// Real payment: start the merchants service first, with the same ASSET_MODE, then run with REAL_HEDERA=1.
describe.skipIf(!process.env.REAL_HEDERA)("real Hedera payment", () => {
  test("a signed payment pays the merchants service", async () => {
    const secret = randomBytes(32).toString("hex");
    const c = loadSignerConfig({ ...process.env, PERMIT_SECRET: secret, SIGNER_MAX_PER_TX_ATOMIC: "100000", SIGNER_MAX_TOTAL_ATOMIC: "1000000" });
    const sign = createSigner({
      permitSecret: secret, agentAccountId: c.AGENT_ACCOUNT_ID, network: c.HEDERA_NETWORK,
      maxPerTx: 100_000n, maxTotal: 1_000_000n, store: openPermitStore(":memory:"),
      build: hederaPaymentBuilder(c.AGENT_ACCOUNT_ID, c.agentKey, c.HEDERA_NETWORK),
    });
    const url = `${process.env.MERCHANTS_URL ?? "http://127.0.0.1:4200"}/m/quickcast/forecast?lat=19.076&lon=72.878&nonce=${Date.now()}`;
    const quote = await fetch(url);
    expect(quote.status).toBe(402);
    const raw = quote.headers.get("PAYMENT-REQUIRED")!;
    const r = decodePaymentRequiredHeader(raw).accepts[0]!;
    const now = new Date();
    const p = mintPermit({
      permitId: `pmt_real_${Date.now()}`, purchaseId: "pur_real", mandateId: "mdt_real", mandateVersion: 1,
      network: r.network, assetId: r.asset, amountAtomic: r.amount, payTo: r.payTo, feePayer: String(r.extra.feePayer),
      quoteHash: "real", issuedAt: new Date(now.getTime() - 1000).toISOString(), expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    }, secret);
    const signed = await sign(p, raw);
    if (!signed.ok) throw new Error(signed.reason);
    const paid = await fetch(url, { headers: { "PAYMENT-SIGNATURE": signed.paymentHeader } });
    expect(paid.status).toBe(200);
    const settle = JSON.parse(Buffer.from(paid.headers.get("PAYMENT-RESPONSE")!, "base64").toString("utf8"));
    expect(settle.transaction).toBe(signed.hederaTxId);
    console.log(`REAL_HEDERA settled ${settle.transaction} https://hashscan.io/testnet/transaction/${settle.transaction}`);
  }, 60_000);
});
