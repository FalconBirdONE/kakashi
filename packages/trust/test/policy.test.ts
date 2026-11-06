import { describe, expect, it } from "vitest";
import type { Mandate, PolicyReason } from "@kakashi/contracts";
import { evaluate, policyConfigFromEnv, type PolicyConfig, type RunStats } from "../src/policy";

// SPEC §13 T8: every §11.1 rule, positive and negative.

const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const ALL = ["quickcast", "hourlypro", "groundtruth", "gouger"];

const mandate = (over: Partial<Mandate> = {}): Mandate => ({
  id: "mdt_1", version: 1, state: "ACTIVE", userId: "usr_1", agentId: "agt_1", walletAccountId: "0.0.2000",
  network: "hedera:testnet", assetId: "0.0.429274", assetDecimals: 6,
  totalBudgetAtomic: "200000", perPaymentCapAtomic: "100000", autoApproveCapAtomic: "20000",
  allowedMerchantIds: [...ALL], maxPurchasesPerRun: 3, maxRunDurationSeconds: 120,
  validFrom: iso(NOW - 60_000), expiresAt: iso(NOW + 30 * 60_000), revokedAt: null,
  spentAtomic: "0", reservedAtomic: "0", mandateHash: "h".repeat(64), activationApprovalId: "apr_1",
  createdAt: iso(NOW - 60_000), ...over,
});

const config = (over: Partial<PolicyConfig> = {}): PolicyConfig => ({
  payTo: { quickcast: "0.0.5001", hourlypro: "0.0.5002", groundtruth: "0.0.5003", gouger: "0.0.5004" },
  network: "hedera:testnet", assetId: "0.0.429274", feePayer: "0.0.9185802", ...over,
});

type Q = Parameters<typeof evaluate>[0];
const PAYTO: Record<string, string> = { quickcast: "0.0.5001", hourlypro: "0.0.5002", groundtruth: "0.0.5003", gouger: "0.0.5004" };
const quote = (over: Partial<Q> = {}): Q => {
  const merchantId = over.merchantId ?? "quickcast";
  return {
    merchantId, network: "hedera:testnet", assetId: "0.0.429274", amountAtomic: "10000",
    payTo: PAYTO[merchantId] ?? "0.0.9999", feePayer: "0.0.9185802", localExpiresAt: iso(NOW + 60_000), ...over,
  };
};

const run = (over: Partial<RunStats> = {}): RunStats => ({
  runMandateVersion: 1, runStartedAt: iso(NOW - 10_000), purchasesCounted: 0, duplicateRequest: false, ...over,
});

const ev = (o: { q?: Partial<Q>; m?: Partial<Mandate>; r?: Partial<RunStats>; c?: Partial<PolicyConfig>; now?: number } = {}) =>
  evaluate(quote(o.q), mandate(o.m), run(o.r), new Date(o.now ?? NOW), config(o.c));

const reasons = (o: Parameters<typeof ev>[0]): PolicyReason[] => ev(o).reasons;

describe("evaluate baseline", () => {
  it("demo mandate + quickcast 10000 passes every rule without approval", () => {
    expect(ev()).toEqual({ allowed: true, reasons: [], needsApproval: false });
  });

  it.each(ALL)("baseline passes for %s at its listed price (gouger excepted)", (merchantId) => {
    const price: Record<string, string> = { quickcast: "10000", hourlypro: "50000", groundtruth: "30000", gouger: "40000" };
    expect(reasons({ q: { merchantId, amountAtomic: price[merchantId] } })).toEqual([]);
  });
});

describe("rule 1: mandate active, unexpired, unrevoked, version", () => {
  it("expired by state", () => expect(reasons({ m: { state: "EXPIRED" } })).toEqual(["MANDATE_EXPIRED"]));
  it("expired by time (expiresAt == now)", () => expect(reasons({ m: { expiresAt: iso(NOW) } })).toEqual(["MANDATE_EXPIRED"]));
  it("unexpired 1 ms before expiresAt", () => expect(reasons({ m: { expiresAt: iso(NOW + 1) } })).toEqual([]));
  it("unparseable expiresAt fails closed", () => expect(reasons({ m: { expiresAt: "garbage" } })).toEqual(["MANDATE_EXPIRED"]));
  it("expired takes precedence over inactive", () =>
    expect(reasons({ m: { state: "REVOKED", expiresAt: iso(NOW - 1) } })).toEqual(["MANDATE_EXPIRED"]));
  it.each(["DRAFT", "PENDING_APPROVAL", "REVOKED", "EXHAUSTED"] satisfies Mandate["state"][])("inactive by state %s", (state) =>
    expect(reasons({ m: { state } })).toEqual(["MANDATE_INACTIVE"]));
  it("inactive by revokedAt", () => expect(reasons({ m: { revokedAt: iso(NOW - 1) } })).toEqual(["MANDATE_INACTIVE"]));
  it("inactive by version mismatch", () => expect(reasons({ r: { runMandateVersion: 2 } })).toEqual(["MANDATE_INACTIVE"]));
});

