import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, newId, sha256Hex, type AuditEventType } from "@kakashi/contracts";
import {
  appendAuditEvent, listPendingAudit, markAnchored, markAuditRetry, verifyAuditChain, type AuditFields,
} from "../src/outbox";
import { TX, cleanup, makeFx, type Fx } from "./helpers";

afterEach(cleanup);

const TYPES: AuditEventType[] = [
  "MANDATE_ACTIVATED", "MANDATE_REVOKED", "PURCHASE_DECIDED", "APPROVAL_GRANTED", "APPROVAL_DENIED",
  "PURCHASE_CONFIRMED", "PURCHASE_FAILED", "DELIVERY_RESULT", "RUN_COMPLETED",
];
const H = sha256Hex("h");

const append = (fx: Fx, type: AuditEventType = "RUN_COMPLETED", fields: AuditFields = {}) =>
  fx.ctx.db.transaction(() => appendAuditEvent(fx.ctx, type, fields))();
const count = (fx: Fx) => (fx.ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number }).n;
const anchor = { topicId: "0.0.5005", sequenceNumber: 7, consensusTimestamp: "1893456000.000000001" };

describe("outbox hash chain (T9)", () => {
  it("chains 50 mixed events, recomputes, and detects tampering", () => {
    const fx = makeFx();
    const events = Array.from({ length: 50 }, (_, i) => {
      fx.advance(1000);
      return append(fx, TYPES[i % TYPES.length]!, {
        run: newId("run_"), pur: newId("pur_"), mandateHash: H, quoteHash: H, decisionHash: H, tx: TX, zg: `zg-${i}`,
      });
    });
    const rows = fx.ctx.db.prepare("SELECT * FROM audit_events ORDER BY seq").all() as
      { seq: number; id: string; type: AuditEventType; payload: string; prev_hash: string; hash: string }[];
    expect(rows).toHaveLength(50);
    let prev = "0".repeat(64);
    rows.forEach((r, i) => {
      expect(r.prev_hash).toBe(prev);
      const payload = JSON.parse(r.payload) as { prev: string };
      expect(payload.prev).toBe(prev);
      expect(r.hash).toBe(sha256Hex(canonicalJson({ prevHash: r.prev_hash, type: r.type, payload, id: r.id })));
      expect(r.hash).toBe(events[i]!.hash);
      prev = r.hash;
    });
    expect(verifyAuditChain(fx.ctx)).toEqual({ ok: true, count: 50 });

    const victim = rows[20]!;
    const forged = victim.payload.replace(/"zg":"zg-20"/, '"zg":"zg-XX"');
    expect(forged).not.toBe(victim.payload);
    fx.ctx.db.prepare("UPDATE audit_events SET payload=? WHERE seq=?").run(forged, victim.seq);
    expect(verifyAuditChain(fx.ctx)).toEqual({ ok: false, brokenAtSeq: victim.seq });
  });

  it("refuses to append outside a transaction", () => {
    const fx = makeFx();
    expect(() => appendAuditEvent(fx.ctx, "RUN_COMPLETED", {})).toThrow("AUDIT_OUTSIDE_TRANSACTION");
    expect(count(fx)).toBe(0);
  });

  it("rolls back with the caller's transaction", () => {
    const fx = makeFx();
    expect(() => fx.ctx.db.transaction(() => {
      appendAuditEvent(fx.ctx, "RUN_COMPLETED", {});
      throw new Error("boom");
    })()).toThrow("boom");
    expect(count(fx)).toBe(0);
  });
});

describe("no personal data", () => {
  it.each(["question", "preferences", "sub", "iss", "token", "idToken", "text"])("rejects key %s", (k) => {
    const fx = makeFx();
    expect(() => append(fx, "RUN_COMPLETED", { [k]: "x" } as AuditFields)).toThrow(`AUDIT_PAYLOAD_REJECTED: ${k}`);
    expect(count(fx)).toBe(0);
  });

  it.each<[keyof AuditFields, unknown]>([
    ["run", "what is the weather in Mumbai?"],
    ["pur", "pur_abc"],
    ["mandateHash", "Z".repeat(64)],
    ["quoteHash", H.toUpperCase()],
    ["decisionHash", H.slice(1)],
    ["tx", "0.0.1"],
    ["zg", "a".repeat(2000)],
    ["zg", "has space"],
    ["run", 42],
  ])("rejects malformed %s", (k, v) => {
    const fx = makeFx();
    expect(() => append(fx, "RUN_COMPLETED", { [k]: v } as AuditFields)).toThrow(`AUDIT_PAYLOAD_REJECTED: ${k}`);
    expect(count(fx)).toBe(0);
  });

  it("accepts a dotted id in zg when it matches, and drops undefined values", () => {
    const fx = makeFx();
    const e = append(fx, "PURCHASE_CONFIRMED", { zg: "eyJh.eyJz.c2ln", run: undefined });
    expect(e.payload.zg).toBe("eyJh.eyJz.c2ln");
    expect("run" in e.payload).toBe(false);
    expect(Buffer.byteLength(canonicalJson(e.payload))).toBeLessThanOrEqual(1024);
  });
});

