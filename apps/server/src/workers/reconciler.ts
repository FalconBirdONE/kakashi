import type { Purchase } from "@tollbooth/contracts";
import type { OrchContext } from "../orchestrator/context.js";
import { planQuery } from "../orchestrator/util.js";

const SETTLE_WAIT_MS = 20_000; // give an in-flight submit time to finish before asking the mirror node
const NOT_FOUND_GRACE_S = 30;

export type Reconciler = { tick(): Promise<void>; stop(): void };

/**
 * SPEC §8.5. Resolves SIGNED / SUBMITTED / UNKNOWN purchases from the mirror node. Never signs anything.
 * Ages are measured from updatedAt (the last transition), which is never earlier than signing,
 * so a NOT_FOUND purchase is never failed too early. ponytail: slightly late finalization for UNKNOWN.
 */
export function createReconciler(
  ctx: OrchContext,
  opts: { intervalMs?: number; now?: () => number; autoStart?: boolean } = {},
): Reconciler {
  const { trust, rails } = ctx.deps;
  const now = opts.now ?? Date.now;
  const busy = new Set<string>(); // in-process lock: one tick per purchase at a time

  async function handle(listed: Purchase): Promise<void> {
    // Re-read inside the lock: another tick (or the approval/execute path) may have moved it on.
    const view = trust.getRunView(listed.runId);
    const p = view.purchases.find((x) => x.id === listed.id);
    const q = view.quotes.find((x) => x.id === p?.quoteId);
    if (!p || !q || !p.hederaTxId) return;
    if (!["SIGNED", "SUBMITTED", "UNKNOWN"].includes(p.state)) return;
    const ageMs = now() - Date.parse(p.updatedAt);
    if (p.state !== "UNKNOWN" && ageMs < SETTLE_WAIT_MS) return;

    const emit = () => ctx.bus.emit({ runId: p.runId, kind: "purchase", entityId: p.id });
    const outcome = await rails.checkSettlement(p.hederaTxId, { payTo: q.payTo, assetId: q.assetId, amountAtomic: q.amountAtomic });

    if (outcome === "SUCCESS") {
      if (p.state === "SIGNED") trust.transition(p.id, "SUBMITTED"); // SIGNED cannot jump to CONFIRMED
      trust.transition(p.id, "CONFIRMED");
      emit();
      const rec = await rails.recoverDelivery(q.merchantId, p.hederaTxId, q.requestHash);
      if (rec.ok) {
        ctx.evidence.set(p.id, rec.body);
        const v = rails.validateDelivery(q.merchantId, planQuery(view), rec.body);
        trust.setDelivery(p.id, v.valid ? "RECOVERED" : "RECEIVED_INVALID", v.issues);
      } else {
        // ponytail: CONFIRMED purchases leave listUnresolved, so a failed recovery is not retried.
        trust.setDelivery(p.id, "NOT_RECEIVED", ["delivery recovery failed"]);
      }
      emit();
    } else if (outcome === "FAILED" || outcome === "MISMATCH") {
      trust.transition(p.id, "FAILED_FINAL");
      console.warn(`[reconciler] purchase ${p.id} settlement ${outcome}; released and flagged`);
      ctx.bus.emit({ runId: p.runId, kind: "flag", entityId: p.id });
      emit();
    } else if (ageMs > (q.maxTimeoutSeconds + NOT_FOUND_GRACE_S) * 1000) {
      // NOT_FOUND and the transaction can no longer land: prove-not-settled, release the reservation.
      trust.transition(p.id, "FAILED_FINAL");
      emit();
    }
    // NOT_FOUND before the deadline: leave as is.
  }

  async function tick(): Promise<void> {
    const todo = trust.listUnresolved().filter((p) => !busy.has(p.id) && !ctx.inflight.has(p.id));
    await Promise.all(todo.map(async (p) => {
      busy.add(p.id);
      try { await handle(p); }
      catch (e) { console.error("[reconciler] error:", e instanceof Error ? e.message : e); }
      finally { busy.delete(p.id); }
    }));
  }

  let timer: NodeJS.Timeout | undefined;
  if (opts.autoStart !== false) {
    void tick(); // once at startup
    timer = setInterval(() => void tick(), opts.intervalMs ?? 3000);
    timer.unref();
  }
  return { tick, stop: () => timer && clearInterval(timer) };
}
