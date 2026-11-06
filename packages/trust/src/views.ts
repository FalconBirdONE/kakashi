import { addA, subA, type LedgerView, type Mandate, type RunView } from "@tollbooth/contracts";
import type { Ctx } from "./db";
import { refreshMandate } from "./mandates";
import { inferenceOf, mandateOf, purchaseOf, quoteOf } from "./rows";
import { getRun } from "./runs";

export function getRunView(ctx: Ctx, runId: string): RunView {
  const run = getRun(ctx, runId);
  if (!run) throw new Error("RUN_NOT_FOUND");
  const all = (sql: string) => ctx.db.prepare(sql).all(runId) as Record<string, any>[];
  return {
    run,
    quotes: all("SELECT * FROM quotes WHERE run_id = ? ORDER BY received_at, id").map(quoteOf),
    purchases: all("SELECT * FROM purchases WHERE run_id = ? ORDER BY created_at, id").map(purchaseOf),
    inferenceCalls: all("SELECT * FROM inference_calls WHERE run_id = ? ORDER BY created_at, id").map(inferenceOf),
  };
}

/** Exact decimal sum over the string digits (scaled BigInt); trailing zeros trimmed; "0" when empty. */
function addDecimals(xs: string[]): string {
  const parts = xs.map((x) => {
    const m = /^(\d+)(?:\.(\d+))?$/.exec(x);
    if (!m) throw new Error(`invalid decimal amount: ${x}`);
    return { i: m[1]!, f: m[2] ?? "" };
  });
  const scale = Math.max(0, ...parts.map((p) => p.f.length));
  const sum = parts.reduce((s, p) => s + BigInt(p.i + p.f.padEnd(scale, "0")), 0n);
  const s = sum.toString().padStart(scale + 1, "0");
  const frac = s.slice(s.length - scale).replace(/0+$/, "");
  return frac ? `${s.slice(0, s.length - scale)}.${frac}` : s.slice(0, s.length - scale);
}

export function getLedgerView(ctx: Ctx, userId: string): LedgerView {
  const rows = (ctx.db.prepare("SELECT * FROM mandates WHERE user_id = ? ORDER BY created_at DESC, version DESC").all(userId) as Record<string, any>[]).map(mandateOf);
  const picked: Mandate | undefined = rows.find((m) => m.state === "ACTIVE" || m.state === "EXHAUSTED") ?? rows[0];
  if (!picked) {
    return { mandate: null, limitAtomic: "0", spentAtomic: "0", reservedAtomic: "0", availableAtomic: "0", dataSpendAtomic: "0", inferenceSpend: "0", receipts: [] };
  }
  const mandate = refreshMandate(ctx, picked.id, picked.version);

  const confirmed = ctx.db
    .prepare(
      `SELECT p.id AS purchase_id, p.hedera_tx_id, p.updated_at, p.decision, q.merchant_id, q.amount
       FROM purchases p JOIN quotes q ON q.id = p.quote_id
       WHERE p.mandate_id = ? AND p.state = 'CONFIRMED' ORDER BY p.updated_at, p.id`,
    )
    .all(mandate.id) as { purchase_id: string; hedera_tx_id: string; updated_at: string; decision: string | null; merchant_id: string; amount: string }[];

  const zgOf = ctx.db.prepare("SELECT zg_request_id FROM inference_calls WHERE id = ?");
  const receipts = confirmed.map((r) => {
    const infId: string | undefined = r.decision ? JSON.parse(r.decision).inferenceCallId : undefined;
    const zg = infId ? (zgOf.get(infId) as { zg_request_id: string } | undefined)?.zg_request_id : undefined;
    return {
      purchaseId: r.purchase_id, merchantId: r.merchant_id, amountAtomic: r.amount, hederaTxId: r.hedera_tx_id,
      ...(zg && { zgRequestId: zg }), at: r.updated_at,
    };
  });

  // 0G credits, not counted against the mandate.
  const costs = (ctx.db
    .prepare("SELECT i.total_cost FROM inference_calls i JOIN runs r ON r.id = i.run_id WHERE r.user_id = ?")
    .all(userId) as { total_cost: string }[]).map((r) => r.total_cost);

  return {
    mandate,
    limitAtomic: mandate.totalBudgetAtomic,
    spentAtomic: mandate.spentAtomic,
    reservedAtomic: mandate.reservedAtomic,
    availableAtomic: subA(subA(mandate.totalBudgetAtomic, mandate.spentAtomic), mandate.reservedAtomic),
    dataSpendAtomic: receipts.reduce((s, r) => addA(s, r.amountAtomic), "0"),
    inferenceSpend: addDecimals(costs),
    receipts,
  };
}
