import { afterEach, describe, expect, it } from "vitest";
import { createTrust } from "../src";
import { USER, activate, cleanup, decision, draft, inferenceInput, makeFx, quoteInput, TX } from "./helpers";

afterEach(cleanup);

describe("createTrust wiring", () => {
  it("works end to end through the Trust interface", async () => {
    const fx = makeFx();
    const t = createTrust(fx.ctx.env, { ctx: fx.ctx });
    const m = t.createMandateDraft(USER, draft(fx));
    expect(m.state).toBe("DRAFT");
    expect(t.getActiveMandate(USER)).toBeNull();
    activate(fx, m);
    expect(t.getActiveMandate(USER)?.id).toBe(m.id);

    const run = t.createRun(USER, "weather?");
    const q = t.recordQuote(run.id, quoteInput());
    const p = t.proposePurchase(q.id, decision());
    for (const to of ["RESERVED", "SIGNED", "SUBMITTED", "CONFIRMED"] as const) {
      t.transition(p.id, to, to === "SIGNED" ? { hederaTxId: TX } : {});
    }
    t.recordInference(inferenceInput(run.id, { totalCost: "0.5" }));

    const rv = t.getRunView(run.id);
    expect(rv.quotes).toHaveLength(1);
    expect(rv.purchases[0]!.state).toBe("CONFIRMED");
    expect(rv.inferenceCalls).toHaveLength(1);
    const l = t.getLedgerView(USER);
    expect(l).toMatchObject({ spentAtomic: "10000", reservedAtomic: "0", availableAtomic: "190000", dataSpendAtomic: "10000", inferenceSpend: "0.5" });
    expect(l.receipts).toHaveLength(1);

    expect(t.listUnresolved()).toEqual([]);
    t.setDelivery(p.id, "RECEIVED_VALID");
    t.updateRun(run.id, { state: "DONE" });
    t.setPreferences(USER, "cheap");
    expect(t.getPreferences(USER)?.text).toBe("cheap");
    expect(t.revokeMandate(m.id).state).toBe("REVOKED");
    expect(t.getActiveMandate(USER)).toBeNull();
  });

  it("not-yet-implemented methods throw", () => {
    const fx = makeFx();
    const t = createTrust(fx.ctx.env, { ctx: fx.ctx }) as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const name of ["startAuth", "pollAuth", "precheck", "authorize", "getPermitForPurchase", "listPendingAudit", "markAnchored", "markAuditRetry"]) {
      expect(() => t[name]!(), name).toThrow(/not implemented yet/);
    }
  });
});
