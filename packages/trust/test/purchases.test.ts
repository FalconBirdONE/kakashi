import { afterEach, describe, expect, it } from "vitest";
import { IllegalTransitionError, PURCHASE_TRANSITIONS, canonicalJson, sha256Hex, type PurchaseState } from "@tollbooth/contracts";
import { getMandate } from "../src/mandates";
import { verifyAuditChain } from "../src/outbox";
import {
  computeQuoteHash, getPurchase, listUnresolved, proposePurchase, recordInference, recordQuote, setDelivery, transition,
} from "../src/purchases";
import {
  TX, WALK, budget, cleanup, decision, inferenceInput, makeFx, propose, quoteInput, setup, step, walkTo,
} from "./helpers";

afterEach(cleanup);

const STATES = Object.keys(PURCHASE_TRANSITIONS) as PurchaseState[];

describe("budget effects (quote 10000, total 200000)", () => {
  type Case = { name: string; steps: [PurchaseState, string, string][] }; // [to, spent, reserved]
  const R = ["0", "10000"] as const;
  const cases: Case[] = [
    { name: "PROPOSED->RESERVED reserves", steps: [["RESERVED", "0", "10000"]] },
    { name: "PROPOSED->AWAITING_APPROVAL reserves", steps: [["AWAITING_APPROVAL", "0", "10000"]] },
    { name: "AWAITING_APPROVAL->RESERVED does not reserve again", steps: [["AWAITING_APPROVAL", "0", "10000"], ["RESERVED", "0", "10000"]] },
    { name: "RESERVED->SIGNED no change", steps: [["RESERVED", ...R], ["SIGNED", ...R]] },
    { name: "SIGNED->SUBMITTED no change", steps: [["RESERVED", ...R], ["SIGNED", ...R], ["SUBMITTED", ...R]] },
    { name: "SUBMITTED->CONFIRMED moves reserved to spent", steps: [["RESERVED", ...R], ["SIGNED", ...R], ["SUBMITTED", ...R], ["CONFIRMED", "10000", "0"]] },
    { name: "SUBMITTED->UNKNOWN keeps reserved", steps: [["RESERVED", ...R], ["SIGNED", ...R], ["SUBMITTED", ...R], ["UNKNOWN", ...R]] },
    { name: "UNKNOWN->CONFIRMED moves reserved to spent", steps: [["RESERVED", ...R], ["SIGNED", ...R], ["SUBMITTED", ...R], ["UNKNOWN", ...R], ["CONFIRMED", "10000", "0"]] },
    { name: "UNKNOWN->FAILED_FINAL releases", steps: [["RESERVED", ...R], ["SIGNED", ...R], ["SUBMITTED", ...R], ["UNKNOWN", ...R], ["FAILED_FINAL", "0", "0"]] },
    { name: "SUBMITTED->FAILED_FINAL releases", steps: [["RESERVED", ...R], ["SIGNED", ...R], ["SUBMITTED", ...R], ["FAILED_FINAL", "0", "0"]] },
    { name: "SIGNED->FAILED_FINAL releases", steps: [["RESERVED", ...R], ["SIGNED", ...R], ["FAILED_FINAL", "0", "0"]] },
    { name: "AWAITING_APPROVAL->APPROVAL_DENIED releases", steps: [["AWAITING_APPROVAL", ...R], ["APPROVAL_DENIED", "0", "0"]] },
    { name: "RESERVED->FAILED_FINAL releases", steps: [["RESERVED", ...R], ["FAILED_FINAL", "0", "0"]] },
    { name: "PROPOSED->POLICY_REJECTED no change", steps: [["POLICY_REJECTED", "0", "0"]] },
    { name: "PROPOSED->AGENT_SKIPPED no change", steps: [["AGENT_SKIPPED", "0", "0"]] },
  ];

  it.each(cases)("$name", ({ steps }) => {
    const fx = makeFx();
    const { mandate, run } = setup(fx);
    const { purchase } = propose(fx, run.id);
    for (const [to, spent, reserved] of steps) {
      expect(step(fx, purchase.id, to).state).toBe(to);
      expect(budget(fx, mandate), `after ${to}`).toEqual({ spent, reserved });
    }
  });

  it("RESERVED->SIGNED without hederaTxId throws MISSING_TX_ID and changes nothing; with it, stores it", () => {
    const fx = makeFx();
    const { mandate, run } = setup(fx);
    const { purchase } = propose(fx, run.id);
    step(fx, purchase.id, "RESERVED");
    const snap = () => ({
      p: fx.ctx.db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id),
      m: fx.ctx.db.prepare("SELECT * FROM mandates WHERE id=?").get(mandate.id),
    });
    const before = snap();
    fx.advance(5000);
    expect(() => transition(fx.ctx, purchase.id, "SIGNED")).toThrow("MISSING_TX_ID");
    expect(snap()).toEqual(before);
    expect(getPurchase(fx.ctx, purchase.id)!.state).toBe("RESERVED");
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "10000" });

    const signed = transition(fx.ctx, purchase.id, "SIGNED", { hederaTxId: TX });
    expect(signed.state).toBe("SIGNED");
    expect(signed.hederaTxId).toBe(TX);
    expect(getPurchase(fx.ctx, purchase.id)!.hederaTxId).toBe(TX);
  });

  it("stores patch data (policyResult, settlement, approvalId) alongside the transition", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    const { purchase } = propose(fx, run.id);
    const p = transition(fx.ctx, purchase.id, "RESERVED", {
      approvalId: "apv_1", permitId: "pmt_1", policyResult: { allowed: true } as never,
    });
    expect(p).toMatchObject({ approvalId: "apv_1", permitId: "pmt_1", policyResult: { allowed: true } });
  });

  it("unknown purchase throws PURCHASE_NOT_FOUND", () => {
    expect(() => transition(makeFx().ctx, "pur_nope", "RESERVED")).toThrow("PURCHASE_NOT_FOUND");
  });
});

