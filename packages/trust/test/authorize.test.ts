import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPermit, type Purchase, type SigningPermit } from "@tollbooth/contracts";
import { authorize, issuePermitAfterApproval, precheck } from "../src/authorize";
import { revokeMandate } from "../src/mandates";
import { getPurchase, getQuote, proposePurchase, recordQuote } from "../src/purchases";
import { createRun } from "../src/runs";
import type { WorkerIn, WorkerOut } from "./fixtures/authorize-worker";
import { START, USER, activeMandate, budget, cleanup, decision, iso, makeFx, propose, quoteInput, setup, type Fx } from "./helpers";

// SPEC §8.4 steps 1-3, §7.7, §13 T4/T5/T6.

const SECRET = "ab".repeat(32);
const ENV = { PERMIT_SECRET: SECRET, MERCHANT_QUICKCAST_PAYTO: "0.0.3001", MERCHANT_GOUGER_PAYTO: "0.0.3004" };

afterEach(cleanup);

const fresh = (env: Record<string, string | undefined> = ENV): Fx => makeFx(env);
const stateOf = (fx: Fx, id: string): Purchase["state"] => getPurchase(fx.ctx, id)!.state;
const changes = (fx: Fx): number => (fx.ctx.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;

/** Every row of every table, for "nothing changed" checks. */
function snapshot(fx: Fx): string {
  const tables = fx.ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  return JSON.stringify(tables.map((t) => [t.name, fx.ctx.db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()]));
}

let attempts = 0;
/** World activation/approval isn't built yet: write the auth attempt and approval rows directly. */
function approval(fx: Fx, targetHash: string, over: { decision?: string; expiresAt?: string } = {}): string {
  const n = ++attempts;
  const now = iso(fx.clock.t);
  fx.ctx.db.prepare(
    `INSERT INTO auth_attempts (id, user_id, purpose, target_hash, started_at, expires_at, result, device_code_ref, verification_uri, user_code)
     VALUES (?, ?, 'APPROVE_PURCHASE', ?, ?, ?, 'APPROVED', 'dc', 'https://world.example', 'CODE')`,
  ).run(`att_${n}`, USER, targetHash, now, iso(fx.clock.t + 5 * 60_000));
  fx.ctx.db.prepare(
    "INSERT INTO approvals (id, attempt_id, purpose, target_hash, decision, created_at, expires_at) VALUES (?, ?, 'APPROVE_PURCHASE', ?, ?, ?, ?)",
  ).run(`apr_${n}`, `att_${n}`, targetHash, over.decision ?? "APPROVED", now, over.expiresAt ?? iso(fx.clock.t + 5 * 60_000));
  return `apr_${n}`;
}
const consumedAt = (fx: Fx, id: string): string | null =>
  (fx.ctx.db.prepare("SELECT consumed_at FROM approvals WHERE id = ?").get(id) as { consumed_at: string | null }).consumed_at;

/** §7.7: the permit mirrors the stored quote and purchase exactly, lives 60 s, and its MAC covers every field. */
function expectPermitMatches(fx: Fx, permit: SigningPermit, purchaseId: string): void {
  const p = getPurchase(fx.ctx, purchaseId)!;
  const q = getQuote(fx.ctx, p.quoteId)!;
  expect(permit).toMatchObject({
    network: q.network, assetId: q.assetId, amountAtomic: q.amountAtomic, payTo: q.payTo, feePayer: q.feePayer,
    quoteHash: p.quoteHash, purchaseId: p.id, mandateId: p.mandateId, mandateVersion: p.mandateVersion, permitId: p.permitId,
  });
  expect(q.quoteHash).toBe(p.quoteHash);
  expect(Date.parse(permit.expiresAt) - Date.parse(permit.issuedAt)).toBe(60_000);
  const issued = new Date(permit.issuedAt);
  expect(verifyPermit(permit, SECRET, issued)).toEqual({ ok: true });
  expect(verifyPermit(permit, SECRET, new Date(issued.getTime() + 59_999))).toEqual({ ok: true });
  expect(verifyPermit(permit, "cd".repeat(32), issued)).toEqual({ ok: false, reason: "BAD_MAC" });
  expect(verifyPermit(permit, SECRET, new Date(issued.getTime() + 60_000))).toEqual({ ok: false, reason: "EXPIRED" });
  for (const k of Object.keys(permit) as (keyof SigningPermit)[]) {
    if (k === "mac") continue;
    const v = permit[k];
    const tampered = { ...permit, [k]: typeof v === "number" ? v + 1 : `${v}0` } as SigningPermit;
    expect(verifyPermit(tampered, SECRET, issued), `tampered ${k}`).toEqual({ ok: false, reason: "BAD_MAC" });
  }
}

describe("authorize", () => {
  it("issues a permit and reserves for an allowed purchase under autoApproveCap", () => {
    const fx = fresh();
    const { mandate, run } = setup(fx);
    const { purchase } = propose(fx, run.id, "10000");
    const r = authorize(fx.ctx, purchase.id);
    if (r.kind !== "PERMIT") throw new Error(`expected PERMIT, got ${JSON.stringify(r)}`);
    expect(stateOf(fx, purchase.id)).toBe("RESERVED");
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "10000" });
    expectPermitMatches(fx, r.permit, purchase.id);
  });

  it("T6: mandate revoked between propose and authorize -> REJECTED, nothing reserved, no permit", () => {
    const fx = fresh();
    const { mandate, run } = setup(fx);
    const { purchase } = propose(fx, run.id, "10000");
    revokeMandate(fx.ctx, mandate.id);
    const r = authorize(fx.ctx, purchase.id);
    // policy.ts: REVOKED (not EXPIRED, still before expiresAt) -> MANDATE_INACTIVE.
    expect(r).toEqual({ kind: "REJECTED", reasons: ["MANDATE_INACTIVE"] });
    const p = getPurchase(fx.ctx, purchase.id)!;
    expect(p.state).toBe("POLICY_REJECTED");
    expect(p.permitId).toBeUndefined();
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "0" });
  });

  it("throws PURCHASE_NOT_PROPOSED on a second authorize and changes nothing", () => {
    const fx = fresh();
    const { mandate, run } = setup(fx);
    const { purchase } = propose(fx, run.id, "10000");
    authorize(fx.ctx, purchase.id);
    const before = snapshot(fx);
    expect(() => authorize(fx.ctx, purchase.id)).toThrow("PURCHASE_NOT_PROPOSED");
    expect(snapshot(fx)).toBe(before);
    expect(budget(fx, mandate).reserved).toBe("10000");
  });

  it("throws on a missing or malformed PERMIT_SECRET before any change", () => {
    for (const secret of [undefined, "abc"]) {
      const fx = fresh({ ...ENV, PERMIT_SECRET: secret });
      const { run } = setup(fx);
      const { purchase } = propose(fx, run.id, "10000");
      const before = snapshot(fx);
      const n = changes(fx);
      expect(() => authorize(fx.ctx, purchase.id)).toThrow("PERMIT_SECRET not set");
      expect(changes(fx)).toBe(n);
      expect(snapshot(fx)).toBe(before);
      expect(stateOf(fx, purchase.id)).toBe("PROPOSED");
    }
  });

  it("rejects DUPLICATE_REQUEST for a second purchase with the same requestHash in a run", () => {
    const fx = fresh();
    const { mandate, run } = setup(fx);
    const a = propose(fx, run.id, "10000"); // quoteInput's requestHash is "rh_1" for every quote
    expect(authorize(fx.ctx, a.purchase.id).kind).toBe("PERMIT");
    const b = propose(fx, run.id, "10000");
    expect(authorize(fx.ctx, b.purchase.id)).toEqual({ kind: "REJECTED", reasons: ["DUPLICATE_REQUEST"] });
    expect(stateOf(fx, b.purchase.id)).toBe("POLICY_REJECTED");
    expect(budget(fx, mandate).reserved).toBe("10000");
  });

  it("two duplicates proposed before either is authorized: a PROPOSED sibling counts (rule 11), so only one permit", () => {
    const fx = fresh();
    const { mandate, run } = setup(fx);
    const a = propose(fx, run.id, "10000");
    const b = propose(fx, run.id, "10000");
    expect(authorize(fx.ctx, a.purchase.id)).toEqual({ kind: "REJECTED", reasons: ["DUPLICATE_REQUEST"] });
    expect(authorize(fx.ctx, b.purchase.id).kind).toBe("PERMIT"); // a is now POLICY_REJECTED (dead)
    expect(budget(fx, mandate).reserved).toBe("10000");
  });

  it("rejects the gouger quote with OVER_PER_PAYMENT_CAP and PRICE_ANOMALY", () => {
    const fx = fresh();
    const { mandate, run } = setup(fx);
    const q = recordQuote(fx.ctx, run.id, quoteInput({ merchantId: "gouger", path: "/m/gouger/premium", amountAtomic: "500000", payTo: "0.0.3004" }));
    const p = proposePurchase(fx.ctx, q.id, decision());
    const r = authorize(fx.ctx, p.id);
    if (r.kind !== "REJECTED") throw new Error(`expected REJECTED, got ${r.kind}`);
    expect(r.reasons).toEqual(expect.arrayContaining(["OVER_PER_PAYMENT_CAP", "PRICE_ANOMALY"]));
    expect(stateOf(fx, p.id)).toBe("POLICY_REJECTED");
    expect(getPurchase(fx.ctx, p.id)!.policyResult?.reasons).toEqual(r.reasons);
    expect(budget(fx, mandate).reserved).toBe("0");
  });

  it("rejects a quote whose stored hash no longer matches (tampered after proposal)", () => {
    const fx = fresh();
    const { mandate, run } = setup(fx);
    const { purchase, quote } = propose(fx, run.id, "10000");
    fx.ctx.db.prepare("UPDATE quotes SET pay_to = '0.0.3001', amount = '10001' WHERE id = ?").run(quote.id);
    const r = authorize(fx.ctx, purchase.id);
    expect(r).toEqual({ kind: "REJECTED", reasons: ["QUOTE_EXPIRED"] });
    expect(budget(fx, mandate).reserved).toBe("0");
  });

  it("writes one hash-chained PURCHASE_DECIDED audit row per authorize, without question text", () => {
    const fx = fresh();
    activeMandate(fx);
    const question = "UNIQUE-QUESTION-TEXT rain in Mumbai?";
    const run = createRun(fx.ctx, USER, question);
    const ids = [propose(fx, run.id, "10000"), propose(fx, run.id, "10000"), propose(fx, run.id, "25000")].map((x) => x.purchase.id);
    for (const id of ids) authorize(fx.ctx, id); // PERMIT, DUPLICATE_REQUEST, DUPLICATE_REQUEST
    const rows = fx.ctx.db.prepare("SELECT type, payload, prev_hash, hash FROM audit_events ORDER BY seq").all() as
      { type: string; payload: string; prev_hash: string; hash: string }[];
    expect(rows.map((r) => r.type)).toEqual(["PURCHASE_DECIDED", "PURCHASE_DECIDED", "PURCHASE_DECIDED"]);
    expect(rows.map((r) => JSON.parse(r.payload).pur)).toEqual(ids);
    rows.forEach((r, i) => expect(r.prev_hash).toBe(i === 0 ? "0".repeat(64) : rows[i - 1]!.hash));
    for (const r of rows) {
      expect(r.payload).not.toContain("UNIQUE-QUESTION-TEXT");
      expect(JSON.parse(r.payload)).toMatchObject({ v: 1, type: "PURCHASE_DECIDED", run: run.id, mandateHash: expect.any(String) });
    }
  });
});

