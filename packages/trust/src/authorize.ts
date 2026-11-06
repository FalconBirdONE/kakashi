// Policy precheck, authorization and post-approval permits (SPEC §8.4 steps 1-3, §11.1, §7.7).
import {
  canonicalJson, subA, mintPermit, newId, sha256Hex,
  type AuthorizeResult, type Mandate, type PolicyReason, type PolicyResult, type Purchase, type Quote, type SigningPermit,
} from "@tollbooth/contracts";
import type { Ctx } from "./db.js";
import { refreshMandate } from "./mandates.js";
import { appendAuditEvent } from "./outbox.js";
import { evaluate, policyConfigFromEnv, type RunStats } from "./policy.js";
import { computeQuoteHash, getPurchase, getQuote, transition, zgOf } from "./purchases.js";
import { mandateOf } from "./rows.js";

type Row = Record<string, any>;

const COUNTED = "'AWAITING_APPROVAL','RESERVED','SIGNED','SUBMITTED','UNKNOWN','CONFIRMED'";
const DEAD = "'POLICY_REJECTED','AGENT_SKIPPED','APPROVAL_DENIED','FAILED_FINAL'";
const PERMIT_TTL_MS = 60_000;

export function runStatsFor(ctx: Ctx, runId: string, requestHash: string, excludePurchaseId?: string): RunStats {
  const run = ctx.db.prepare("SELECT mandate_version, started_at FROM runs WHERE id = ?").get(runId) as Row | undefined;
  if (!run) throw new Error("RUN_NOT_FOUND");
  const s = ctx.db.prepare(
    `SELECT (SELECT COUNT(*) FROM purchases WHERE run_id = @run AND id != @ex AND state IN (${COUNTED})) AS counted,
            EXISTS (SELECT 1 FROM purchases p JOIN quotes q ON q.id = p.quote_id
                    WHERE p.run_id = @run AND p.id != @ex AND q.request_hash = @rh AND p.state NOT IN (${DEAD})) AS dup`,
  ).get({ run: runId, ex: excludePurchaseId ?? "", rh: requestHash }) as { counted: number; dup: number };
  return { runMandateVersion: run.mandate_version, runStartedAt: run.started_at, purchasesCounted: s.counted, duplicateRequest: s.dup === 1 };
}

/** Read-only: no writes, so it reads the mandate row directly instead of refreshMandate (which persists lazy state). */
export function precheck(ctx: Ctx, quoteId: string): PolicyResult {
  const quote = getQuote(ctx, quoteId);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  const run = ctx.db.prepare("SELECT mandate_id, mandate_version FROM runs WHERE id = ?").get(quote.runId) as Row;
  const mandate = mandateOf(ctx.db.prepare("SELECT * FROM mandates WHERE id = ? AND version = ?").get(run.mandate_id, run.mandate_version) as Row);
  return evaluate(quote, mandate, runStatsFor(ctx, quote.runId, quote.requestHash), ctx.now(), policyConfigFromEnv(ctx.env));
}

function permitSecret(ctx: Ctx): string {
  const s = ctx.env.PERMIT_SECRET;
  if (!s || !/^[0-9a-fA-F]{64}$/.test(s)) throw new Error("PERMIT_SECRET not set");
  return s;
}

function mint(p: Purchase, q: Quote, permitId: string, now: Date, secret: string, deadline: number): SigningPermit {
  return mintPermit({
    permitId, purchaseId: p.id, mandateId: p.mandateId, mandateVersion: p.mandateVersion,
    network: q.network, assetId: q.assetId, amountAtomic: q.amountAtomic, payTo: q.payTo, feePayer: q.feePayer,
    quoteHash: p.quoteHash, issuedAt: now.toISOString(), expiresAt: new Date(Math.min(now.getTime() + PERMIT_TTL_MS, deadline)).toISOString(),
  }, secret);
}

function deadline(ctx: Ctx, p: Purchase, q: Quote, m: Mandate): number {
  const run=ctx.db.prepare('SELECT started_at FROM runs WHERE id=?').get(p.runId) as {started_at:string};
  return Math.min(Date.parse(q.localExpiresAt),Date.parse(m.expiresAt),Date.parse(run.started_at)+m.maxRunDurationSeconds*1000);
}

