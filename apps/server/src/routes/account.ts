import { Router } from "express";
import { z } from "zod";
import { MERCHANT_IDS, cmpA, boundedAtomic, newId, type MandateDraft, type MerchantId } from "@kakashi/contracts";
import { HttpError, conflict } from "../errors.js";
import { issueCookie, requireUser, userOf } from "../session.js";
import { owner } from "../orchestrator/context.js";
import type { OrchContext } from "../orchestrator/context.js";

const atomic = z.string().refine(boundedAtomic, "must be a non-negative integer string (atomic units)");
const draftSchema = z.object({
  totalBudgetAtomic: atomic,
  perPaymentCapAtomic: atomic,
  autoApproveCapAtomic: atomic,
  allowedMerchantIds: z.array(z.enum(MERCHANT_IDS as [MerchantId, ...MerchantId[]])).min(1),
  maxPurchasesPerRun: z.number().int().min(1).max(10).optional(),
  maxRunDurationSeconds: z.number().int().min(10).max(600).optional(),
  expiresAt: z.iso.datetime(),
}).strict().superRefine((d, c) => {
  if (![d.totalBudgetAtomic, d.perPaymentCapAtomic, d.autoApproveCapAtomic].every(boundedAtomic)) return; // field errors already reported
  if (cmpA(d.autoApproveCapAtomic, d.perPaymentCapAtomic) > 0) c.addIssue({ code: "custom", path: ["autoApproveCapAtomic"], message: "must not exceed perPaymentCapAtomic" });
  if (cmpA(d.perPaymentCapAtomic, d.totalBudgetAtomic) > 0) c.addIssue({ code: "custom", path: ["perPaymentCapAtomic"], message: "must not exceed totalBudgetAtomic" });
  if (Date.parse(d.expiresAt) <= Date.now()) c.addIssue({ code: "custom", path: ["expiresAt"], message: "must be in the future" });
});

export function accountRoutes(ctx: OrchContext, opts: { demoUserId: string; secureCookie: boolean; demoMode: boolean; perVisitor?: boolean }): Router {
  const { trust } = ctx.deps;
  const r = Router();

  // Demo session. Issues the signed session cookie: one shared demo user, or with perVisitor (LIVE_DEMO)
  // one user per browser, because World ID binds each user to one human and each human to one user.
  if (opts.demoMode) r.post("/session", (_req, res) => {
    const userId = opts.perVisitor ? ((res.locals.userId as string | undefined) ?? newId("usr_")) : opts.demoUserId;
    issueCookie(res, userId, opts.secureCookie);
    res.json({ userId });
  });

  r.use(requireUser);

  // Ownership of mandates and attempts is tracked here because the Trust interface has no lookup-by-id.
  const ownMandate = (id: string, userId: string) => {
    if (owner(ctx,"mandate",id) !== userId) throw new HttpError(404, "NOT_FOUND", "mandate not found");
  };

  r.post("/mandates", (req, res) => {
    const draft: MandateDraft = draftSchema.parse(req.body);
    const m = conflict(() => trust.createMandateDraft(userOf(res), {
      ...draft,
      allowedMerchantIds: [...new Set(draft.allowedMerchantIds)],
      // The real 0G brain takes 16-28 s per call; 3 calls do not fit the 120 s spec default.
      maxRunDurationSeconds: draft.maxRunDurationSeconds ?? (ctx.deps.modes.brain === "real" ? 300 : undefined),
    }));
    ctx.mandateOwner.set(m.id, userOf(res));
    res.status(201).json(m);
  });

  r.get("/mandate", (_req, res) => {
    const u = userOf(res);
    const m = trust.getActiveMandate(u) ?? trust.getLedgerView(u).mandate;
    if (m) ctx.mandateOwner.set(m.id, u);
    res.json({ mandate: m });
  });

  r.post("/mandates/:id/activate", async (req, res) => {
    const id = String(req.params.id);
    ownMandate(id, userOf(res));
    const a = await conflict2(() => trust.startAuth(userOf(res), "ACTIVATE_MANDATE", id));
    ctx.attemptOwner.set(a.id, userOf(res));
    res.status(201).json(a);
  });

  r.post("/mandates/:id/revoke", (req, res) => {
    const id = String(req.params.id);
    ownMandate(id, userOf(res));
    res.json(conflict(() => trust.revokeMandate(id)));
  });

  r.get("/auth-attempts/:id", async (req, res) => {
    const id = String(req.params.id);
    if (owner(ctx,"attempt",id) !== userOf(res)) throw new HttpError(404, "NOT_FOUND", "attempt not found");
    res.json(await conflict2(() => trust.pollAuth(id)));
  });

  r.put("/preferences", (req, res) => {
    const { text } = z.object({ text: z.string().max(2000) }).strict().parse(req.body);
    trust.setPreferences(userOf(res), text);
    res.json({ ok: true });
  });

  r.get("/ledger", (_req, res) => {
    res.json(trust.getLedgerView(userOf(res)));
  });

  return r;
}

async function conflict2<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(409, "INVALID_STATE", e instanceof Error ? e.message : "invalid state");
  }
}