describe("listPendingAudit", () => {
  it("returns PENDING in seq order, clamps limit, excludes ANCHORED", () => {
    const fx = makeFx();
    const ids = Array.from({ length: 5 }, () => append(fx).id);
    expect(listPendingAudit(fx.ctx, 3).map((e) => e.id)).toEqual(ids.slice(0, 3));
    expect(listPendingAudit(fx.ctx, 0)).toHaveLength(1);
    expect(listPendingAudit(fx.ctx, 1000)).toHaveLength(5);
    markAnchored(fx.ctx, ids[1]!, anchor);
    expect(listPendingAudit(fx.ctx, 10).map((e) => e.id)).toEqual([ids[0], ids[2], ids[3], ids[4]]);
    const first = listPendingAudit(fx.ctx, 1)[0]!;
    expect(first).toMatchObject({ state: "PENDING", attempts: 0 });
    expect(first.topicId).toBeUndefined();
  });

  it("includes RETRYING only once due", () => {
    const fx = makeFx();
    const a = append(fx).id;
    const b = append(fx).id;
    markAuditRetry(fx.ctx, a);
    expect(listPendingAudit(fx.ctx, 10).map((e) => e.id)).toEqual([b]);
    fx.advance(1000);
    expect(listPendingAudit(fx.ctx, 10).map((e) => e.id)).toEqual([a, b]);
    expect(listPendingAudit(fx.ctx, 10)[0]).toMatchObject({ state: "RETRYING", attempts: 1 });
  });
});

describe("markAnchored", () => {
  it("anchors, is idempotent for the same values, rejects different values and unknown ids", () => {
    const fx = makeFx();
    const id = append(fx).id;
    markAnchored(fx.ctx, id, anchor);
    markAnchored(fx.ctx, id, anchor);
    expect(() => markAnchored(fx.ctx, id, { ...anchor, sequenceNumber: 8 })).toThrow("AUDIT_ALREADY_ANCHORED");
    expect(() => markAnchored(fx.ctx, id, { ...anchor, topicId: "0.0.1" })).toThrow("AUDIT_ALREADY_ANCHORED");
    expect(() => markAnchored(fx.ctx, "evt_missing", anchor)).toThrow("AUDIT_EVENT_NOT_FOUND");
    const row = fx.ctx.db.prepare("SELECT state, topic_id, sequence_number, consensus_timestamp FROM audit_events WHERE id=?").get(id);
    expect(row).toEqual({ state: "ANCHORED", topic_id: "0.0.5005", sequence_number: 7, consensus_timestamp: "1893456000.000000001" });
  });

  it("anchors a RETRYING event", () => {
    const fx = makeFx();
    const id = append(fx).id;
    markAuditRetry(fx.ctx, id);
    markAnchored(fx.ctx, id, anchor);
    fx.advance(120_000);
    expect(listPendingAudit(fx.ctx, 10)).toEqual([]);
  });
});

describe("markAuditRetry", () => {
  it("backs off 1,2,4,8,16,32,60,60 seconds", () => {
    const fx = makeFx();
    const id = append(fx).id;
    for (const [i, secs] of [1, 2, 4, 8, 16, 32, 60, 60].entries()) {
      markAuditRetry(fx.ctx, id);
      const r = fx.ctx.db.prepare("SELECT attempts, next_attempt_at FROM audit_events WHERE id=?").get(id) as
        { attempts: number; next_attempt_at: string };
      expect(r.attempts).toBe(i + 1);
      expect(Date.parse(r.next_attempt_at) - fx.clock.t).toBe(secs * 1000);
      fx.advance(secs * 1000 - 1);
      expect(listPendingAudit(fx.ctx, 10)).toEqual([]);
      fx.advance(1);
      expect(listPendingAudit(fx.ctx, 10).map((e) => e.id)).toEqual([id]);
    }
  });

  it("is a no-op on ANCHORED and throws on unknown ids", () => {
    const fx = makeFx();
    const id = append(fx).id;
    markAnchored(fx.ctx, id, anchor);
    markAuditRetry(fx.ctx, id);
    expect(fx.ctx.db.prepare("SELECT state, attempts FROM audit_events WHERE id=?").get(id)).toEqual({ state: "ANCHORED", attempts: 0 });
    expect(() => markAuditRetry(fx.ctx, "evt_missing")).toThrow("AUDIT_EVENT_NOT_FOUND");
  });
});
