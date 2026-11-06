import { afterEach, describe, expect, it } from "vitest";
import type { PlanOutput, SynthesisOutput } from "@kakashi/contracts";
import { createMandateDraft, revokeMandate } from "../src/mandates";
import { verifyAuditChain } from "../src/outbox";
import { createRun, getRun, updateRun } from "../src/runs";
import { recordInference, recordQuote, proposePurchase } from "../src/purchases";
import { getLedgerView, getRunView } from "../src/views";
import {
  USER, activeMandate, budget, cleanup, decision, draft, inferenceInput, makeFx, propose, quoteInput, setup, step, walkTo,
} from "./helpers";

afterEach(cleanup);

describe("createRun", () => {
  it("throws MANDATE_INACTIVE without an active mandate", () => {
    const fx = makeFx();
    expect(() => createRun(fx.ctx, USER, "q")).toThrow("MANDATE_INACTIVE");
    createMandateDraft(fx.ctx, USER, draft(fx)); // a DRAFT is not active
    expect(() => createRun(fx.ctx, USER, "q")).toThrow("MANDATE_INACTIVE");
  });

  it("pins mandate id and version, starts in PLANNING", () => {
    const fx = makeFx();
    const m = activeMandate(fx);
    const run = createRun(fx.ctx, USER, "weather in Mumbai?");
    expect(run).toMatchObject({ userId: USER, mandateId: m.id, mandateVersion: m.version, question: "weather in Mumbai?", state: "PLANNING" });
    expect(run.id).toMatch(/^run_/);
    expect(getRun(fx.ctx, run.id)).toEqual(run);
  });

  it("rejects empty and over-long questions, accepts exactly 1000", () => {
    const fx = makeFx();
    activeMandate(fx);
    expect(() => createRun(fx.ctx, USER, "")).toThrow("INVALID_QUESTION");
    expect(() => createRun(fx.ctx, USER, "x".repeat(1001))).toThrow("INVALID_QUESTION");
    expect(createRun(fx.ctx, USER, "x".repeat(1000)).question).toHaveLength(1000);
  });

  it("throws MANDATE_INACTIVE after revoke", () => {
    const fx = makeFx();
    const m = activeMandate(fx);
    revokeMandate(fx.ctx, m.id);
    expect(() => createRun(fx.ctx, USER, "q")).toThrow("MANDATE_INACTIVE");
  });
});

describe("updateRun", () => {
  const answer: SynthesisOutput = { answer: "sunny", confidence: "high", citations: ["a"], disagreements: [], gaps: ["g"], suspiciousContent: [] };
  const plan: PlanOutput = { needs: [{ needId: "n1", description: "weather", priority: 1 }], query: { lat: 19.07, lon: 72.87, startDate: "2030-01-01", endDate: "2030-01-02" } };

  it("applies allowed keys and round-trips answer/plan JSON", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    updateRun(fx.ctx, run.id, { state: "DONE", finishedAt: "2030-01-01T00:05:00.000Z", answer, plan, failureReason: "none" });
    expect(getRun(fx.ctx, run.id)).toMatchObject({ state: "DONE", finishedAt: "2030-01-01T00:05:00.000Z", answer, plan, failureReason: "none" });
  });

  it("writes RUN_COMPLETED once, only when the run first enters a terminal state", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    const types = () => (fx.ctx.db.prepare("SELECT type, payload FROM audit_events").all() as { type: string; payload: string }[]);
    updateRun(fx.ctx, run.id, { state: "SYNTHESIZING" });
    expect(types()).toEqual([]);
    updateRun(fx.ctx, run.id, { state: "PARTIAL" });
    updateRun(fx.ctx, run.id, { state: "DONE", answer });
    expect(types().map((r) => r.type)).toEqual(["RUN_COMPLETED"]);
    expect(JSON.parse(types()[0]!.payload).run).toBe(run.id);
    expect(verifyAuditChain(fx.ctx)).toEqual({ ok: true, count: 1 });
  });

  it("rejects forbidden keys without changing anything", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    for (const k of ["id", "userId", "mandateId", "mandateVersion", "question", "startedAt", "bogus"]) {
      expect(() => updateRun(fx.ctx, run.id, { [k]: "x" } as never)).toThrow(`FORBIDDEN_FIELD: ${k}`);
    }
    expect(getRun(fx.ctx, run.id)).toEqual(run);
  });

  it("throws RUN_NOT_FOUND for an unknown run and no-ops on an empty patch", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    expect(() => updateRun(fx.ctx, "run_nope", { state: "DONE" })).toThrow("RUN_NOT_FOUND");
    updateRun(fx.ctx, run.id, {});
    expect(getRun(fx.ctx, run.id)).toEqual(run);
  });
});

