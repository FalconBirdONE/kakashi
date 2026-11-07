import { describe, expect, it } from "vitest";
import {
  createFakeBrain, createFakeRails, createFakeTrust, IllegalTransitionError, toAtomic, verifyPermit, FAKE_PERMIT_SECRET,
  MERCHANT_REGISTRY, planOutputSchema,
} from "../src/index.js";

const draft = {
  totalBudgetAtomic: toAtomic("0.20", 6), perPaymentCapAtomic: toAtomic("0.10", 6), autoApproveCapAtomic: toAtomic("0.02", 6),
  allowedMerchantIds: ["quickcast", "hourlypro", "groundtruth", "gouger"], expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
};

async function setup() {
  const rails = createFakeRails(), brain = createFakeBrain(), trust = createFakeTrust();
  const m = trust.createMandateDraft("u1", draft);
  const att = await trust.startAuth("u1", "ACTIVATE_MANDATE", m.id);
  trust.completeAuth(att.id, "VERIFIED");
  return { rails, brain, trust };
}

describe("fake purchase smoke", () => {
  it("PROPOSED -> RESERVED -> SIGNED -> SUBMITTED -> CONFIRMED moves budget reserved -> spent", async () => {
    const { rails, trust } = await setup();
    const run = trust.createRun("u1", "Will it rain?");
    const fq = await rails.fetchQuote("quickcast", {});
    if (!fq.ok) throw new Error("quote");
    const quote = trust.recordQuote(run.id, fq.quote);
    expect(trust.precheck(quote.id).allowed).toBe(true);
    const p = trust.proposePurchase(quote.id, { action: "BUY", reasonCode: "FILLS_NEED", needId: "need-1", expectedUsefulness: 1, rationale: "x" });
    expect(p.state).toBe("PROPOSED");

    const auth = trust.authorize(p.id);
    if (auth.kind !== "PERMIT") throw new Error(JSON.stringify(auth));
    expect(verifyPermit(auth.permit, FAKE_PERMIT_SECRET, new Date()).ok).toBe(true);
    expect(trust.getLedgerView("u1").reservedAtomic).toBe("10000");

    const signed = await rails.signPayment(auth.permit, quote.rawRequirements);
    if (!signed.ok) throw new Error("sign");
    trust.transition(p.id, "SIGNED", { hederaTxId: signed.hederaTxId });
    trust.transition(p.id, "SUBMITTED");
    const res = await rails.submitPaidRequest(quote, signed.paymentHeader);
    expect(res.outcome).toBe("SETTLED");
    trust.transition(p.id, "CONFIRMED", { settlement: res.settlement });

    const l = trust.getLedgerView("u1");
    expect([l.reservedAtomic, l.spentAtomic, l.dataSpendAtomic, l.availableAtomic]).toEqual(["0", "10000", "10000", "190000"]);
    expect(() => trust.transition(p.id, "FAILED_FINAL")).toThrow(IllegalTransitionError);
    expect(trust.getLedgerView("u1").spentAtomic).toBe("10000");
  });

  it("rejects the gouger by policy and a swapped payTo", async () => {
    const { rails, trust } = await setup();
    const run = trust.createRun("u1", "q");
    rails.setFault("quickcast", "SWAP_PAYTO");
    const g = await rails.fetchQuote("gouger", {});
    const s = await rails.fetchQuote("quickcast", {});
    if (!g.ok || !s.ok) throw new Error("quote");
    expect(trust.precheck(trust.recordQuote(run.id, g.quote).id).reasons).toEqual(expect.arrayContaining(["OVER_PER_PAYMENT_CAP", "PRICE_ANOMALY"]));
    expect(trust.precheck(trust.recordQuote(run.id, s.quote).id).reasons).toContain("RECIPIENT_MISMATCH");
  });

  it("step-up approval flow and failed World attempt", async () => {
    const { rails, trust } = await setup();
    const run = trust.createRun("u1", "q");
    const fq = await rails.fetchQuote("hourlypro", {});
    if (!fq.ok) throw new Error("quote");
    const q = trust.recordQuote(run.id, fq.quote);
    const p = trust.proposePurchase(q.id, { action: "BUY", reasonCode: "FILLS_NEED", needId: "n", expectedUsefulness: 1, rationale: "x" });
    expect(trust.authorize(p.id).kind).toBe("NEEDS_APPROVAL");
    const a = await trust.startAuth("u1", "APPROVE_PURCHASE", p.id);
    trust.completeAuth(a.id, "VERIFIED");
    expect(trust.getPermitForPurchase(p.id)).not.toBeNull();
    expect(trust.getPermitForPurchase(p.id)).toBeNull(); // once

    const m2 = trust.createMandateDraft("u2", draft);
    const a2 = await trust.startAuth("u2", "ACTIVATE_MANDATE", m2.id);
    trust.completeAuth(a2.id, "CANCELLED");
    expect(trust.getActiveMandate("u2")).toBeNull();
    expect(() => trust.createRun("u2", "q")).toThrow();
  });

  it("brain buys the cheapest fill and fails on demand; audit chain links", async () => {
    const { rails, brain, trust } = await setup();
    const cat = await rails.getCatalog();
    const plan = await brain.plan({ question: "rain?", catalog: cat, budgetRemainingAtomic: "200000", perPaymentCapAtomic: "100000", assetDecimals: 6 });
    if (!plan.ok) throw new Error("plan");
    const dec = await brain.decide({
      question: "rain?", needs: plan.value.needs, alreadyBought: [], budgetRemainingAtomic: "200000", purchasesRemaining: 3, round: 1,
      quotes: cat.map((c) => ({ quoteId: `qte_${c.id}`, merchantId: c.id, amountAtomic: c.priceAtomic, capabilities: c.capabilities, coverage: c.coverage, freshnessSeconds: c.freshnessSeconds, referencePrice: c.referencePriceAtomic })),
    });
    if (!dec.ok) throw new Error("decide");
    expect(dec.value.decisions.filter((d) => d.action === "BUY").map((d) => d.quoteId)).toEqual(["qte_quickcast"]);
    expect(dec.trace.teeVerified).toBe(true);
    brain.failNext("TIMEOUT");
    expect((await brain.plan({ question: "x", catalog: cat, budgetRemainingAtomic: "1", perPaymentCapAtomic: "1", assetDecimals: 6 })).ok).toBe(false);
    const ev = trust.listPendingAudit(10);
    expect(ev.length).toBeGreaterThan(0);
    ev.forEach((e, i) => expect(e.prevHash).toBe(i === 0 ? "GENESIS" : ev[i - 1]!.hash));
  });
});

