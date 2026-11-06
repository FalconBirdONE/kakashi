import type { OrchContext } from "./context.js";

/** PENDING: an audit event for this purchase is not anchored yet. UNKNOWN: nothing tracked (e.g. after a restart). */
export type AuditStatus = { state: "PENDING" | "ANCHORED" | "UNKNOWN"; sequenceNumber?: number; topicId?: string };

export function auditStatuses(ctx: OrchContext, purchaseIds: string[]): Record<string, AuditStatus> {
  const pending = new Set(ctx.deps.trust.listPendingAudit(1000).map((e) => e.payload.pur).filter(Boolean));
  const out: Record<string, AuditStatus> = {};
  for (const id of purchaseIds) {
    const a = ctx.audit.get(id);
    out[id] = pending.has(id) ? { state: "PENDING" } : a ? { state: "ANCHORED", ...a } : { state: "UNKNOWN" };
  }
  return out;
}
