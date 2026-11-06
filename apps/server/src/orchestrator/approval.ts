import { HttpError } from "../errors.js";
import { owner } from "./context.js";
import type { OrchContext } from "./context.js";
import { executePurchase } from "./purchase.js";

/**
 * POST /api/purchases/:id/approve. Starts the World step-up and a short server-side poll loop
 * (default every 2 s) that stops on any terminal result. On VERIFIED it fetches the one-time permit and pays.
 */
export async function approvePurchase(ctx: OrchContext, userId: string, purchaseId: string) {
  const { trust } = ctx.deps;
  const idx = ctx.purchases.get(purchaseId);
  if (!idx || owner(ctx,"purchase",purchaseId) !== userId) throw new HttpError(404, "NOT_FOUND", "purchase not found");
  const p = trust.getRunView(idx.runId).purchases.find((x) => x.id === purchaseId);
  if (p?.state !== "AWAITING_APPROVAL") throw new HttpError(409, "INVALID_STATE", `purchase is ${p?.state ?? "unknown"}, not AWAITING_APPROVAL`);

  let attempt;
  try {
    attempt = await trust.startAuth(userId, "APPROVE_PURCHASE", purchaseId);
  } catch (e) {
    throw new HttpError(409, "INVALID_STATE", e instanceof Error ? e.message : "cannot start approval");
  }
  ctx.attemptOwner.set(attempt.id, userId);
  ctx.track(pollLoop(ctx, attempt.id, purchaseId, idx.runId));
  return attempt;
}

async function pollLoop(ctx: OrchContext, attemptId: string, purchaseId: string, runId: string): Promise<void> {
  const { trust } = ctx.deps;
  const emit = () => ctx.bus.emit({ runId, kind: "purchase", entityId: purchaseId });
  while (!ctx.stopped) {
    try {
      const a = await trust.pollAuth(attemptId);
      if (a.result !== "PENDING") {
        if (a.result === "VERIFIED") {
          const permit = trust.getPermitForPurchase(purchaseId);
          if (permit) await executePurchase(ctx, purchaseId, permit);
          // null: permit already taken or not issued; leave the purchase alone, the read model shows its state.
        }
        emit();
        return;
      }
    } catch (e) {
      console.error("[orchestrator] approval poll failed:", e instanceof Error ? e.message : e);
      return;
    }
    await new Promise((r) => setTimeout(r, ctx.approvalPollMs).unref());
  }
}