describe("precheck", () => {
  it("has no side effects and returns the reasons authorize would", () => {
    const fx = fresh();
    const { run } = setup(fx);
    const cases = [
      recordQuote(fx.ctx, run.id, quoteInput({ requestHash: "rh_ok" })),
      recordQuote(fx.ctx, run.id, quoteInput({ requestHash: "rh_g", merchantId: "gouger", amountAtomic: "500000", payTo: "0.0.3004" })),
    ];
    for (const q of cases) {
      const before = snapshot(fx);
      const n = changes(fx);
      const pre = precheck(fx.ctx, q.id);
      expect(changes(fx)).toBe(n);
      expect(snapshot(fx)).toBe(before);
      const r = authorize(fx.ctx, proposePurchase(fx.ctx, q.id, decision()).id);
      expect(r.kind === "REJECTED" ? r.reasons : []).toEqual(pre.reasons);
      expect(r.kind).toBe(pre.allowed ? "PERMIT" : "REJECTED");
    }
    expect(precheck(fx.ctx, cases[1]!.id).reasons).toEqual(expect.arrayContaining(["OVER_PER_PAYMENT_CAP", "PRICE_ANOMALY"]));
  });

  it("throws QUOTE_NOT_FOUND for an unknown quote", () => {
    expect(() => precheck(fresh().ctx, "qte_missing")).toThrow("QUOTE_NOT_FOUND");
  });
});

