// Quotes, purchases (SPEC §7.3 state machine + §8.4 budget effects) and 0G inference records.
import {
  IllegalTransitionError, addA, canTransition, canonicalJson, cmpA, newId, sha256Hex, subA,
  type AgentDecision, type DeliveryState, type InferenceCall, type Purchase, type PurchaseState, type Quote,
} from "@tollbooth/contracts";
import type { Ctx } from "./db";
import { refreshMandate } from "./mandates";
import { inferenceOf, purchaseOf, quoteOf, toJson } from "./rows";

type Row = Record<string, any>;

/** Trust is authoritative for quoteHash: excludes id, runId, rawRequirements and timestamps. */
export function computeQuoteHash(q: Omit<Quote, "id" | "runId" | "quoteHash"> & { quoteHash?: string }): string {
  return sha256Hex(canonicalJson({
    merchantId: q.merchantId, method: q.method, origin: q.origin, path: q.path, requestHash: q.requestHash,
    network: q.network, assetId: q.assetId, amountAtomic: q.amountAtomic, payTo: q.payTo,
    facilitatorUrl: q.facilitatorUrl, feePayer: q.feePayer, maxTimeoutSeconds: q.maxTimeoutSeconds,
  }));
}

const runRow = (ctx: Ctx, runId: string) => ctx.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Row | undefined;

