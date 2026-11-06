import type { OrchContext } from "../orchestrator/context.js";
import { createAuditWorker } from "./auditWorker.js";
import { createReconciler } from "./reconciler.js";

/** Starts both background workers; the returned function stops them. */
export function startWorkers(ctx: OrchContext, opts: {allowSpending?:boolean} = {}): () => void {
  const reconciler = createReconciler(ctx,opts);
  const audit = opts.allowSpending===false ? {stop:()=>{}} : createAuditWorker(ctx);
  return () => { reconciler.stop(); audit.stop(); };
}
