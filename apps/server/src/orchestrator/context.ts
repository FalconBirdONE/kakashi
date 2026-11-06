import { EventBus } from "./bus.js";
import type { PolicyResult } from "@kakashi/contracts";
import type { Deps } from "../wiring.js";

/**
 * Shared in-process state for the orchestrator.
 * The Trust interface has no "list runs" or "get by id" lookups, so ownership indexes and delivered
 * bodies live here. ponytail: lost on restart; persist via trust once it exposes lookups.
 */
export type OrchContext = {
  interruptedRuns: Set<string>;
  deps: Deps;
  bus: EventBus;
  approvalPollMs: number;
  mandateOwner: Map<string, string>;
  attemptOwner: Map<string, string>;
  runs: Map<string, { userId: string; question: string }>;
  purchases: Map<string, { runId: string; userId: string }>;
  /** quoteId -> precheck result. The real trust read model does not return it on quotes, so the UI would lose it. */
  policy: Map<string, PolicyResult>;
  /** purchaseId -> latest HCS anchor, filled by the audit worker. */
  audit: Map<string, { sequenceNumber: number; topicId: string }>;
  /** purchaseId -> delivered body (input to synthesis). */
  evidence: Map<string, unknown>;
  /** purchases currently being executed; prevents signing twice. */
  inflight: Set<string>;
  track<T>(p: Promise<T>): Promise<T>;
  /** Resolves when all background work (runs, approval loops) has finished. */
  whenIdle(): Promise<void>;
  stop(): void;
  stopped: boolean;
};

export function createContext(deps: Deps, opts: { approvalPollMs?: number } = {}): OrchContext {
  const pending = new Set<Promise<unknown>>();
  const ctx: OrchContext = {
    interruptedRuns:new Set(),
    deps, bus: new EventBus(), approvalPollMs: opts.approvalPollMs ?? 2000,
    mandateOwner: new Map(), attemptOwner: new Map(), runs: new Map(), purchases: new Map(),
    evidence: new Map(), audit: new Map(), policy: new Map(), inflight: new Set(), stopped: false,
    track(p) {
      pending.add(p);
      const done = () => void pending.delete(p);
      p.then(done, done);
      return p;
    },
    async whenIdle() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    stop() { ctx.stopped = true; },
  };
  for (const run of deps.trust.persistence?.runs() ?? []) {
    if(!["DONE","PARTIAL","FAILED"].includes(run.state))ctx.interruptedRuns.add(run.id);
    ctx.runs.set(run.id,{userId:run.userId,question:run.question});
    for (const p of deps.trust.getRunView(run.id).purchases) {
      ctx.purchases.set(p.id,{runId:run.id,userId:run.userId});
      const evidence=deps.trust.persistence?.evidence(p.id);if(evidence!==undefined)ctx.evidence.set(p.id,evidence);
    }
  }
  return ctx;
}

export function owner(ctx: OrchContext, kind: import("@kakashi/contracts").ResourceKind, id: string): string | null {
  if (ctx.deps.trust.persistence) return ctx.deps.trust.persistence.owner(kind,id);
  return (kind === "mandate" ? ctx.mandateOwner.get(id) : kind === "attempt" ? ctx.attemptOwner.get(id) : kind === "run" ? ctx.runs.get(id)?.userId : ctx.purchases.get(id)?.userId) ?? null;
}