export function authorize(ctx: Ctx, purchaseId: string): AuthorizeResult {
  const secret = permitSecret(ctx);
  return ctx.db.transaction((): AuthorizeResult => {
    const p = getPurchase(ctx, purchaseId);
    if (!p) throw new Error("PURCHASE_NOT_FOUND");
    if (p.state !== "PROPOSED") throw new Error("PURCHASE_NOT_PROPOSED");
    const quote = getQuote(ctx, p.quoteId)!;
    const mandate: Mandate = refreshMandate(ctx, p.mandateId, p.mandateVersion);
    const now = ctx.now();
    const evaluated = evaluate(quote, mandate, runStatsFor(ctx, p.runId, quote.requestHash, p.id), now, policyConfigFromEnv(ctx.env));
    const reasons: PolicyReason[] = [...evaluated.reasons];
    // Contracts has no code for a quote whose hash changed since proposal; QUOTE_EXPIRED is the closest ("no longer valid").
    const quoteChanged = computeQuoteHash(quote) !== p.quoteHash || quote.quoteHash !== p.quoteHash;
    if (quoteChanged && !reasons.includes("QUOTE_EXPIRED")) reasons.push("QUOTE_EXPIRED");
    const policyResult: PolicyResult = { ...evaluated, allowed: reasons.length === 0, reasons };

    const decide = (): AuthorizeResult => {
      const reject = (pr: PolicyResult): AuthorizeResult => {
        transition(ctx, p.id, "POLICY_REJECTED", { policyResult: pr });
        return { kind: "REJECTED", reasons: pr.reasons };
      };
      if (reasons.length > 0) return reject(policyResult);
      const permitId = policyResult.needsApproval ? undefined : newId("pmt_");
      try {
        if (permitId) transition(ctx, p.id, "RESERVED", { policyResult, permitId });
        else transition(ctx, p.id, "AWAITING_APPROVAL", { policyResult });
      } catch (e) {
        // The conditional reserve inside transition failed; its savepoint is already rolled back.
        if (e instanceof Error && e.message === "OVER_BUDGET") {
          return reject({ allowed: false, reasons: ["OVER_BUDGET"], needsApproval: policyResult.needsApproval });
        }
        throw e;
      }
      if (!permitId) return { kind: "NEEDS_APPROVAL", purchase: getPurchase(ctx, p.id)! };
      return { kind: "PERMIT", permit: mint(p, quote, permitId, now, secret, deadline(ctx,p,quote,mandate)) };
    };

    const out = decide();
    appendAuditEvent(ctx, "PURCHASE_DECIDED", {
      run: p.runId, pur: p.id, mandateHash: mandate.mandateHash, quoteHash: p.quoteHash,
      decisionHash: sha256Hex(canonicalJson(p.decision ?? null)), zg: zgOf(ctx, p.decision),
    });
    return out;
  }).immediate();
}

export type ApprovalDenial =
  | "QUOTE_EXPIRED" | "RUN_TIME_EXCEEDED" | "POLICY_CHANGED" | "APPROVAL_NOT_APPROVED" | "APPROVAL_EXPIRED" | "APPROVAL_CONSUMED" | "TARGET_MISMATCH" | "QUOTE_CHANGED" | "MANDATE_INACTIVE";

export function issuePermitAfterApproval(
  ctx: Ctx, purchaseId: string, approvalId: string,
): { kind: "PERMIT"; permit: SigningPermit } | { kind: "DENIED"; reason: ApprovalDenial } {
  const secret = permitSecret(ctx);
  return ctx.db.transaction(() => {
    const p = getPurchase(ctx, purchaseId);
    if (!p || p.state !== "AWAITING_APPROVAL") throw new Error("PURCHASE_NOT_AWAITING_APPROVAL");
    const a = ctx.db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as Row | undefined;
    if (!a) throw new Error("APPROVAL_NOT_FOUND");
    const quote = getQuote(ctx, p.quoteId)!;
    const mandate = refreshMandate(ctx, p.mandateId, p.mandateVersion);
    const now = ctx.now();
    const quoteHash = computeQuoteHash(quote);
    const purchaseHash = sha256Hex(canonicalJson({
      purchaseId: p.id, quoteHash, amountAtomic: quote.amountAtomic, payTo: quote.payTo, mandateVersion: p.mandateVersion,
    }));
    const audit = { run: p.runId, pur: p.id, mandateHash: mandate.mandateHash, quoteHash: p.quoteHash };

    // EXHAUSTED is allowed: this purchase's own reservation can push available below the cheapest price.
    const policy = evaluate(quote, {...mandate, state: mandate.state === 'EXHAUSTED' ? 'ACTIVE' : mandate.state,
      reservedAtomic: subA(mandate.reservedAtomic, (ctx.db.prepare('SELECT amount FROM purchases WHERE id=?').get(p.id) as {amount:string}).amount ?? quote.amountAtomic)},
      runStatsFor(ctx,p.runId,quote.requestHash,p.id),now,policyConfigFromEnv(ctx.env));
    const reason: ApprovalDenial | null =
      a.decision !== "APPROVED" || a.purpose !== "APPROVE_PURCHASE" ? "APPROVAL_NOT_APPROVED"
      : !(Date.parse(a.expires_at) > now.getTime()) || !(Date.parse(a.created_at) <= now.getTime()) ? "APPROVAL_EXPIRED"
      : a.consumed_at != null ? "APPROVAL_CONSUMED"
      : quoteHash !== p.quoteHash ? "QUOTE_CHANGED"
      : a.target_hash !== purchaseHash || a.target_hash !== p.purchaseHash ? "TARGET_MISMATCH"
      : policy.reasons.includes("QUOTE_EXPIRED") ? "QUOTE_EXPIRED"
      : policy.reasons.includes("RUN_TIME_EXCEEDED") ? "RUN_TIME_EXCEEDED"
      : mandate.state !== "ACTIVE" && mandate.state !== "EXHAUSTED" ? "MANDATE_INACTIVE"
      : !policy.allowed ? "POLICY_CHANGED"
      : null;
    if (reason) {
      transition(ctx, p.id, "APPROVAL_DENIED", { approvalId });
      appendAuditEvent(ctx, "APPROVAL_DENIED", audit);
      return { kind: "DENIED" as const, reason };
    }

    const consumed = ctx.db.prepare("UPDATE approvals SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL").run(now.toISOString(), approvalId);
    if (consumed.changes !== 1) throw new Error("APPROVAL_CONSUMED");
    const permitId = newId("pmt_");
    transition(ctx, p.id, "RESERVED", { approvalId, permitId });
    const permit = mint(p, quote, permitId, now, secret, deadline(ctx,p,quote,mandate));
    appendAuditEvent(ctx, "APPROVAL_GRANTED", audit);
    return { kind: "PERMIT" as const, permit };
  }).immediate();
}
