import { Router } from "express";
import { z } from "zod";
import { MERCHANT_IDS, type MerchantFault, type MerchantId } from "@tollbooth/contracts";
import { HttpError } from "../errors.js";
import { requireUser, userOf } from "../session.js";
import type { OrchContext } from "../orchestrator/context.js";

const faultSchema = z.object({
  merchantId: z.enum(MERCHANT_IDS as [MerchantId, ...MerchantId[]]),
  fault: z.enum(["NONE", "DROP_AFTER_SETTLE", "SWAP_PAYTO", "STALE_DATA", "INJECT_TEXT"] satisfies MerchantFault[] as [MerchantFault, ...MerchantFault[]]),
}).strict();

const authResult = z.enum(["VERIFIED", "DENIED", "EXPIRED", "CANCELLED", "ERROR", "IDENTITY_MISMATCH"]);

/** Mounted only when DEMO_MODE=true; otherwise these paths fall through to the JSON 404. */
export function demoRoutes(ctx: OrchContext, opts: { merchantsUrl: string }): Router {
  const r = Router();
  r.use(requireUser);

  r.post("/demo/fault", (req, res) => {
    const { merchantId, fault } = faultSchema.parse(req.body);
    if (ctx.deps.fakes.rails) {
      ctx.deps.fakes.rails.setFault(merchantId, fault);
      res.json({ ok: true, merchantId, fault });
      return;
    }
    // TODO(real mode): POST { merchantId, fault } to `${opts.merchantsUrl}/admin/fault` (apps/merchants, SPEC §9.1).
    void opts.merchantsUrl;
    throw new HttpError(501, "NOT_IMPLEMENTED", "fault control for real rails is not wired yet");
  });

  // Dev-only: simulate World finishing an attempt. Needs the fake trust.
  r.post("/dev/complete-auth/:attemptId", (req, res) => {
    const fake = ctx.deps.fakes.trust;
    if (!fake) throw new HttpError(404, "NOT_FOUND", "no such route");
    const id = String(req.params.attemptId);
    if (ctx.attemptOwner.get(id) !== userOf(res)) throw new HttpError(404, "NOT_FOUND", "attempt not found");
    const { result } = z.object({ result: authResult }).strict().parse(req.body);
    fake.completeAuth(id, result);
    res.json({ ok: true });
  });

  return r;
}
