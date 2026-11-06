// Audit outbox (SPEC §8.6): hash-chained append inside the caller's transaction, plus the worker-facing queue.
import { canonicalJson, newId, sha256Hex, type AuditEvent, type AuditEventType, type AuditPayload, type AuditState } from "@tollbooth/contracts";
import type { Ctx } from "./db";

export type AuditFields = Pick<AuditPayload, "run" | "pur" | "mandateHash" | "quoteHash" | "decisionHash" | "tx" | "zg">;

const ULID = "[0-9A-HJKMNP-TV-Z]{26}";
const HEX64 = /^[0-9a-f]{64}$/;
// Allow-list: anything else (question, preferences, sub, iss, token, ...) is personal data or unknown and is refused.
// Exported so values are validated where they are first stored: an event must never be what blocks a payment state change.
export const FORMATS: Record<keyof AuditFields, RegExp> = {
  run: new RegExp(`^run_${ULID}$`),
  pur: new RegExp(`^pur_${ULID}$`),
  mandateHash: HEX64, quoteHash: HEX64, decisionHash: HEX64,
  tx: /^\d+\.\d+\.\d+@\d+\.\d+$/,
  zg: /^[A-Za-z0-9._:-]{1,128}$/,
};
const MAX_PAYLOAD_BYTES = 1024;
const GENESIS = "0".repeat(64);

type AuditRow = {
  seq: number; id: string; type: AuditEventType; payload: string; prev_hash: string; hash: string; state: AuditState;
  topic_id: string | null; sequence_number: number | null; consensus_timestamp: string | null; attempts: number;
};

const hashOf = (prevHash: string, type: AuditEventType, payload: AuditPayload, id: string): string =>
  sha256Hex(canonicalJson({ prevHash, type, payload, id }));

const auditOf = (r: AuditRow): AuditEvent => ({
  id: r.id, type: r.type, payload: JSON.parse(r.payload) as AuditPayload, prevHash: r.prev_hash, hash: r.hash,
  state: r.state, attempts: r.attempts,
  ...(r.topic_id !== null && { topicId: r.topic_id }),
  ...(r.sequence_number !== null && { sequenceNumber: r.sequence_number }),
  ...(r.consensus_timestamp !== null && { consensusTimestamp: r.consensus_timestamp }),
});

const getRow = (ctx: Ctx, id: string): AuditRow => {
  const r = ctx.db.prepare("SELECT * FROM audit_events WHERE id = ?").get(id) as AuditRow | undefined;
  if (!r) throw new Error("AUDIT_EVENT_NOT_FOUND");
  return r;
};

/** Appends one hash-chained event. Must run inside the transaction of the state change it describes. */
export function appendAuditEvent(ctx: Ctx, type: AuditEventType, fields: AuditFields): AuditEvent {
  if (!ctx.db.inTransaction) throw new Error("AUDIT_OUTSIDE_TRANSACTION");
  const clean: AuditFields = {};
  for (const [k, v] of Object.entries(fields) as [string, unknown][]) {
    const re = (FORMATS as Record<string, RegExp | undefined>)[k];
    if (!re) throw new Error(`AUDIT_PAYLOAD_REJECTED: ${k}`);
    if (v === undefined) continue;
    if (typeof v !== "string" || !re.test(v)) throw new Error(`AUDIT_PAYLOAD_REJECTED: ${k}`);
    clean[k as keyof AuditFields] = v;
  }
  const last = ctx.db.prepare("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
  const prevHash = last?.hash ?? GENESIS;
  const id = newId("evt_");
  const payload: AuditPayload = { v: 1, type, id, ...clean, prev: prevHash, ts: ctx.now().toISOString() };
  const body = canonicalJson(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_PAYLOAD_BYTES) throw new Error("AUDIT_PAYLOAD_REJECTED: size");
  const hash = hashOf(prevHash, type, payload, id);
  ctx.db.prepare("INSERT INTO audit_events (id, type, payload, prev_hash, hash, state, attempts) VALUES (?, ?, ?, ?, ?, 'PENDING', 0)")
    .run(id, type, body, prevHash, hash);
  return { id, type, payload, prevHash, hash, state: "PENDING", attempts: 0 };
}

/** Due PENDING/RETRYING events in chain order. `limit` is clamped to 1..100. */
export function listPendingAudit(ctx: Ctx, limit: number): AuditEvent[] {
  const n = Math.min(100, Math.max(1, Math.floor(limit) || 1));
  const rows = ctx.db.prepare(
    `SELECT * FROM audit_events WHERE state IN ('PENDING','RETRYING') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
     ORDER BY seq LIMIT ?`,
  ).all(ctx.now().toISOString(), n) as AuditRow[];
  return rows.map(auditOf);
}

export function markAnchored(
  ctx: Ctx, eventId: string, r: { topicId: string; sequenceNumber: number; consensusTimestamp: string },
): void {
  const row = getRow(ctx, eventId);
  if (row.state === "ANCHORED") {
    const same = row.topic_id === r.topicId && row.sequence_number === r.sequenceNumber && row.consensus_timestamp === r.consensusTimestamp;
    if (same) return;
    throw new Error("AUDIT_ALREADY_ANCHORED");
  }
  ctx.db.prepare(
    "UPDATE audit_events SET state='ANCHORED', topic_id=?, sequence_number=?, consensus_timestamp=?, next_attempt_at=NULL WHERE id=?",
  ).run(r.topicId, r.sequenceNumber, r.consensusTimestamp, eventId);
}

/** Backoff after the n-th failure: min(60, 2^(n-1)) seconds. */
export function markAuditRetry(ctx: Ctx, eventId: string): void {
  const row = getRow(ctx, eventId);
  if (row.state === "ANCHORED") return;
  const attempts = row.attempts + 1;
  const next = new Date(ctx.now().getTime() + Math.min(60, 2 ** (attempts - 1)) * 1000).toISOString();
  ctx.db.prepare("UPDATE audit_events SET state='RETRYING', attempts=?, next_attempt_at=? WHERE id=?").run(attempts, next, eventId);
}

/** Recomputes every hash in seq order and checks the prev links (column and payload.prev). */
export function verifyAuditChain(ctx: Ctx): { ok: true; count: number } | { ok: false; brokenAtSeq: number } {
  let prev = GENESIS;
  let count = 0;
  for (const r of ctx.db.prepare("SELECT seq, id, type, payload, prev_hash, hash FROM audit_events ORDER BY seq").iterate() as IterableIterator<AuditRow>) {
    let payload: AuditPayload;
    try { payload = JSON.parse(r.payload) as AuditPayload; } catch { return { ok: false, brokenAtSeq: r.seq }; }
    if (r.prev_hash !== prev || payload.prev !== r.prev_hash || hashOf(r.prev_hash, r.type, payload, r.id) !== r.hash) {
      return { ok: false, brokenAtSeq: r.seq };
    }
    prev = r.hash;
    count++;
  }
  return { ok: true, count };
}
