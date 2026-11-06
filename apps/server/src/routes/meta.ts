import { Router } from "express";
import { addA } from "@tollbooth/contracts";
import { requireUser, userOf } from "../session.js";
import { auditStatuses } from "../orchestrator/audit.js";
import type { OrchContext } from "../orchestrator/context.js";

/** Public flags the UI needs: demo mode, and whether the dev "complete auth" route exists. */
export function configRoute(ctx: OrchContext, cfg: { demoMode: boolean }): Router {
  const r = Router();
  r.get("/config", (_req, res) => {
    res.json({ demoMode: cfg.demoMode, devAuth: cfg.demoMode && !!ctx.deps.fakes.trust, modes: ctx.deps.modes });
  });
  return r;
}

/** Every purchase of the session user with the fields receipts and history need. */
export function purchaseListRoute(ctx: OrchContext): Router {
  const r = Router();
  r.use(requireUser);
  r.get("/purchases", (_req, res) => {
    const mine = [...ctx.purchases.entries()].filter(([, v]) => v.userId === userOf(res));
    const views = new Map<string, ReturnType<typeof ctx.deps.trust.getRunView>>();
    const rows = mine.flatMap(([id, v]) => {
      if (!views.has(v.runId)) views.set(v.runId, ctx.deps.trust.getRunView(v.runId));
      const view = views.get(v.runId)!;
      const p = view.purchases.find((x) => x.id === id);
      const q = view.quotes.find((x) => x.id === p?.quoteId);
      if (!p || !q) return [];
      const call = view.inferenceCalls.find((c) => c.id === p.decision?.inferenceCallId);
      return [{
        purchaseId: id, runId: v.runId, merchantId: q.merchantId, amountAtomic: q.amountAtomic, payTo: q.payTo,
        state: p.state, delivery: p.delivery, hederaTxId: p.hederaTxId, updatedAt: p.updatedAt,
        zgRequestId: call?.zgRequestId, trustTier: call?.trustTier, teeVerified: call?.teeVerified,
      }];
    });
    const audit = auditStatuses(ctx, rows.map((x) => x.purchaseId));
    res.json({ purchases: rows.map((x) => ({ ...x, audit: audit[x.purchaseId] })) });
  });
  return r;
}

export const sumConfirmed = (ctx: OrchContext, runId: string): string => {
  const v = ctx.deps.trust.getRunView(runId);
  return v.purchases
    .filter((p) => p.state === "CONFIRMED")
    .reduce((s, p) => addA(s, v.quotes.find((q) => q.id === p.quoteId)?.amountAtomic ?? "0"), "0");
};