describe("T7: illegal transitions", () => {
  const pairs = STATES.map((from) => ({ from, tos: STATES.filter((to) => !PURCHASE_TRANSITIONS[from].includes(to)) }));

  it.each(pairs)("from $from: every non-allowed target throws and changes nothing", ({ from, tos }) => {
    // Large budget so walking never exhausts the mandate.
    const fx = makeFx();
    const { mandate, run } = setup(fx, { totalBudgetAtomic: "100000000", perPaymentCapAtomic: "1000000" });
    expect(tos.length).toBeGreaterThan(0);
    for (const to of tos) {
      const { purchase } = propose(fx, run.id);
      walkTo(fx, purchase.id, from);
      expect(getPurchase(fx.ctx, purchase.id)!.state).toBe(from);
      const snap = () => ({
        p: fx.ctx.db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id),
        m: fx.ctx.db.prepare("SELECT * FROM mandates WHERE id=?").get(mandate.id),
      });
      const before = JSON.stringify(snap());
      fx.advance(7000);
      let err: unknown;
      try { transition(fx.ctx, purchase.id, to, to === "SIGNED" ? { hederaTxId: TX } : {}); } catch (e) { err = e; }
      expect(err, `${from} -> ${to}`).toBeInstanceOf(IllegalTransitionError);
      expect((err as IllegalTransitionError).message).toMatch(/^ILLEGAL_TRANSITION/);
      expect(JSON.stringify(snap()), `${from} -> ${to}`).toBe(before);
    }
  });

  it("covers every state and the walks reach every state", () => {
    expect(STATES).toHaveLength(11);
    expect(Object.keys(WALK).sort()).toEqual([...STATES].sort());
  });
});

describe("OVER_BUDGET", () => {
  it("refuses a second reservation that would exceed total", () => {
    const fx = makeFx();
    const { mandate, run } = setup(fx, { totalBudgetAtomic: "60000", perPaymentCapAtomic: "60000" });
    const a = propose(fx, run.id, "50000").purchase;
    const b = propose(fx, run.id, "50000").purchase;
    step(fx, a.id, "RESERVED");
    expect(() => step(fx, b.id, "RESERVED")).toThrow("OVER_BUDGET");
    expect(() => step(fx, b.id, "AWAITING_APPROVAL")).toThrow("OVER_BUDGET");
    expect(getPurchase(fx.ctx, b.id)!.state).toBe("PROPOSED");
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "50000" });
  });
});

describe("FORBIDDEN_FIELD", () => {
  it.each(["state", "id", "quoteHash", "mandateVersion", "bogus"])("rejects %s", (key) => {
    const fx = makeFx();
    const { mandate, run } = setup(fx);
    const { purchase } = propose(fx, run.id);
    const before = fx.ctx.db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id);
    expect(() => transition(fx.ctx, purchase.id, "RESERVED", { [key]: "x" } as never)).toThrow(`FORBIDDEN_FIELD: ${key}`);
    expect(fx.ctx.db.prepare("SELECT * FROM purchases WHERE id=?").get(purchase.id)).toEqual(before);
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "0" });
  });
});