export function recordQuote(ctx: Ctx, runId: string, q: Omit<Quote, "id" | "runId">): Quote {
  if (!runRow(ctx, runId)) throw new Error("RUN_NOT_FOUND");
  const id = newId("qte_");
  const quoteHash = computeQuoteHash(q);
  ctx.db.prepare(
    `INSERT INTO quotes (id, run_id, merchant_id, method, origin, path, request_hash, network, asset_id, amount, pay_to,
       facilitator_url, fee_payer, max_timeout_seconds, raw_requirements, received_at, local_expires_at, quote_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, runId, q.merchantId, q.method, q.origin, q.path, q.requestHash, q.network, q.assetId, q.amountAtomic, q.payTo,
    q.facilitatorUrl, q.feePayer, q.maxTimeoutSeconds, q.rawRequirements, q.receivedAt, q.localExpiresAt, quoteHash);
  return getQuote(ctx, id)!;
}

export function getQuote(ctx: Ctx, id: string): Quote | null {
  const r = ctx.db.prepare("SELECT * FROM quotes WHERE id = ?").get(id) as Row | undefined;
  return r ? quoteOf(r) : null;
}

export function getPurchase(ctx: Ctx, id: string): Purchase | null {
  const r = ctx.db.prepare("SELECT * FROM purchases WHERE id = ?").get(id) as Row | undefined;
  return r ? purchaseOf(r) : null;
}

export function proposePurchase(ctx: Ctx, quoteId: string, decision: AgentDecision): Purchase {
  const q = ctx.db.prepare("SELECT * FROM quotes WHERE id = ?").get(quoteId) as Row | undefined;
  if (!q) throw new Error("QUOTE_NOT_FOUND");
  const run = runRow(ctx, q.run_id)!;
  const id = newId("pur_");
  const purchaseHash = sha256Hex(canonicalJson({
    purchaseId: id, quoteHash: q.quote_hash, amountAtomic: q.amount, payTo: q.pay_to, mandateVersion: run.mandate_version,
  }));
  const now = ctx.now().toISOString();
  try {
    ctx.db.prepare(
      `INSERT INTO purchases (id, run_id, quote_id, quote_hash, mandate_id, mandate_version, state, delivery, decision,
         purchase_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,'PROPOSED','NOT_RECEIVED',?,?,?,?)`,
    ).run(id, q.run_id, quoteId, q.quote_hash, run.mandate_id, run.mandate_version, toJson(decision), purchaseHash, now, now);
  } catch (e: any) {
    if (typeof e?.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT_UNIQUE")) {
      throw new Error(`DUPLICATE_PURCHASE: quote ${quoteId} already has a purchase in run ${q.run_id}`);
    }
    throw e;
  }
  return getPurchase(ctx, id)!;
}

const FORBIDDEN = ["id", "runId", "quoteId", "quoteHash", "mandateId", "mandateVersion", "state", "purchaseHash", "createdAt", "updatedAt"];
const PATCH_COLUMNS: Record<string, string> = {
  delivery: "delivery", policyResult: "policy_result", decision: "decision", approvalId: "approval_id",
  permitId: "permit_id", hederaTxId: "hedera_tx_id", settlement: "settlement", deliveryIssues: "delivery_issues",
};

export function transition(ctx: Ctx, purchaseId: string, to: PurchaseState, data: Partial<Purchase> = {}): Purchase {
  for (const k of Object.keys(data)) if (FORBIDDEN.includes(k)) throw new Error(`FORBIDDEN_FIELD: ${k}`);
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const col = PATCH_COLUMNS[k];
    if (!col) throw new Error(`FORBIDDEN_FIELD: ${k}`);
    cols.push(`${col} = ?`);
    vals.push(typeof v === "object" ? toJson(v) : v);
  }

  const { mandateId, mandateVersion, updated } = ctx.db.transaction(() => {
    const p = ctx.db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchaseId) as Row | undefined;
    if (!p) throw new Error("PURCHASE_NOT_FOUND");
    const from = p.state as PurchaseState;
    if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
    if (to === "SIGNED" && !(data.hederaTxId ?? p.hedera_tx_id)) throw new Error("MISSING_TX_ID");

    const amount: string = (ctx.db.prepare("SELECT amount FROM quotes WHERE id = ?").get(p.quote_id) as Row).amount;
    const m = ctx.db.prepare("SELECT * FROM mandates WHERE id = ? AND version = ?").get(p.mandate_id, p.mandate_version) as Row;
    let spent: string = m.spent;
    let reserved: string = m.reserved;
    if (from === "PROPOSED" && (to === "RESERVED" || to === "AWAITING_APPROVAL")) {
      if (cmpA(addA(addA(spent, reserved), amount), m.total_budget) === 1) throw new Error("OVER_BUDGET");
      reserved = addA(reserved, amount);
    } else if (to === "CONFIRMED") {
      reserved = subA(reserved, amount);
      spent = addA(spent, amount);
    } else if (to === "APPROVAL_DENIED" || to === "FAILED_FINAL") {
      reserved = subA(reserved, amount);
    }
    // Not guarded by from-state: FAILED_FINAL from RESERVED/SIGNED/SUBMITTED/UNKNOWN always holds a reservation;
    // APPROVAL_DENIED only comes from AWAITING_APPROVAL, which holds one too.
    if (reserved !== m.reserved || spent !== m.spent) {
      ctx.db.prepare("UPDATE mandates SET spent = ?, reserved = ? WHERE id = ? AND version = ?")
        .run(spent, reserved, p.mandate_id, p.mandate_version);
    }
    ctx.db.prepare(`UPDATE purchases SET state = ?, updated_at = ?${cols.map((c) => `, ${c}`).join("")} WHERE id = ?`)
      .run(to, ctx.now().toISOString(), ...vals, purchaseId);
    return { mandateId: p.mandate_id as string, mandateVersion: p.mandate_version as number, updated: getPurchase(ctx, purchaseId)! };
  }).immediate();

  refreshMandate(ctx, mandateId, mandateVersion);
  return updated;
}

export function setDelivery(ctx: Ctx, purchaseId: string, d: DeliveryState, issues?: string[]): void {
  const r = ctx.db.prepare("UPDATE purchases SET delivery = ?, delivery_issues = ?, updated_at = ? WHERE id = ?")
    .run(d, toJson(issues), ctx.now().toISOString(), purchaseId);
  if (r.changes === 0) throw new Error("PURCHASE_NOT_FOUND");
}

export function listUnresolved(ctx: Ctx): Purchase[] {
  return (ctx.db.prepare(
    "SELECT * FROM purchases WHERE state IN ('SIGNED','SUBMITTED','UNKNOWN') ORDER BY created_at ASC, id ASC",
  ).all() as Row[]).map(purchaseOf);
}

export function recordInference(ctx: Ctx, c: Omit<InferenceCall, "id">): InferenceCall {
  if (!/^\d+(\.\d+)?$/.test(c.totalCost)) throw new Error("INVALID_COST");
  if (!runRow(ctx, c.runId)) throw new Error("RUN_NOT_FOUND");
  const id = newId("inf_");
  ctx.db.prepare(
    `INSERT INTO inference_calls (id, run_id, kind, model, trust_tier, zg_request_id, provider, tee_verified, total_cost,
       latency_ms, input_hash, output_hash, ok, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, c.runId, c.kind, c.model, c.trustTier, c.zgRequestId, c.provider, c.teeVerified == null ? null : c.teeVerified ? 1 : 0,
    c.totalCost, c.latencyMs, c.inputHash, c.outputHash, c.ok ? 1 : 0, c.error ?? null, ctx.now().toISOString());
  const r = ctx.db.prepare("SELECT * FROM inference_calls WHERE id = ?").get(id) as Row;
  return inferenceOf(r);
}
