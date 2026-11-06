// Audit outbox insert (SPEC §8.6). The publishing worker arrives in a later prompt.
import { canonicalJson, newId, sha256Hex, type AuditEvent, type AuditEventType, type AuditPayload } from "@tollbooth/contracts";
import type { Ctx } from "./db";

/**
 * Appends one hash-chained event. Call it inside the transaction of the state change it describes; it nests as a
 * savepoint there (and is still atomic if called alone). Fields must hold no question text, preferences or World ids.
 */
export function appendAudit(
  ctx: Ctx, type: AuditEventType, fields: Omit<AuditPayload, "v" | "type" | "id" | "prev" | "ts">,
): AuditEvent {
  return ctx.db.transaction(() => {
    const last = ctx.db.prepare("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
    const prev = last?.hash ?? "0".repeat(64);
    const id = newId("evt_");
    const payload: AuditPayload = { v: 1, type, id, ...fields, prev, ts: ctx.now().toISOString() };
    const body = canonicalJson(payload);
    const hash = sha256Hex(body);
    ctx.db.prepare("INSERT INTO audit_events (id, type, payload, prev_hash, hash, state, attempts) VALUES (?, ?, ?, ?, ?, 'PENDING', 0)")
      .run(id, type, body, prev, hash);
    return { id, type, payload, prevHash: prev, hash, state: "PENDING" as const, attempts: 0 };
  }).immediate();
}
