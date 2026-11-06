import { EventEmitter } from "node:events";

/** SPEC §9.4: clients refetch GET /api/runs/:id after any event; the read model is authoritative. */
export type RunEvent = { runId: string; kind: string; entityId: string };

export class EventBus {
  private em = new EventEmitter().setMaxListeners(0);
  emit(e: RunEvent): void { this.em.emit(e.runId, e); }
  subscribe(runId: string, fn: (e: RunEvent) => void): () => void {
    this.em.on(runId, fn);
    return () => void this.em.off(runId, fn);
  }
}
