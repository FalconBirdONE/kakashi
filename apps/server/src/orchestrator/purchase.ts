import type { SigningPermit as Permit } from "@tollbooth/contracts";
import type { OrchContext } from "./context.js";
import { planQuery } from "./util.js";

/**
 * SPEC §8.4 steps 4-7. Persists the tx id (SIGNED) before anything is sent and never signs twice.
 * Never throws: any unexpected failure after signing leaves the purchase for reconciliation.
 */
export async function executePurchase(ctx: OrchContext, purchaseId: string, permit: Permit): Promise<void> {
  const { rails, trust } = ctx.deps;
  const idx = ctx.purchases.get(purchaseId);
  if (!idx || ctx.inflight.has(purchaseId)) return;
  ctx.inflight.add(purchaseId);
  const emit = () => ctx.bus.emit({ runId: idx.runId, kind: "purchase", entityId: purchaseId });
  try {
    const view = trust.getRunView(idx.runId);
    const purchase = view.purchases.find((p) => p.id === purchaseId);
    const quote = view.quotes.find((q) => q.id === purchase?.quoteId);
    if (!purchase || !quote || purchase.state !== "RESERVED") return; // already handled: never sign twice

    const signed = await rails.signPayment(permit, quote.rawRequirements);
    if (!signed.ok) {
      // Nothing was signed, so releasing the reservation is safe.
      trust.transition(purchaseId, "FAILED_FINAL");
      emit();
      return;
    }
    trust.transition(purchaseId, "SIGNED", { hederaTxId: signed.hederaTxId }); // saved before the request goes out
    trust.transition(purchaseId, "SUBMITTED");
    emit();

    let res: Awaited<ReturnType<typeof rails.submitPaidRequest>>;
    try {
      res = await rails.submitPaidRequest(quote, signed.paymentHeader);
    } catch {
      res = { outcome: "NO_RESPONSE" };
    }

    if (res.outcome === "SETTLED" && res.settlement?.transaction === signed.hederaTxId) {
      trust.transition(purchaseId, "CONFIRMED", { settlement: res.settlement });
      ctx.evidence.set(purchaseId, res.body);
      const v = rails.validateDelivery(quote.merchantId, planQuery(view), res.body);
      trust.setDelivery(purchaseId, v.valid ? "RECEIVED_VALID" : "RECEIVED_INVALID", v.issues);
    } else if (res.outcome === "SETTLED" || res.outcome === "NO_RESPONSE") {
      // Settled with a mismatching tx id, or no answer: the outcome is unproven. Reconciliation resolves it.
      trust.transition(purchaseId, "UNKNOWN");
    }
    // REJECTED: stays SUBMITTED; reconciliation (mirror node) finalizes it.
    emit();
  } catch (e) {
    console.error("[orchestrator] executePurchase failed:", e instanceof Error ? e.message : e);
  } finally {
    ctx.inflight.delete(purchaseId);
  }
}
