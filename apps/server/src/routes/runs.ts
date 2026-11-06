import { Router, type Response } from "express";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { requireUser, userOf } from "../session.js";
import type { OrchContext } from "../orchestrator/context.js";
import { runResearch } from "../orchestrator/run.js";
import { approvePurchase } from "../orchestrator/approval.js";
import { auditStatuses } from "../orchestrator/audit.js";
import { sumConfirmed } from "./meta.js";

const body = z.object({ question: z.string().trim().min(1).max(500) }).strict();

export function runRoutes(ctx: OrchContext, opts: { heartbeatMs?: number } = {}): Router {
  const { trust } = ctx.deps;
  const r = Router();
  r.use(requireUser);

  const own = (runId: string, res: Response) => {
    const e = ctx.runs.get(runId);
    if (!e || e.userId !== userOf(res)) throw new HttpError(404, "NOT_FOUND", "run not found");
    return e;
  };

  r.post("/runs", (req, res) => {
    const { question } = body.parse(req.body);
    const { runId } = runResearch(ctx, userOf(res), question);
    res.status(202).json({ runId });
  });

  // History, newest first.
  r.get("/runs", (_req, res) => {
    const out = [...ctx.runs.entries()]
      .filter(([, e]) => e.userId === userOf(res))
      .map(([id, e]) => {
        const run = trust.getRunView(id).run;
        return { id, question: e.question, state: run.state, startedAt: run.startedAt, finishedAt: run.finishedAt, dataSpendAtomic: sumConfirmed(ctx, id) };
      })
      .sort((a, b) => (a.id < b.id ? 1 : -1)); // run ids are time-sortable
    res.json({ runs: out });
  });

  r.get("/runs/:id", (req, res) => {
    const id = String(req.params.id);
    own(id, res);
    const view = trust.getRunView(id);
    res.json({ ...view, audit: auditStatuses(ctx, view.purchases.map((p) => p.id)) });
  });

  r.post("/runs/:id/rerun", (req, res) => {
    const e = own(String(req.params.id), res);
    const { runId } = runResearch(ctx, userOf(res), e.question);
    res.status(202).json({ runId });
  });

  r.get("/runs/:id/events", (req, res) => {
    const id = String(req.params.id);
    own(id, res);
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ runId: id, kind: "connected", entityId: id })}\n\n`);
    const off = ctx.bus.subscribe(id, (e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    const beat = setInterval(() => res.write(": ping\n\n"), opts.heartbeatMs ?? 15_000);
    req.on("close", () => { clearInterval(beat); off(); });
  });

  r.post("/purchases/:id/approve", async (req, res) => {
    res.status(202).json(await approvePurchase(ctx, userOf(res), String(req.params.id)));
  });

  return r;
}
