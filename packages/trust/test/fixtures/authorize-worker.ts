// T5 worker: its own SQLite connection to the shared file DB, released by a barrier so all workers race authorize().
import { parentPort, workerData } from "node:worker_threads";
import type { AuthorizeResult } from "@kakashi/contracts";
import { authorize } from "../../src/authorize";
import { createCtx } from "../../src/db";

export type WorkerIn = { dbPath: string; env: Record<string, string>; purchaseId: string; nowIso: string; gate: SharedArrayBuffer };
export type WorkerOut = { kind: "ready" } | { kind: AuthorizeResult["kind"]; reasons: string[]; permitId?: string } | { error: string };

const { dbPath, env, purchaseId, nowIso, gate } = workerData as WorkerIn;
const post = (m: WorkerOut): void => parentPort!.postMessage(m);
try {
  const ctx = createCtx({ ...env, DB_PATH: dbPath }, { now: () => new Date(nowIso) });
  const flag = new Int32Array(gate);
  post({ kind: "ready" });
  Atomics.wait(flag, 0, 0); // blocks until the main thread flips the flag and notifies everyone
  try {
    const r = authorize(ctx, purchaseId);
    post(r.kind === "REJECTED" ? { kind: r.kind, reasons: r.reasons }
      : r.kind === "PERMIT" ? { kind: r.kind, reasons: [], permitId: r.permit.permitId }
      : { kind: r.kind, reasons: [] });
  } finally {
    ctx.db.close();
  }
} catch (e) {
  post({ error: e instanceof Error ? `${(e as { code?: string }).code ?? ""} ${e.message}` : String(e) });
}