describe("T4: approval flow (issuePermitAfterApproval)", () => {
  // autoApproveCap 20000 (helpers.draft); 25000 is under perPaymentCap and inside quickcast's anomaly band.
  function awaiting(fx: Fx) {
    const { mandate, run } = setup(fx);
    const { purchase, quote } = propose(fx, run.id, "25000");
    const r = authorize(fx.ctx, purchase.id);
    expect(r.kind).toBe("NEEDS_APPROVAL");
    expect(stateOf(fx, purchase.id)).toBe("AWAITING_APPROVAL");
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "25000" });
    return { mandate, run, purchase, quote };
  }

  it("happy path: PERMIT, RESERVED, reservation not doubled, approval consumed, reuse rejected", () => {
    const fx = fresh();
    const { mandate, purchase } = awaiting(fx);
    const a = approval(fx, purchase.purchaseHash);
    const r = issuePermitAfterApproval(fx.ctx, purchase.id, a);
    if (r.kind !== "PERMIT") throw new Error(`expected PERMIT, got ${JSON.stringify(r)}`);
    expect(stateOf(fx, purchase.id)).toBe("RESERVED");
    expect(getPurchase(fx.ctx, purchase.id)!.approvalId).toBe(a);
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "25000" });
    expect(consumedAt(fx, a)).toBe(iso(START));
    expectPermitMatches(fx, r.permit, purchase.id);
    // T3: same approval again on the same purchase.
    expect(() => issuePermitAfterApproval(fx.ctx, purchase.id, a)).toThrow("PURCHASE_NOT_AWAITING_APPROVAL");
  });

  it("T3: a consumed approval is rejected for another awaiting purchase, which is released", () => {
    const fx = fresh();
    const { mandate, run, purchase } = awaiting(fx);
    const a = approval(fx, purchase.purchaseHash);
    expect(issuePermitAfterApproval(fx.ctx, purchase.id, a).kind).toBe("PERMIT");
    const other = proposePurchase(fx.ctx, recordQuote(fx.ctx, run.id, quoteInput({ requestHash: "rh_2", amountAtomic: "25000" })).id, decision());
    expect(authorize(fx.ctx, other.id).kind).toBe("NEEDS_APPROVAL");
    expect(budget(fx, mandate).reserved).toBe("50000");
    expect(issuePermitAfterApproval(fx.ctx, other.id, a)).toEqual({ kind: "DENIED", reason: "APPROVAL_CONSUMED" });
    expect(stateOf(fx, other.id)).toBe("APPROVAL_DENIED");
    expect(budget(fx, mandate).reserved).toBe("25000");
  });

  it("T4: quote payTo changed after approval -> DENIED QUOTE_CHANGED, released, approval not consumed", () => {
    const fx = fresh();
    const { mandate, purchase, quote } = awaiting(fx);
    const a = approval(fx, purchase.purchaseHash);
    fx.ctx.db.prepare("UPDATE quotes SET pay_to = '0.0.6666' WHERE id = ?").run(quote.id);
    expect(issuePermitAfterApproval(fx.ctx, purchase.id, a)).toEqual({ kind: "DENIED", reason: "QUOTE_CHANGED" });
    expect(stateOf(fx, purchase.id)).toBe("APPROVAL_DENIED");
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "0" });
    expect(consumedAt(fx, a)).toBeNull();
    const audit = fx.ctx.db.prepare("SELECT type FROM audit_events ORDER BY seq").all() as { type: string }[];
    expect(audit.map((r) => r.type)).toEqual(["PURCHASE_DECIDED", "APPROVAL_DENIED"]);
  });

  // Regression: transition() used to release the *current* quotes.amount; the amount is now pinned on the purchase.
  it("T4: quote amount changed after approval -> DENIED QUOTE_CHANGED, released to 0", () => {
    const fx = fresh();
    const { mandate, purchase, quote } = awaiting(fx);
    const a = approval(fx, purchase.purchaseHash);
    fx.ctx.db.prepare("UPDATE quotes SET amount = '26000' WHERE id = ?").run(quote.id);
    expect(issuePermitAfterApproval(fx.ctx, purchase.id, a)).toEqual({ kind: "DENIED", reason: "QUOTE_CHANGED" });
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "0" });
  });

  const denials: [string, (fx: Fx, target: string) => string, string][] = [
    ["a DENIED approval", (fx, t) => approval(fx, t, { decision: "DENIED" }), "APPROVAL_NOT_APPROVED"],
    ["an expired approval", (fx, t) => approval(fx, t, { expiresAt: iso(fx.clock.t) }), "APPROVAL_EXPIRED"],
    ["a wrong-target approval", (fx) => approval(fx, "f".repeat(64)), "TARGET_MISMATCH"],
  ];
  for (const [name, make, reason] of denials) {
    it(`denies ${name} with ${reason} and releases the reservation`, () => {
      const fx = fresh();
      const { mandate, purchase } = awaiting(fx);
      const a = make(fx, purchase.purchaseHash);
      expect(issuePermitAfterApproval(fx.ctx, purchase.id, a)).toEqual({ kind: "DENIED", reason });
      const p = getPurchase(fx.ctx, purchase.id)!;
      expect(p.state).toBe("APPROVAL_DENIED");
      expect(p.permitId).toBeUndefined();
      expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "0" });
      expect(consumedAt(fx, a)).toBeNull();
    });
  }
});

