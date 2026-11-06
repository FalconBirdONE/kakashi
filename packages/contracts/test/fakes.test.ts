import { describe, expect, it } from "vitest";
import { createFakeBrain, createFakeRails, createFakeTrust, fromAtomic, toAtomic, IllegalTransitionError } from "../src";

describe("money", () => {
  it("round-trips", () => { expect(toAtomic("0.02", 6)).toBe("20000"); expect(fromAtomic("20000", 6)).toBe("0.02"); });
  it("rejects too many decimals", () => expect(() => toAtomic("0.0000001", 6)).toThrow());
});

describe("fakes end to end", () => {
  it("runs one purchase, rejects the gouger, blocks illegal transitions", async () => {
    const rails = createFakeRails(), brain = createFakeBrain(), trust = createFakeTrust();
    const m = trust.createMandateDraft("usr_1", { totalBudgetAtomic: "200000", perPaymentCapAtomic: "100000", autoApproveCapAtomic: "20000",
      allowedMerchantIds: ["quickcast", "hourlypro", "groundtruth", "gouger"], maxPurchasesPerRun: 3, maxRunDurationSeconds: 120, expiresInSeconds: 1800 });
    const att = await trust.startAuth("usr_1", "ACTIVATE_MANDATE", m.id);
    expect((await trust.pollAuth(att.id)).result).toBe("VERIFIED");
    const run = trust.createRun("usr_1", "Will it rain in Mumbai this week?");
    const plan = await brain.plan({ question: run.question, catalog: await rails.getCatalog(), budgetRemainingAtomic: "200000", perPaymentCapAtomic: "100000", assetDecimals: 6 });
    expect(plan.ok).toBe(true);
    const qs = [];
    for (const id of ["gouger", "quickcast"]) {
      const r = await rails.fetchQuote(id, {}); if (!r.ok) throw new Error();
      qs.push(trust.recordQuote(run.id, r.quote));
    }
    expect(trust.precheck(qs[0]!.id).reasons).toContain("OVER_PER_PAYMENT_CAP");
    const p = trust.proposePurchase(qs[1]!.id, { quoteId: qs[1]!.id, action: "BUY", reasonCode: "FILLS_NEED", needId: "n1", expectedUsefulness: 1, rationale: "" });
    const auth = trust.authorize(p.id);
    expect(auth.kind).toBe("PERMIT");
    if (auth.kind !== "PERMIT") return;
    const signed = await rails.signPayment(auth.permit, qs[1]!.rawRequirements);
    if (!signed.ok) throw new Error();
    trust.transition(p.id, "SIGNED", { hederaTxId: signed.hederaTxId });
    trust.transition(p.id, "SUBMITTED");
    expect((await rails.submitPaidRequest(qs[1]!, signed.paymentHeader)).outcome).toBe("SETTLED");
    trust.transition(p.id, "CONFIRMED");
    expect(trust.getLedgerView("usr_1").spentAtomic).toBe("10000");
    expect(() => trust.transition(p.id, "RESERVED")).toThrow(IllegalTransitionError);
  });
});