describe("recordQuote", () => {
  it("computes the quoteHash itself and ignores the caller's", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    const q = recordQuote(fx.ctx, run.id, quoteInput());
    expect(q.quoteHash).toMatch(/^[0-9a-f]{64}$/);
    expect(q.quoteHash).not.toBe("ignored");
    expect(q.quoteHash).toBe(computeQuoteHash(quoteInput()));
    expect(q).toMatchObject({ runId: run.id, amountAtomic: "10000", payTo: "0.0.3001", merchantId: "quickcast" });
    expect(q.id).toMatch(/^qte_/);
    // caller-provided hash is irrelevant; timestamps/raw do not affect it
    expect(recordQuote(fx.ctx, run.id, quoteInput({ quoteHash: "other", rawRequirements: "Zm9v", receivedAt: "2031-01-01T00:00:00.000Z" })).quoteHash).toBe(q.quoteHash);
  });

  it("changes when amountAtomic or payTo changes", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    const base = recordQuote(fx.ctx, run.id, quoteInput()).quoteHash;
    const amt = recordQuote(fx.ctx, run.id, quoteInput({ amountAtomic: "10001" })).quoteHash;
    const pay = recordQuote(fx.ctx, run.id, quoteInput({ payTo: "0.0.6666" })).quoteHash;
    expect(new Set([base, amt, pay]).size).toBe(3);
  });

  it("throws RUN_NOT_FOUND for an unknown run", () => {
    expect(() => recordQuote(makeFx().ctx, "run_nope", quoteInput())).toThrow("RUN_NOT_FOUND");
  });
});

describe("proposePurchase", () => {
  it("copies mandate id/version and quoteHash, and computes purchaseHash", () => {
    const fx = makeFx();
    const { mandate, run } = setup(fx);
    const { quote, purchase } = propose(fx, run.id, "10000", decision({ rationale: "r" }));
    expect(purchase).toMatchObject({
      runId: run.id, quoteId: quote.id, quoteHash: quote.quoteHash, mandateId: mandate.id, mandateVersion: mandate.version,
      state: "PROPOSED", delivery: "NOT_RECEIVED", decision: decision({ rationale: "r" }),
    });
    expect(purchase.id).toMatch(/^pur_/);
    expect(purchase.purchaseHash).toBe(sha256Hex(canonicalJson({
      purchaseId: purchase.id, quoteHash: quote.quoteHash, amountAtomic: quote.amountAtomic, payTo: quote.payTo,
      mandateVersion: mandate.version,
    })));
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "0" });
  });

  it("rejects a second proposal for the same quote", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    const { quote } = propose(fx, run.id);
    expect(() => proposePurchase(fx.ctx, quote.id, decision())).toThrow(/DUPLICATE_PURCHASE/);
  });

  it("throws QUOTE_NOT_FOUND for an unknown quote", () => {
    expect(() => proposePurchase(makeFx().ctx, "qte_nope", decision())).toThrow("QUOTE_NOT_FOUND");
  });
});

describe("setDelivery / listUnresolved", () => {
  it("setDelivery persists delivery and issues", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    const { purchase } = propose(fx, run.id);
    setDelivery(fx.ctx, purchase.id, "RECEIVED_INVALID", ["bad schema", "stale"]);
    expect(getPurchase(fx.ctx, purchase.id)).toMatchObject({ delivery: "RECEIVED_INVALID", deliveryIssues: ["bad schema", "stale"] });
    setDelivery(fx.ctx, purchase.id, "RECOVERED");
    const p = getPurchase(fx.ctx, purchase.id)!;
    expect(p.delivery).toBe("RECOVERED");
    expect(p.deliveryIssues).toBeUndefined();
    expect(() => setDelivery(fx.ctx, "pur_nope", "RECOVERED")).toThrow("PURCHASE_NOT_FOUND");
  });

  it("listUnresolved returns only SIGNED/SUBMITTED/UNKNOWN", () => {
    const fx = makeFx();
    const { run } = setup(fx, { totalBudgetAtomic: "100000000", perPaymentCapAtomic: "1000000" });
    const ids = Object.fromEntries(STATES.map((s) => {
      const p = propose(fx, run.id).purchase;
      walkTo(fx, p.id, s);
      return [s, p.id];
    })) as Record<PurchaseState, string>;
    const got = listUnresolved(fx.ctx).map((p) => p.id).sort();
    expect(got).toEqual([ids.SIGNED, ids.SUBMITTED, ids.UNKNOWN].sort());
  });
});