describe("getRunView", () => {
  it("returns quotes (with policyResult), purchases and inference calls in order", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    const q1 = recordQuote(fx.ctx, run.id, quoteInput({ receivedAt: "2030-01-01T00:00:01.000Z" }));
    const q2 = recordQuote(fx.ctx, run.id, quoteInput({ merchantId: "hourlypro", amountAtomic: "50000", receivedAt: "2030-01-01T00:00:02.000Z" }));
    const pr = { allowed: false, reasons: ["OVER_BUDGET"] };
    fx.ctx.db.prepare("UPDATE quotes SET policy_result=? WHERE id=?").run(JSON.stringify(pr), q2.id);
    const p1 = proposePurchase(fx.ctx, q1.id, decision());
    fx.advance(1000);
    const p2 = proposePurchase(fx.ctx, q2.id, decision({ action: "SKIP", reasonCode: "REDUNDANT" }));
    const i1 = recordInference(fx.ctx, inferenceInput(run.id, { kind: "PLAN" }));
    fx.advance(1000);
    const i2 = recordInference(fx.ctx, inferenceInput(run.id, { kind: "DECIDE" }));
    fx.advance(1000);
    const i3 = recordInference(fx.ctx, inferenceInput(run.id, { kind: "SYNTHESIZE" }));

    const v = getRunView(fx.ctx, run.id);
    expect(v.run).toEqual(run);
    expect(v.quotes.map((q) => q.id)).toEqual([q1.id, q2.id]);
    expect(v.quotes[0]!.policyResult).toBeUndefined();
    expect(v.quotes[1]!.policyResult).toEqual(pr);
    expect(v.purchases.map((p) => p.id)).toEqual([p1.id, p2.id]);
    expect(v.inferenceCalls.map((c) => c.id)).toEqual([i1.id, i2.id, i3.id]);
  });

  it("throws RUN_NOT_FOUND for an unknown run", () => {
    expect(() => getRunView(makeFx().ctx, "run_nope")).toThrow("RUN_NOT_FOUND");
  });
});

describe("getLedgerView", () => {
  it("with no mandate returns zeros and a null mandate", () => {
    expect(getLedgerView(makeFx().ctx, USER)).toEqual({
      mandate: null, limitAtomic: "0", spentAtomic: "0", reservedAtomic: "0", availableAtomic: "0",
      dataSpendAtomic: "0", inferenceSpend: "0", receipts: [],
    });
  });

  it("reports limit/spent/reserved/available as atomic strings", () => {
    const fx = makeFx();
    const { mandate, run } = setup(fx);
    const a = propose(fx, run.id, "10000").purchase;
    const b = propose(fx, run.id, "50000").purchase;
    walkTo(fx, a.id, "CONFIRMED");
    step(fx, b.id, "RESERVED");
    const l = getLedgerView(fx.ctx, USER);
    expect(l.mandate?.id).toBe(mandate.id);
    expect(l).toMatchObject({ limitAtomic: "200000", spentAtomic: "10000", reservedAtomic: "50000", availableAtomic: "140000" });
    expect(budget(fx, mandate)).toEqual({ spent: "10000", reserved: "50000" });
  });

  it("dataSpend sums CONFIRMED only; receipts have the right shape and zgRequestId only when it resolves", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    const inf = recordInference(fx.ctx, inferenceInput(run.id, { zgRequestId: "zg_abc", totalCost: "0.1" }));
    const a = propose(fx, run.id, "10000", decision({ inferenceCallId: inf.id })).purchase;
    const b = propose(fx, run.id, "50000", decision()).purchase;
    const c = propose(fx, run.id, "30000", decision({ inferenceCallId: "inf_missing" })).purchase;
    const failed = propose(fx, run.id, "20000").purchase;
    walkTo(fx, a.id, "CONFIRMED");
    walkTo(fx, b.id, "CONFIRMED");
    walkTo(fx, c.id, "CONFIRMED");
    walkTo(fx, failed.id, "FAILED_FINAL");
    const l = getLedgerView(fx.ctx, USER);
    expect(l.dataSpendAtomic).toBe("90000");
    expect(l.spentAtomic).toBe("90000");
    expect(l.receipts).toHaveLength(3);
    const byId = Object.fromEntries(l.receipts.map((r) => [r.purchaseId, r]));
    expect(byId[a.id]).toEqual({
      purchaseId: a.id, merchantId: "quickcast", amountAtomic: "10000", hederaTxId: expect.stringContaining("0.0.9185802@"),
      zgRequestId: "zg_abc", at: expect.any(String),
    });
    expect("zgRequestId" in byId[b.id]!).toBe(false);
    expect("zgRequestId" in byId[c.id]!).toBe(false);
    expect(l.receipts.map((r) => r.purchaseId)).not.toContain(failed.id);
  });

  it("inferenceSpend is an exact decimal sum and 0 when none", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    expect(getLedgerView(fx.ctx, USER).inferenceSpend).toBe("0");
    for (const cost of ["0.1", "0.25", "0.003"]) recordInference(fx.ctx, inferenceInput(run.id, { totalCost: cost }));
    expect(getLedgerView(fx.ctx, USER).inferenceSpend).toBe("0.353");
  });

  it("inferenceSpend has no float error and trims zeros", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    for (const cost of ["0.1", "0.2"]) recordInference(fx.ctx, inferenceInput(run.id, { totalCost: cost }));
    expect(getLedgerView(fx.ctx, USER).inferenceSpend).toBe("0.3");
    recordInference(fx.ctx, inferenceInput(run.id, { totalCost: "0.7" }));
    expect(getLedgerView(fx.ctx, USER).inferenceSpend).toBe("1");
  });

  it("keeps values beyond 2^53 exact through reserve, confirm and the ledger", () => {
    const fx = makeFx();
    const big = "9007199254740993";
    const { run } = setup(fx, { totalBudgetAtomic: "9007199254740999", perPaymentCapAtomic: "9007199254740999", autoApproveCapAtomic: "1" });
    const p = propose(fx, run.id, big).purchase;
    step(fx, p.id, "RESERVED");
    expect(getLedgerView(fx.ctx, USER)).toMatchObject({ reservedAtomic: big, spentAtomic: "0", availableAtomic: "6" });
    step(fx, p.id, "SIGNED"); step(fx, p.id, "SUBMITTED"); step(fx, p.id, "CONFIRMED");
    const l = getLedgerView(fx.ctx, USER);
    expect(l).toMatchObject({ reservedAtomic: "0", spentAtomic: big, availableAtomic: "6", dataSpendAtomic: big, limitAtomic: "9007199254740999" });
    expect(l.receipts[0]!.amountAtomic).toBe(big);
  });
});
