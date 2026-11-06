import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentDecision, InferenceCall, Mandate, MandateDraft, PurchaseState, Quote, ResearchRun } from "@kakashi/contracts";
import { createCtx, type Ctx } from "../src/db";
import { createMandateDraft, getMandate } from "../src/mandates";
import { proposePurchase, recordQuote, transition } from "../src/purchases";
import { createRun } from "../src/runs";

export const USER = "usr_test";
export const START = Date.parse("2030-01-01T00:00:00.000Z");
export const MIN = 60_000;
export const TX = "0.0.9185802@1893456000.000000001";

export type Fx = { ctx: Ctx; dir: string; path: string; clock: { t: number }; advance: (ms: number) => void };

const dirs: string[] = [];
const open: Ctx[] = [];

/** Fresh temp DB with a mutable clock. Call cleanup() in afterEach. */
export function makeFx(env: Record<string, string | undefined> = {}): Fx {
  const dir = mkdtempSync(join(tmpdir(), "kakashi-trust-"));
  dirs.push(dir);
  const clock = { t: START };
  const path = join(dir, "t.sqlite");
  const ctx = createCtx({ DB_PATH: path, AGENT_ACCOUNT_ID: "0.0.2000", ...env }, { now: () => new Date(clock.t) });
  open.push(ctx);
  return { ctx, dir, path, clock, advance: (ms) => { clock.t += ms; } };
}

export function cleanup(): void {
  for (const c of open.splice(0)) { try { c.db.close(); } catch { /* already closed */ } }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export const iso = (ms: number): string => new Date(ms).toISOString();

export function draft(fx: Fx, over: Partial<MandateDraft> = {}): MandateDraft {
  return {
    totalBudgetAtomic: "200000", perPaymentCapAtomic: "100000", autoApproveCapAtomic: "20000",
    allowedMerchantIds: ["quickcast", "hourlypro", "groundtruth", "gouger"],
    expiresAt: iso(fx.clock.t + 30 * MIN), ...over,
  };
}

export function activate(fx: Fx, m: Pick<Mandate, "id" | "version">): void {
  const r = fx.ctx.db.prepare("UPDATE mandates SET state='ACTIVE' WHERE id=? AND version=?").run(m.id, m.version);
  if (r.changes !== 1) throw new Error("activate: no such mandate");
}

export function activeMandate(fx: Fx, over: Partial<MandateDraft> = {}, userId = USER): Mandate {
  const m = createMandateDraft(fx.ctx, userId, draft(fx, over));
  activate(fx, m);
  return m;
}

export function quoteInput(over: Partial<Omit<Quote, "id" | "runId">> = {}): Omit<Quote, "id" | "runId"> {
  return {
    merchantId: "quickcast", method: "GET", origin: "http://localhost:4001", path: "/weather", requestHash: "rh_1",
    network: "hedera:testnet", assetId: "0.0.429274", amountAtomic: "10000", payTo: "0.0.3001",
    facilitatorUrl: "https://facilitator.example", feePayer: "0.0.9185802", maxTimeoutSeconds: 60,
    rawRequirements: "e30=", receivedAt: "2030-01-01T00:00:00.000Z", localExpiresAt: "2030-01-01T00:01:00.000Z",
    quoteHash: "ignored", ...over,
  };
}

export function decision(over: Partial<AgentDecision> = {}): AgentDecision {
  return { action: "BUY", reasonCode: "FILLS_NEED", needId: "n1", expectedUsefulness: 0.9, rationale: "needed", ...over };
}

/** Active mandate plus a run pinned to it. */
export function setup(fx: Fx, over: Partial<MandateDraft> = {}): { mandate: Mandate; run: ResearchRun } {
  const mandate = activeMandate(fx, over);
  return { mandate, run: createRun(fx.ctx, USER, "what is the weather?") };
}

/** Records a quote of `amount` and proposes a purchase for it. */
export function propose(fx: Fx, runId: string, amount = "10000", dec: AgentDecision = decision()) {
  const q = recordQuote(fx.ctx, runId, quoteInput({ amountAtomic: amount }));
  return { quote: q, purchase: proposePurchase(fx.ctx, q.id, dec) };
}

/** Legal walks from PROPOSED to each state. */
export const WALK: Record<PurchaseState, PurchaseState[]> = {
  PROPOSED: [],
  POLICY_REJECTED: ["POLICY_REJECTED"],
  AGENT_SKIPPED: ["AGENT_SKIPPED"],
  AWAITING_APPROVAL: ["AWAITING_APPROVAL"],
  APPROVAL_DENIED: ["AWAITING_APPROVAL", "APPROVAL_DENIED"],
  RESERVED: ["RESERVED"],
  SIGNED: ["RESERVED", "SIGNED"],
  SUBMITTED: ["RESERVED", "SIGNED", "SUBMITTED"],
  CONFIRMED: ["RESERVED", "SIGNED", "SUBMITTED", "CONFIRMED"],
  FAILED_FINAL: ["RESERVED", "FAILED_FINAL"],
  UNKNOWN: ["RESERVED", "SIGNED", "SUBMITTED", "UNKNOWN"],
};

export function step(fx: Fx, id: string, to: PurchaseState) {
  return transition(fx.ctx, id, to, to === "SIGNED" ? { hederaTxId: TX } : {});
}

export function walkTo(fx: Fx, id: string, to: PurchaseState): void {
  for (const s of WALK[to]) step(fx, id, s);
}

export function inferenceInput(runId: string, over: Partial<Omit<InferenceCall, "id">> = {}): Omit<InferenceCall, "id"> {
  return {
    runId, kind: "DECIDE", model: "m", trustTier: "private", zgRequestId: "zg_1", provider: "0xprov", teeVerified: true,
    totalCost: "0.1", latencyMs: 10, inputHash: "ih", outputHash: "oh", ok: true, ...over,
  };
}

export function budget(fx: Fx, m: Pick<Mandate, "id" | "version">): { spent: string; reserved: string } {
  const g = getMandate(fx.ctx, m.id, m.version)!;
  return { spent: g.spentAtomic, reserved: g.reservedAtomic };
}
