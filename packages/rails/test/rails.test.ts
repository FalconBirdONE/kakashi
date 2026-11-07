import { describe, expect, test, vi } from "vitest";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { canonicalJson, requestHash, sha256Hex, type Quote } from "@kakashi/contracts";
import { createRails, toMirrorTxId, validateDelivery } from "../src/index.js";

const NOW = new Date("2026-11-06T10:00:00.000Z");
const ENV = {
  ASSET_MODE: "hbar", MERCHANTS_URL: "http://127.0.0.1:4200", SIGNER_URL: "http://127.0.0.1:4100",
  MIRROR_NODE_URL: "http://mirror.test", FACILITATOR_URL: "https://x402.org/facilitator",
  AGENT_ACCOUNT_ID: "0.0.5005", MERCHANT_QUICKCAST_PAYTO: "0.0.101", MERCHANT_HOURLYPRO_PAYTO: "0.0.102",
  MERCHANT_GROUNDTRUTH_PAYTO: "0.0.103", MERCHANT_GOUGER_PAYTO: "0.0.104",
  HEDERA_OPERATOR_ID: "0.0.2", HEDERA_OPERATOR_KEY: "unused-in-tests", HCS_TOPIC_ID: "0.0.7777",
};
const QUERY = { tokenId: "0.0.731861" };
const REQ = { scheme: "exact", network: "hedera:testnet", asset: "0.0.0", amount: "10000", payTo: "0.0.101", maxTimeoutSeconds: 60, extra: { feePayer: "0.0.9185802" } };
const header402 = (accepts: unknown[] = [REQ]) =>
  encodePaymentRequiredHeader({ x402Version: 2, resource: { url: "x" }, accepts } as never);

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
function rails(handler: Handler, extra: Parameters<typeof createRails>[1] = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(new URL(String(input)), init ?? {}));
  const r = createRails(ENV as unknown as NodeJS.ProcessEnv, { fetch: fetchMock as unknown as typeof fetch, now: () => NOW, log: () => {}, ...extra });
  return { r, fetchMock };
}
const quoted = (h = header402()) => new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": h } });

describe("fetchQuote", () => {
  test("normalizes the 402 into quote fields with a quoteHash over everything but raw and timestamps", async () => {
    const { r, fetchMock } = rails(() => quoted());
    const res = await r.fetchQuote("quickcast", QUERY);
    if (!res.ok) throw new Error(res.error);
    const { rawRequirements, receivedAt, localExpiresAt, quoteHash, ...core } = res.quote;
    expect(core).toEqual({
      merchantId: "quickcast", method: "GET", origin: "http://127.0.0.1:4200", path: "/m/quickcast/keys",
      requestHash: requestHash("GET", "/m/quickcast/keys", QUERY), network: "hedera:testnet", assetId: "0.0.0",
      amountAtomic: "10000", payTo: "0.0.101", facilitatorUrl: "https://x402.org/facilitator", feePayer: "0.0.9185802", maxTimeoutSeconds: 60,
    });
    expect(quoteHash).toBe(sha256Hex(canonicalJson(core)));
    expect(rawRequirements).toBe(header402());
    expect(receivedAt).toBe(NOW.toISOString());
    expect(localExpiresAt).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:4200/m/quickcast/keys?tokenId=0.0.731861");
    expect(init?.redirect).toBe("manual");
  });

  test("localExpiresAt uses maxTimeoutSeconds when shorter than 60 s", async () => {
    const { r } = rails(() => quoted(header402([{ ...REQ, maxTimeoutSeconds: 20 }])));
    const res = await r.fetchQuote("quickcast", QUERY);
    expect(res.ok && res.quote.localExpiresAt).toBe(new Date(NOW.getTime() + 20_000).toISOString());
  });

  test("R5: unknown merchant makes no request at all", async () => {
    const { r, fetchMock } = rails(() => quoted());
    expect(await r.fetchQuote("https://evil.example/steal", QUERY)).toEqual({ ok: false, error: "UNKNOWN_MERCHANT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("R5: a redirect is not followed and no other host is contacted", async () => {
    const { r, fetchMock } = rails(() => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    expect(await r.fetchQuote("quickcast", QUERY)).toEqual({ ok: false, error: "QUOTE_NOT_402" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0]![0])).host).toBe("127.0.0.1:4200");
  });

  test("query values cannot change the path or host", async () => {
    const { r, fetchMock } = rails(() => quoted());
    await r.fetchQuote("quickcast", { tokenId: "0.0.1", x: "../../admin/fault?@evil.example" });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.host).toBe("127.0.0.1:4200");
    expect(url.pathname).toBe("/m/quickcast/keys");
  });

  test.each([
    ["non-402", () => new Response("{}", { status: 200 }), "QUOTE_NOT_402"],
    ["missing header", () => new Response(null, { status: 402 }), "BAD_REQUIREMENTS_HEADER"],
    ["garbage header", () => quoted("%%%"), "BAD_REQUIREMENTS_HEADER"],
    ["other asset only", () => quoted(header402([{ ...REQ, asset: "0.0.429274" }])), "BAD_REQUIREMENTS_HEADER"],
    ["bad payTo", () => quoted(header402([{ ...REQ, payTo: "0xabc" }])), "BAD_REQUIREMENTS_HEADER"],
    ["network error", () => { throw new TypeError("fetch failed"); }, "NETWORK"],
  ] as const)("%s", async (_n, handler, error) => {
    const { r } = rails(handler as Handler);
    expect(await r.fetchQuote("quickcast", QUERY)).toEqual({ ok: false, error });
  });
});

