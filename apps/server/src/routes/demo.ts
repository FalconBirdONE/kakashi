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

  r.post("/demo/fault", async (req, res) => {
    const { merchantId, fault } = faultSchema.parse(req.body);
    if (ctx.deps.fakes.rails) {
      ctx.deps.fakes.rails.setFault(merchantId, fault);
      res.json({ ok: true, merchantId, fault });
      return;
    }
    // Real rails: the merchants service owns the faults. URL comes from env, never from the request.
    let r2: Response;
    try {
      r2 = await fetch(`${opts.merchantsUrl}/admin/fault`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchantId, fault }), redirect: "error", signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new HttpError(502, "MERCHANTS_UNREACHABLE", "could not reach the merchants service");
    }
    if (!r2.ok) {
      const body = (await r2.json().catch(() => ({}))) as { error?: string };
      throw new HttpError(r2.status === 404 ? 409 : 400, "FAULT_REJECTED", body.error ?? "merchants service refused the fault");
    }
    res.json({ ok: true, merchantId, fault });
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
