import { newId, type ResearchRun } from "@tollbooth/contracts";
import type { Ctx } from "./db.js";
import { getActiveMandate } from "./mandates.js";
import { appendAuditEvent } from "./outbox.js";
import { runOf, toJson } from "./rows.js";

export function createRun(ctx: Ctx, userId: string, question: string): ResearchRun {
  const mandate = getActiveMandate(ctx, userId);
  if (!mandate) throw new Error("MANDATE_INACTIVE");
  if (typeof question !== "string" || question.length === 0 || question.length > 1000) throw new Error("INVALID_QUESTION");
  const id = newId("run_");
  ctx.db
    .prepare("INSERT INTO runs (id, user_id, mandate_id, mandate_version, question, state, started_at) VALUES (?, ?, ?, ?, ?, 'PLANNING', ?)")
    .run(id, userId, mandate.id, mandate.version, question, ctx.now().toISOString());
  return getRun(ctx, id)!;
}

export function getRun(ctx: Ctx, runId: string): ResearchRun | null {
  const r = ctx.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
  return r ? runOf(r) : null;
}

const COLUMNS: Record<string, string> = {
  state: "state", finishedAt: "finished_at", answer: "answer", failureReason: "failure_reason", plan: "plan",
};

const TERMINAL: readonly string[] = ["DONE", "PARTIAL", "FAILED"];

export function updateRun(ctx: Ctx, runId: string, patch: Partial<ResearchRun>): void {
  const keys = Object.keys(patch);
  for (const k of keys) if (!(k in COLUMNS)) throw new Error(`FORBIDDEN_FIELD: ${k}`);
  ctx.db.transaction(() => {
    const before = getRun(ctx, runId);
    if (!before) throw new Error("RUN_NOT_FOUND");
    if (keys.length === 0) return;
    const vals = keys.map((k) => {
      const v = (patch as Record<string, unknown>)[k];
      return k === "answer" || k === "plan" ? toJson(v) : (v ?? null);
    });
    ctx.db.prepare(`UPDATE runs SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(", ")} WHERE id = ?`).run(...vals, runId);
    if (patch.state && TERMINAL.includes(patch.state) && !TERMINAL.includes(before.state)) {
      appendAuditEvent(ctx, "RUN_COMPLETED", { run: runId });
    }
  }).immediate();
}