describe("rule 2: merchant allowed and registered", () => {
  it("not in mandate allow-list", () =>
    expect(reasons({ m: { allowedMerchantIds: ["hourlypro"] } })).toEqual(["MERCHANT_NOT_ALLOWED"]));
  it("allowed by mandate but unknown to registry (price rule skipped)", () =>
    expect(reasons({ q: { merchantId: "evil", payTo: "0.0.6666" }, m: { allowedMerchantIds: ["evil"] }, c: { payTo: { evil: "0.0.6666" } } }))
      .toEqual(["MERCHANT_NOT_ALLOWED"]));
});

describe("rule 3: recipient", () => {
  it("swapped payTo", () => expect(reasons({ q: { payTo: "0.0.6666" } })).toEqual(["RECIPIENT_MISMATCH"]));
  it("missing configured payTo fails closed", () => expect(reasons({ c: { payTo: {} } })).toEqual(["RECIPIENT_MISMATCH"]));
  it("empty configured payTo fails closed even for empty quote payTo", () =>
    expect(reasons({ q: { payTo: "" }, c: { payTo: { quickcast: "" } } })).toEqual(["RECIPIENT_MISMATCH"]));
});

describe("rule 4: network and asset", () => {
  it("network differs from mandate", () =>
    expect(reasons({ m: { network: "hedera:mainnet" as Mandate["network"] } })).toEqual(["NETWORK_MISMATCH"]));
  it("network differs from config", () => expect(reasons({ c: { network: "hedera:mainnet" } })).toEqual(["NETWORK_MISMATCH"]));
  it("network differs from both", () => expect(reasons({ q: { network: "eip155:1" } })).toEqual(["NETWORK_MISMATCH"]));
  it("asset differs from mandate", () => expect(reasons({ m: { assetId: "0.0.0" } })).toEqual(["ASSET_MISMATCH"]));
  it("asset differs from config", () => expect(reasons({ c: { assetId: "0.0.0" } })).toEqual(["ASSET_MISMATCH"]));
  it("asset differs from both", () => expect(reasons({ q: { assetId: "0.0.1" } })).toEqual(["ASSET_MISMATCH"]));
});

describe("rule 5: fee payer", () => {
  it("unexpected fee payer", () => expect(reasons({ q: { feePayer: "0.0.2000" } })).toEqual(["FEEPAYER_NOT_ALLOWED"]));
});

describe("rule 6: per-payment cap (hourlypro, so 100000 is within the price range)", () => {
  it("amount == cap passes", () => expect(reasons({ q: { merchantId: "hourlypro", amountAtomic: "100000" } })).toEqual([]));
  it("cap + 1 fails", () =>
    expect(reasons({ q: { merchantId: "hourlypro", amountAtomic: "100001" } })).toEqual(["OVER_PER_PAYMENT_CAP"]));
});

describe("rule 7: budget with spent and reserved both nonzero", () => {
  it("exact fit passes", () => expect(reasons({ m: { spentAtomic: "150000", reservedAtomic: "40000" } })).toEqual([]));
  it("one unit over fails", () =>
    expect(reasons({ m: { spentAtomic: "150000", reservedAtomic: "40001" } })).toEqual(["OVER_BUDGET"]));
});

describe("rule 8: run limits", () => {
  it("max - 1 purchases passes", () => expect(reasons({ r: { purchasesCounted: 2 } })).toEqual([]));
  it("purchases == max fails", () => expect(reasons({ r: { purchasesCounted: 3 } })).toEqual(["MAX_PURCHASES_REACHED"]));
  it("exactly maxRunDurationSeconds elapsed passes", () => expect(reasons({ r: { runStartedAt: iso(NOW - 120_000) } })).toEqual([]));
  it("1 ms over fails", () => expect(reasons({ r: { runStartedAt: iso(NOW - 120_001) } })).toEqual(["RUN_TIME_EXCEEDED"]));
  it("unparseable runStartedAt fails closed", () => expect(reasons({ r: { runStartedAt: "nope" } })).toEqual(["RUN_TIME_EXCEEDED"]));
});

describe("rule 9: price anomaly (hourlypro reference 30000..80000)", () => {
  const big = { perPaymentCapAtomic: "1000000", totalBudgetAtomic: "1000000" };
  it.each([
    ["15000", []], ["14999", ["PRICE_ANOMALY"]], ["120000", []], ["120001", ["PRICE_ANOMALY"]],
  ] as [string, PolicyReason[]][])("amount %s -> %j", (amountAtomic, want) =>
    expect(reasons({ q: { merchantId: "hourlypro", amountAtomic }, m: big })).toEqual(want));
});

