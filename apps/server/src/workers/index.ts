import type { OrchContext } from "../orchestrator/context.js";
import { createAuditWorker } from "./auditWorker.js";
import { createReconciler } from "./reconciler.js";

/** Starts both background workers; the returned function stops them. */
export function startWorkers(ctx: OrchContext): () => void {
  const reconciler = createReconciler(ctx);
  const audit = createAuditWorker(ctx);
  return () => { reconciler.stop(); audit.stop(); };
}