describe("signPayment", () => {
  const permit = { permitId: "pmt_1", purchaseId: "pur_1" } as never;
  test("maps signer responses", async () => {
    const ok = rails(() => Response.json({ paymentHeader: "abc", hederaTxId: "0.0.9185802@1.2" }));
    expect(await ok.r.signPayment(permit, "x")).toEqual({ ok: true, paymentHeader: "abc", hederaTxId: "0.0.9185802@1.2" });
    expect(String(ok.fetchMock.mock.calls[0]![0])).toBe("http://127.0.0.1:4100/sign");
    const refused = rails(() => Response.json({ error: "SIGNER_REFUSED", reason: "BAD_MAC" }, { status: 403 }));
    expect(await refused.r.signPayment(permit, "x")).toEqual({ ok: false, error: "SIGNER_REFUSED" });
    const down = rails(() => { throw new TypeError("ECONNREFUSED"); });
    expect(await down.r.signPayment(permit, "x")).toEqual({ ok: false, error: "SIGNER_UNREACHABLE" });
  });
});

describe("submitPaidRequest", () => {
  async function quoteThen(paid: Handler) {
    let first = true;
    const { r, fetchMock } = rails((url, init) => {
      if (first) { first = false; return quoted(); }
      return paid(url, init);
    });
    const q = await r.fetchQuote("quickcast", QUERY);
    if (!q.ok) throw new Error(q.error);
    return { r, fetchMock, quote: { ...q.quote, id: "qte_1", runId: "run_1" } as Quote };
  }

  test("200 with PAYMENT-RESPONSE is SETTLED, and the exact request is repeated with the payment header", async () => {
    const settle = { success: true, transaction: "0.0.9185802@1.2", network: "hedera:testnet", payer: "0.0.5005" };
    const { r, fetchMock, quote } = await quoteThen(() =>
      Response.json({ merchant: "quickcast" }, { headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(settle as never) } }));
    const res = await r.submitPaidRequest(quote, "sig");
    expect(res).toMatchObject({ outcome: "SETTLED", body: { merchant: "quickcast" }, settlement: settle });
    const [url1] = fetchMock.mock.calls[0]!;
    const [url2, init2] = fetchMock.mock.calls[1]!;
    expect(String(url2)).toBe(String(url1));
    expect((init2?.headers as Record<string, string>)["PAYMENT-SIGNATURE"]).toBe("sig");
  });

  test("402 is REJECTED, a timeout is NO_RESPONSE", async () => {
    expect((await (await quoteThen(() => quoted())).r.submitPaidRequest((await quoteThen(() => quoted())).quote, "sig")).outcome).toBe("REJECTED");
    const t = await quoteThen(() => { throw new DOMException("timed out", "TimeoutError"); });
    expect(await t.r.submitPaidRequest(t.quote, "sig")).toMatchObject({ outcome: "NO_RESPONSE" });
  });

  test("a quote this instance never fetched is not sent", async () => {
    const { r, fetchMock, quote } = await quoteThen(() => quoted());
    const res = await r.submitPaidRequest({ ...quote, requestHash: "other" }, "sig");
    expect(res.outcome).toBe("REJECTED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("settlement", () => {
  test("mirror id conversion", () => {
    expect(toMirrorTxId("0.0.9185802@1793981706.678766160")).toBe("0.0.9185802-1793981706-678766160");
    expect(() => toMirrorTxId("nope")).toThrow();
  });

  const hbarTx = (over: object = {}) => Response.json({
    transactions: [{ result: "SUCCESS", nonce: 0, transfers: [{ account: "0.0.5005", amount: -10000 }, { account: "0.0.101", amount: 10000 }, { account: "0.0.9185802", amount: -290413 }], token_transfers: [], ...over }],
  });
  const expectHbar = { payTo: "0.0.101", assetId: "0.0.0", amountAtomic: "10000" };

  test.each([
    ["exact HBAR credit", () => hbarTx(), expectHbar, "SUCCESS"],
    ["exact token credit", () => hbarTx({ transfers: [], token_transfers: [{ token_id: "0.0.429274", account: "0.0.101", amount: 10000 }, { token_id: "0.0.429274", account: "0.0.5005", amount: -10000 }] }),
      { ...expectHbar, assetId: "0.0.429274" }, "SUCCESS"],
    ["wrong amount", () => hbarTx(), { ...expectHbar, amountAtomic: "20000" }, "MISMATCH"],
    ["wrong recipient", () => hbarTx(), { ...expectHbar, payTo: "0.0.666" }, "MISMATCH"],
    ["wrong asset", () => hbarTx(), { ...expectHbar, assetId: "0.0.429274" }, "MISMATCH"],
    ["failed result", () => hbarTx({ result: "INSUFFICIENT_PAYER_BALANCE" }), expectHbar, "FAILED"],
    ["not on mirror", () => new Response("{}", { status: 404 }), expectHbar, "NOT_FOUND"],
  ] as const)("%s", async (_n, handler, expectArg, outcome) => {
    const { r, fetchMock } = rails(handler as Handler);
    expect(await r.checkSettlement("0.0.9185802@1793981706.678766160", expectArg)).toBe(outcome);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("http://mirror.test/api/v1/transactions/0.0.9185802-1793981706-678766160");
  });

  test("mirror outage throws MIRROR_UNAVAILABLE instead of claiming NOT_FOUND", async () => {
    await expect(rails(() => new Response("", { status: 503 })).r.checkSettlement("0.0.1@1.2", expectHbar)).rejects.toThrow("MIRROR_UNAVAILABLE");
    await expect(rails(() => { throw new TypeError("fetch failed"); }).r.checkSettlement("0.0.1@1.2", expectHbar)).rejects.toThrow("MIRROR_UNAVAILABLE");
  });

  test("recoverDelivery calls /recover with tx, requestHash and merchant", async () => {
    const { r, fetchMock } = rails(() => Response.json({ merchant: "quickcast" }));
    expect(await r.recoverDelivery("quickcast", "0.0.1@1.2", "abc")).toEqual({ ok: true, body: { merchant: "quickcast" } });
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe("/recover");
    expect(Object.fromEntries(url.searchParams)).toEqual({ tx: "0.0.1@1.2", requestHash: "abc", merchant: "quickcast" });
    expect(await rails(() => new Response("", { status: 404 })).r.recoverDelivery("quickcast", "0.0.1@1.2", "abc")).toEqual({ ok: false });
  });
});

describe("validateDelivery (R6)", () => {
  const at = () => new Date(NOW.getTime() - 60_000).toISOString();
  const head = (merchant: string) => ({ merchant, source: "hedera-mainnet-mirror", tokenId: "0.0.731861", generatedAt: at(), flags: [] as string[] });
  const keys = () => ({
    ...head("quickcast"),
    token: {
      name: "SAUCE", symbol: "SAUCE", decimals: 6, totalSupply: "1000000000000000", maxSupply: "1000000000000000", supplyType: "FINITE",
      treasury: "0.0.1077627", createdAt: "2022-01-01T00:00:00.000Z", memo: "", pauseStatus: "NOT_APPLICABLE",
      keys: { admin: true, freeze: false, wipe: false, supply: true, pause: false, kyc: false, feeSchedule: false },
      customFees: { fixed: 0, fractional: 0, royalty: 0 },
    },
  });
  const holdersBody = () => ({
    ...head("groundtruth"),
    holders: { thresholdPct: 1, whales: [{ account: "0.0.1077627", balance: "300000000000000", pct: 30 }], whaleCount: 1, whaleSharePct: 30, treasurySharePct: 30 },
  });
  const treasuryBody = () => ({
    ...head("hourlypro"),
    treasury: {
      account: "0.0.1077627", sampled: 100, mints: [{ timestamp: "1730000000.000000000", amount: "1000" }],
      outflows: [{ timestamp: "1730000001.000000000", amount: "500", to: "0.0.1001" }], outflowTotal: "500",
    },
  });
  const check = (body: unknown, merchant = "quickcast") => validateDelivery(merchant, QUERY, body, NOW);

  test("a good body for each kind is valid", () => {
    expect(check(keys())).toEqual({ valid: true, issues: [] });
    expect(check(holdersBody(), "groundtruth")).toEqual({ valid: true, issues: [] });
    expect(check(treasuryBody(), "hourlypro")).toEqual({ valid: true, issues: [] });
  });

  test("a NOT_FOUND body with token: null is valid", () => {
    const body = { ...keys(), token: null, flags: ["NOT_FOUND: no such token on Hedera mainnet"] };
    expect(check(body)).toEqual({ valid: true, issues: [] });
  });

  test("wrong token", () => {
    expect(check({ ...keys(), tokenId: "0.0.456858" }).issues).toEqual(["wrong token: 0.0.456858, requested 0.0.731861"]);
  });

  test("stale data", () => {
    const r = check({ ...keys(), generatedAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString() });
    expect(r.issues).toEqual(["stale data: generated 172800 s ago (max 21600 s)"]);
  });

  test("future timestamp", () => {
    expect(check({ ...keys(), generatedAt: new Date(NOW.getTime() + 3_600_000).toISOString() }).issues).toEqual(["generatedAt is in the future"]);
  });

  test("schema violations and wrong merchant", () => {
    expect(check({ ...holdersBody(), holders: undefined }, "groundtruth").issues[0]).toMatch(/^schema: holders/);
    expect(check({ ...keys(), source: "open-web" }).valid).toBe(false);
    expect(check(undefined).valid).toBe(false);
    expect(check({ ...keys(), merchant: "gouger" }).issues).toEqual(["wrong merchant: gouger"]);
  });
});

describe("publishAudit", () => {
  test("rejects payloads over 1 KB before submitting, publishes smaller ones", async () => {
    const submitAudit = vi.fn(async () => ({ topicId: "0.0.7777", sequenceNumber: 3, consensusTimestamp: "1.2" }));
    const { r } = rails(() => new Response(), { submitAudit });
    await expect(r.publishAudit({ id: "evt_1", json: "x".repeat(1025) })).rejects.toThrow(/exceeds 1024 bytes/);
    expect(submitAudit).not.toHaveBeenCalled();
    const json = JSON.stringify({ v: 1, type: "RUN_COMPLETED", id: "evt_2" });
    expect(await r.publishAudit({ id: "evt_2", json })).toEqual({ topicId: "0.0.7777", sequenceNumber: 3, consensusTimestamp: "1.2" });
    expect(submitAudit).toHaveBeenCalledWith(json);
  });
});