describe("rule 10: quote expiry", () => {
  it("now == localExpiresAt fails", () => expect(reasons({ q: { localExpiresAt: iso(NOW) } })).toEqual(["QUOTE_EXPIRED"]));
  it("1 ms before passes", () => expect(reasons({ q: { localExpiresAt: iso(NOW + 1) } })).toEqual([]));
  it("unparseable fails closed", () => expect(reasons({ q: { localExpiresAt: "x" } })).toEqual(["QUOTE_EXPIRED"]));
});

describe("rule 11: duplicate", () => {
  it("duplicate request fails", () => expect(reasons({ r: { duplicateRequest: true } })).toEqual(["DUPLICATE_REQUEST"]));
});

describe("rule 12: needsApproval", () => {
  it("amount == autoApproveCap needs no approval", () =>
    expect(ev({ q: { amountAtomic: "20000" } })).toEqual({ allowed: true, reasons: [], needsApproval: false }));
  it("autoApproveCap + 1 needs approval and is still allowed", () =>
    expect(ev({ q: { amountAtomic: "20001" } })).toEqual({ allowed: true, reasons: [], needsApproval: true }));
  it("computed even when rejected", () =>
    expect(ev({ q: { amountAtomic: "20001" }, r: { duplicateRequest: true } }))
      .toEqual({ allowed: false, reasons: ["DUPLICATE_REQUEST"], needsApproval: true }));
});

describe("multiple failures", () => {
  it("gouger at 500000: cap, budget and anomaly together, needs approval", () =>
    expect(ev({ q: { merchantId: "gouger", amountAtomic: "500000" } })).toEqual({
      allowed: false, reasons: ["OVER_PER_PAYMENT_CAP", "OVER_BUDGET", "PRICE_ANOMALY"], needsApproval: true,
    }));

  it("collects every reason in stable rule order", () =>
    expect(reasons({
      q: { merchantId: "gouger", amountAtomic: "500000", payTo: "0.0.6666", network: "eip155:1", assetId: "0.0.1",
        feePayer: "0.0.1", localExpiresAt: iso(NOW - 1) },
      m: { state: "EXPIRED", allowedMerchantIds: ["quickcast"] },
      r: { purchasesCounted: 3, runStartedAt: iso(NOW - 999_999), duplicateRequest: true },
    })).toEqual([
      "MANDATE_EXPIRED", "MERCHANT_NOT_ALLOWED", "RECIPIENT_MISMATCH", "NETWORK_MISMATCH", "ASSET_MISMATCH",
      "FEEPAYER_NOT_ALLOWED", "OVER_PER_PAYMENT_CAP", "OVER_BUDGET", "MAX_PURCHASES_REACHED", "RUN_TIME_EXCEEDED",
      "PRICE_ANOMALY", "QUOTE_EXPIRED", "DUPLICATE_REQUEST",
    ]));

  it("inactive plus recipient swap", () =>
    expect(reasons({ m: { revokedAt: iso(NOW) }, q: { payTo: "0.0.6666" } })).toEqual(["MANDATE_INACTIVE", "RECIPIENT_MISMATCH"]));
});

describe("malformed money", () => {
  it.each(["1.5", "-1", "", "abc"])("amount %j throws", (amountAtomic) => expect(() => ev({ q: { amountAtomic } })).toThrow());
});

describe("policyConfigFromEnv", () => {
  it("maps payTo per registry entry and applies defaults", () =>
    expect(policyConfigFromEnv({ MERCHANT_QUICKCAST_PAYTO: "0.0.5001", MERCHANT_GOUGER_PAYTO: "0.0.5004" })).toEqual({
      payTo: { quickcast: "0.0.5001", hourlypro: undefined, groundtruth: undefined, gouger: "0.0.5004" },
      network: "hedera:testnet", assetId: "0.0.429274", feePayer: "0.0.9185802",
    }));

  it("reads explicit values", () =>
    expect(policyConfigFromEnv({ HEDERA_NETWORK: "hedera:mainnet", ASSET_MODE: "usdc", USDC_TOKEN_ID: "0.0.777", FACILITATOR_FEEPAYER: "0.0.42" }))
      .toMatchObject({ network: "hedera:mainnet", assetId: "0.0.777", feePayer: "0.0.42" }));

  it.each(["hbar", "HBAR", "Hbar"])("ASSET_MODE=%s selects HBAR (0.0.0)", (ASSET_MODE) =>
    expect(policyConfigFromEnv({ ASSET_MODE, USDC_TOKEN_ID: "0.0.777" }).assetId).toBe("0.0.0"));

  it("feeds evaluate end to end", () => {
    const c = policyConfigFromEnv({ MERCHANT_QUICKCAST_PAYTO: "0.0.5001" });
    expect(evaluate(quote(), mandate(), run(), new Date(NOW), c).allowed).toBe(true);
  });
});