describe("token-check registry and plan schema", () => {
  it("keeps the 4 ids at their old prices with the new names, paths and schema ids", () => {
    expect(MERCHANT_REGISTRY.map((m) => [m.id, m.priceAtomic, m.name, m.path, m.responseSchemaId])).toEqual([
      ["quickcast", "10000", "KeyScan", "/m/quickcast/keys", "token-keys.v1"],
      ["hourlypro", "50000", "TreasuryWatch", "/m/hourlypro/treasury", "token-treasury.v1"],
      ["groundtruth", "30000", "HolderMap", "/m/groundtruth/holders", "token-holders.v1"],
      ["gouger", "500000", "InsiderAlpha", "/m/gouger/alpha", "token-alpha.v1"],
    ]);
  });

  const needs = [{ needId: "n1", description: "Admin keys", priority: 1 }];
  const parse = (query: unknown) => planOutputSchema().safeParse({ needs, query }).success;

  it("accepts a token query", () => {
    expect(parse({ tokenId: "0.0.731861", tradeUsd: 2000 })).toBe(true);
  });

  it("rejects the old lat/lon shape, symbols, zero trade size and extra keys", () => {
    expect(parse({ lat: 19.07, lon: 72.87, startDate: "2026-01-01", endDate: "2026-01-01" })).toBe(false);
    expect(parse({ tokenId: "SAUCE", tradeUsd: 2000 })).toBe(false);
    expect(parse({ tokenId: "0.0.731861", tradeUsd: 0 })).toBe(false);
    expect(parse({ tokenId: "0.0.731861", tradeUsd: 2000, extra: 1 })).toBe(false);
  });
});
