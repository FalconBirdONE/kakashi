import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import type { SigningPermit } from "@kakashi/contracts";
import type { SignResult } from "./sign.js";

const atomic = z.string().regex(/^\d+$/);
const permitSchema = z.object({
  permitId: z.string().min(1), purchaseId: z.string().min(1), mandateId: z.string().min(1),
  mandateVersion: z.number().int(), network: z.string(), assetId: z.string(), amountAtomic: atomic,
  payTo: z.string(), feePayer: z.string(), quoteHash: z.string(), issuedAt: z.string(), expiresAt: z.string(),
  mac: z.string(),
}).strict();
const bodySchema = z.object({ permit: permitSchema, requirementsB64: z.string().min(1) }).strict();

export function createApp(sign: (p: SigningPermit, r: string) => Promise<SignResult>, log: (m: string) => void, status?: (p:SigningPermit)=>import("@kakashi/contracts").SignerStatus): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.post('/status',(req,res)=>{
    const p=permitSchema.safeParse(req.body?.permit);
    if(!p.success||!status){res.status(403).json({state:'UNAVAILABLE'});return;}
    res.json(status(p.data));
  });
  app.post("/sign", async (req: Request, res: Response) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      log("sign refused reason=BAD_REQUEST");
      res.status(400).json({ error: "SIGNER_REFUSED", reason: "BAD_REQUEST" });
      return;
    }
    const { permit, requirementsB64 } = parsed.data;
    const result = await sign(permit, requirementsB64);
    // Only ids and the decision are logged. Never headers, keys or payloads.
    if (result.ok) {
      log(`sign ok permit=${permit.permitId} purchase=${permit.purchaseId} tx=${result.hederaTxId}`);
      res.json({ paymentHeader: result.paymentHeader, hederaTxId: result.hederaTxId });
    } else {
      log(`sign refused permit=${permit.permitId} purchase=${permit.purchaseId} reason=${result.reason}`);
      res.status(403).json({ error: result.error, reason: result.reason });
    }
  });

  app.use((_req: Request, res: Response) => void res.status(404).json({ error: "not_found" }));
  // Oversized or malformed JSON lands here. Respond without echoing anything from the request.
  app.use((err: { status?: number; type?: string }, _req: Request, res: Response, _next: unknown) => {
    log(`request rejected: ${err.type ?? "error"}`);
    res.status(err.status === 413 ? 413 : 400).json({ error: "SIGNER_REFUSED", reason: "BAD_REQUEST" });
  });
  return app;
}
