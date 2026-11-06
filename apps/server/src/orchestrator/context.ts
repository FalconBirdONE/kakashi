import { EventBus } from "./bus.js";
import type { Deps } from "../wiring.js";

/**
 * Shared in-process state for the orchestrator.
 * The Trust interface has no "list runs" or "get by id" lookups, so ownership indexes and delivered
 * bodies live here. ponytail: lost on restart; persist via trust once it exposes lookups.
 */
export type OrchContext = {
  deps: Deps;
  bus: EventBus;
  approvalPollMs: number;
  mandateOwner: Map<string, string>;
  attemptOwner: Map<string, string>;
  runs: Map<string, { userId: string; question: string }>;
  purchases: Map<string, { runId: string; userId: string }>;
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
    deps, bus: new EventBus(), approvalPollMs: opts.approvalPollMs ?? 2000,
    mandateOwner: new Map(), attemptOwner: new Map(), runs: new Map(), purchases: new Map(),
    evidence: new Map(), inflight: new Set(), stopped: false,
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
  return ctx;
}