describe("T5: concurrency", () => {
  it("20 concurrent authorize calls against a budget that fits 3 -> exactly 3 permits", async () => {
    const N = 20;
    const fx = fresh();
    const mandate = activeMandate(fx, { totalBudgetAtomic: "30000", perPaymentCapAtomic: "10000", autoApproveCapAtomic: "10000" });
    const ids: string[] = [];
    for (let i = 0; i < N; i++) {
      const run = createRun(fx.ctx, USER, `q${i}`);
      const q = recordQuote(fx.ctx, run.id, quoteInput({ requestHash: `rh_${i}`, amountAtomic: "10000" }));
      ids.push(proposePurchase(fx.ctx, q.id, decision()).id);
    }

    const gate = new SharedArrayBuffer(4);
    const flag = new Int32Array(gate);
    const env: Record<string, string> = { ...ENV, AGENT_ACCOUNT_ID: "0.0.2000" };
    const workers = ids.map((purchaseId) => new Worker(new URL("./fixtures/authorize-worker.ts", import.meta.url), {
      workerData: { dbPath: fx.path, env, purchaseId, nowIso: iso(fx.clock.t), gate } satisfies WorkerIn,
      execArgv: ["--import", "tsx"],
    }));
    let arrived = 0;
    const arrive = (): void => {
      if (++arrived === N) { Atomics.store(flag, 0, 1); Atomics.notify(flag, 0); } // release all at once
    };
    let out: WorkerOut[];
    try {
      out = await Promise.all(workers.map((w) => new Promise<WorkerOut>((resolve, reject) => {
        w.on("message", (m: WorkerOut) => {
          if ("kind" in m && m.kind === "ready") return arrive();
          if ("error" in m) arrive();
          resolve(m);
        });
        w.on("error", (e) => { arrive(); reject(e); });
        w.on("exit", (code) => { if (code !== 0) reject(new Error(`worker exited ${code}`)); });
      })));
    } finally {
      await Promise.all(workers.map((w) => w.terminate()));
    }

    expect(out.filter((m) => "error" in m)).toEqual([]);
    const kinds = out.map((m) => ("kind" in m ? m.kind : "error"));
    const permits = out.flatMap((m) => ("permitId" in m && m.permitId ? [m.permitId] : []));
    console.log(`T5: PERMIT=${kinds.filter((k) => k === "PERMIT").length} REJECTED=${kinds.filter((k) => k === "REJECTED").length}`);
    expect(kinds.filter((k) => k === "PERMIT")).toHaveLength(3);
    expect(kinds.filter((k) => k === "REJECTED")).toHaveLength(17);
    expect(new Set(permits).size).toBe(3);

    const m = fx.ctx.db.prepare("SELECT spent, reserved, total_budget FROM mandates WHERE id = ?").get(mandate.id) as
      { spent: string; reserved: string; total_budget: string };
    expect(m.reserved).toBe("30000");
    expect(BigInt(m.spent) + BigInt(m.reserved) <= BigInt(m.total_budget)).toBe(true);
    const states = ids.map((id) => getPurchase(fx.ctx, id)!);
    expect(states.filter((p) => p.state === "RESERVED")).toHaveLength(3);
    expect(states.filter((p) => p.state === "POLICY_REJECTED")).toHaveLength(17);
    expect(states.flatMap((p) => (p.permitId ? [p.permitId] : [])).sort()).toEqual([...permits].sort());
    const audits = fx.ctx.db.prepare("SELECT prev_hash, hash FROM audit_events ORDER BY seq").all() as { prev_hash: string; hash: string }[];
    expect(audits).toHaveLength(N);
    audits.forEach((r, i) => expect(r.prev_hash).toBe(i === 0 ? "0".repeat(64) : audits[i - 1]!.hash));
  }, 30_000);
});
