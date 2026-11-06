import type { OrchContext } from "../orchestrator/context.js";

const BATCH = 10;
const MAX_BACKOFF_MS = 60_000;

export type AuditWorker = { tick(): Promise<void>; stop(): void };

/**
 * SPEC §8.6 outbox publisher. Publishes strictly in order: after a failure the rest of the batch
 * waits, so anchored order always matches chain order. Runs separately from payments and never throws.
 */
export function createAuditWorker(
  ctx: OrchContext,
  opts: { intervalMs?: number; now?: () => number; autoStart?: boolean } = {},
): AuditWorker {
  const { trust, rails } = ctx.deps;
  const now = opts.now ?? Date.now;
  const nextAt = new Map<string, number>(); // eventId -> earliest retry time
  let running = false;

  async function tick(): Promise<void> {
    if (running) return; // overlapping ticks would double-publish
    running = true;
    try {
      for (const e of trust.listPendingAudit(BATCH)) {
        if ((nextAt.get(e.id) ?? 0) > now()) return; // head of line is backing off; keep order
        try {
          const r = await rails.publishAudit({ id: e.id, json: JSON.stringify(e.payload) });
          trust.markAnchored(e.id, r);
          if (e.payload.pur) ctx.audit.set(e.payload.pur, { sequenceNumber: r.sequenceNumber, topicId: r.topicId });
          nextAt.delete(e.id);
        } catch {
          trust.markAuditRetry(e.id);
          nextAt.set(e.id, now() + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(e.attempts, 10)));
          return;
        }
      }
    } catch (err) {
      console.error("[audit] error:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }

  let timer: NodeJS.Timeout | undefined;
  if (opts.autoStart !== false) {
    timer = setInterval(() => void tick(), opts.intervalMs ?? 2000);
    timer.unref();
  }
  return { tick, stop: () => timer && clearInterval(timer) };
}