describe("audit events", () => {
  const events = (fx: ReturnType<typeof makeFx>) => (fx.ctx.db.prepare("SELECT type, payload FROM audit_events ORDER BY seq").all() as
    { type: string; payload: string }[]).map((r) => ({ type: r.type, ...JSON.parse(r.payload) }));

  it("PURCHASE_CONFIRMED on CONFIRMED (with tx and zg), then DELIVERY_RESULT on setDelivery", () => {
    const fx = makeFx();
    const { run, mandate } = setup(fx);
    const inf = recordInference(fx.ctx, inferenceInput(run.id, { zgRequestId: "zg_42" }));
    const { purchase } = propose(fx, run.id, "10000", decision({ inferenceCallId: inf.id }));
    walkTo(fx, purchase.id, "SUBMITTED");
    expect(events(fx)).toEqual([]);
    step(fx, purchase.id, "CONFIRMED");
    expect(events(fx)).toEqual([expect.objectContaining({
      type: "PURCHASE_CONFIRMED", run: run.id, pur: purchase.id, mandateHash: mandate.mandateHash, quoteHash: purchase.quoteHash, tx: TX, zg: "zg_42",
    })]);
    setDelivery(fx.ctx, purchase.id, "RECEIVED_VALID");
    expect(events(fx).map((e) => e.type)).toEqual(["PURCHASE_CONFIRMED", "DELIVERY_RESULT"]);
    expect(events(fx)[1]).toMatchObject({ run: run.id, pur: purchase.id, tx: TX });
    expect(verifyAuditChain(fx.ctx)).toEqual({ ok: true, count: 2 });
  });

  it("PURCHASE_FAILED on FAILED_FINAL, without tx when none was signed", () => {
    const fx = makeFx();
    const { run, mandate } = setup(fx);
    const { purchase } = propose(fx, run.id);
    walkTo(fx, purchase.id, "FAILED_FINAL");
    const ev = events(fx);
    expect(ev).toEqual([expect.objectContaining({ type: "PURCHASE_FAILED", run: run.id, pur: purchase.id, mandateHash: mandate.mandateHash, quoteHash: purchase.quoteHash })]);
    expect("tx" in ev[0]!).toBe(false);
    expect(verifyAuditChain(fx.ctx)).toEqual({ ok: true, count: 1 });
  });
});

describe("recordInference", () => {
  it.each([null, true, false] as const)("round-trips teeVerified=%s", (tee) => {
    const fx = makeFx();
    const { run } = setup(fx);
    const c = recordInference(fx.ctx, inferenceInput(run.id, { teeVerified: tee, ok: false, error: "boom" }));
    expect(c).toMatchObject({ runId: run.id, teeVerified: tee, ok: false, error: "boom", totalCost: "0.1", kind: "DECIDE" });
    expect(c.id).toMatch(/^inf_/);
  });

  it("omits error when absent and keeps ok=true", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    const c = recordInference(fx.ctx, inferenceInput(run.id));
    expect(c.ok).toBe(true);
    expect("error" in c).toBe(false);
  });

  it.each(["abc", "-1", "", ".5", "1."])("rejects non-decimal cost %j", (cost) => {
    const fx = makeFx();
    const { run } = setup(fx);
    expect(() => recordInference(fx.ctx, inferenceInput(run.id, { totalCost: cost }))).toThrow("INVALID_COST");
  });

  it("rejects an unknown run", () => {
    expect(() => recordInference(makeFx().ctx, inferenceInput("run_nope"))).toThrow("RUN_NOT_FOUND");
  });
});

describe("large atomic values", () => {
  it("stay exact through reserve and confirm (beyond 2^53)", () => {
    const fx = makeFx();
    const big = "9007199254740993";
    const { mandate, run } = setup(fx, { totalBudgetAtomic: "9007199254740999", perPaymentCapAtomic: "9007199254740999", autoApproveCapAtomic: "1" });
    const { purchase } = propose(fx, run.id, big);
    step(fx, purchase.id, "RESERVED");
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: big });
    for (const to of ["SIGNED", "SUBMITTED"] as const) step(fx, purchase.id, to);
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: big });
    step(fx, purchase.id, "CONFIRMED");
    expect(budget(fx, mandate)).toEqual({ spent: big, reserved: "0" });
  });
});
