// World ID auth attempts: device flow start/poll, identity binding and the protected actions (SPEC §8.2, §8.4 step 3).
// Every World call goes through the injected WorldClient, so tests drive the whole flow with a fake.
import { newId, type AuthAttemptPublic, type AuthAttemptResult, type AuthPurpose, type SigningPermit } from "@tollbooth/contracts";
import { appendAuditEvent } from "../outbox";
import { issuePermitAfterApproval } from "../authorize";
import type { Ctx, Db } from "../db";
import { refreshMandate } from "../mandates";
import { getPurchase } from "../purchases";
import type { WorldClaims, WorldClient, WorldLogger } from "./types";

export type AuthDeps = { world: WorldClient; logger?: WorldLogger };

type Row = Record<string, any>;
const APPROVAL_TTL_MS = 5 * 60_000; // SPEC §7.4: purchase approvals live 5 min

const invalid = (why: string): never => { throw new Error(`AUTH_TARGET_INVALID: ${why}`); };
const attemptRow = (ctx: Ctx, id: string) => ctx.db.prepare("SELECT * FROM auth_attempts WHERE id = ?").get(id) as Row | undefined;
const latestMandate = (ctx: Ctx, id: string) =>
  ctx.db.prepare("SELECT * FROM mandates WHERE id = ? ORDER BY version DESC LIMIT 1").get(id) as Row | undefined;

export const toPublic = (r: Row): AuthAttemptPublic => ({
  id: r.id, purpose: r.purpose, targetId: r.target_id, startedAt: r.started_at, expiresAt: r.expires_at,
  result: r.result, verificationUri: r.verification_uri, userCode: r.user_code,
});

// Signed-but-unsent permits never touch disk. shortcut: lost on restart; reconciliation treats an unsigned RESERVED
// purchase as FAILED_FINAL after the permit lifetime. Upgrade if the app ever runs more than one process.
const permits = new WeakMap<Db, Map<string, SigningPermit>>();

export function getPermitForPurchase(ctx: Ctx, purchaseId: string): SigningPermit | null {
  const m = permits.get(ctx.db);
  const p = m?.get(purchaseId) ?? null;
  m?.delete(purchaseId);
  return p;
}

/** Checks the target and returns the hash the human approves. Reads only (refreshMandate may persist lazy expiry). */
function resolveTarget(ctx: Ctx, userId: string, purpose: AuthPurpose, targetId: string): { hash: string; version?: number } {
  if (purpose === "ACTIVATE_MANDATE") {
    const r = latestMandate(ctx, targetId);
    if (!r) return invalid("mandate not found");
    const m = refreshMandate(ctx, r.id, r.version);
    if (m.userId !== userId) invalid("mandate belongs to another user");
    if (m.state !== "DRAFT" && m.state !== "PENDING_APPROVAL") invalid(`mandate is ${m.state}`);
    if (Date.parse(m.expiresAt) <= ctx.now().getTime()) invalid("mandate expired");
    return { hash: m.mandateHash, version: m.version };
  }
  if (purpose === "APPROVE_PURCHASE") {
    const p = ctx.db.prepare("SELECT p.state, p.purchase_hash, r.user_id FROM purchases p JOIN runs r ON r.id = p.run_id WHERE p.id = ?")
      .get(targetId) as Row | undefined;
    if (!p) return invalid("purchase not found");
    if (p.user_id !== userId) invalid("purchase belongs to another user");
    if (p.state !== "AWAITING_APPROVAL") invalid(`purchase is ${p.state}`);
    return { hash: p.purchase_hash };
  }
  return invalid("unknown purpose");
}

export async function startAuth(ctx: Ctx, deps: AuthDeps, userId: string, purpose: AuthPurpose, targetId: string): Promise<AuthAttemptPublic> {
  resolveTarget(ctx, userId, purpose, targetId); // fail fast before asking World for a device code
  const dev = await deps.world.startDevice(); // a World failure throws here, before any write
  const id = newId("att_");
  ctx.db.transaction(() => {
    const t = resolveTarget(ctx, userId, purpose, targetId); // re-check: the target may have changed during the await
    const now = ctx.now().getTime();
    const interval = dev.interval > 0 ? dev.interval : 5; // RFC 8628 default
    let expires = now + dev.expiresIn * 1000;
    if (purpose === "APPROVE_PURCHASE") expires = Math.min(expires, now + APPROVAL_TTL_MS);
    ctx.db.prepare("UPDATE auth_attempts SET result = 'SUPERSEDED' WHERE purpose = ? AND target_id = ? AND result = 'PENDING'").run(purpose, targetId);
    ctx.db.prepare(
      `INSERT INTO auth_attempts (id, user_id, purpose, target_hash, started_at, expires_at, result, device_code_ref,
         verification_uri, user_code, target_id, interval_seconds, next_poll_at) VALUES (?,?,?,?,?,?,'PENDING',?,?,?,?,?,?)`,
    ).run(id, userId, purpose, t.hash, new Date(now).toISOString(), new Date(expires).toISOString(), dev.deviceCode,
      dev.verificationUriComplete ?? dev.verificationUri, dev.userCode, targetId, interval, new Date(now + interval * 1000).toISOString());
    if (purpose === "ACTIVATE_MANDATE") {
      ctx.db.prepare("UPDATE mandates SET state = 'PENDING_APPROVAL' WHERE id = ? AND version = ?").run(targetId, t.version);
    }
  }).immediate();
  deps.logger?.("world.attempt.started", { attemptId: id, purpose });
  return toPublic(attemptRow(ctx, id)!);
}

export async function pollAuth(ctx: Ctx, deps: AuthDeps, attemptId: string): Promise<AuthAttemptPublic> {
  const a = attemptRow(ctx, attemptId);
  if (!a) throw new Error("ATTEMPT_NOT_FOUND");
  if (a.result !== "PENDING") return toPublic(a);
  if (ctx.now().getTime() >= Date.parse(a.expires_at)) return finish(ctx, deps, attemptId, "EXPIRED", undefined, "ATTEMPT_EXPIRED");

  // Claim this poll slot so concurrent browser polls don't double-call World (honours interval / slow_down).
  const claimed = ctx.db.transaction(() => {
    const r = attemptRow(ctx, attemptId)!;
    const now = ctx.now().getTime();
    if (r.result !== "PENDING" || now < Date.parse(r.next_poll_at)) return false;
    ctx.db.prepare("UPDATE auth_attempts SET next_poll_at = ? WHERE id = ?").run(new Date(now + r.interval_seconds * 1000).toISOString(), attemptId);
    return true;
  }).immediate();
  if (!claimed) return toPublic(attemptRow(ctx, attemptId)!);

  const poll = await deps.world.pollDevice(a.device_code_ref);
  switch (poll.status) {
    case "PENDING":
      if (poll.slowDown) {
        const interval = attemptRow(ctx, attemptId)!.interval_seconds + 5;
        ctx.db.prepare("UPDATE auth_attempts SET interval_seconds = ?, next_poll_at = ? WHERE id = ? AND result = 'PENDING'")
          .run(interval, new Date(ctx.now().getTime() + interval * 1000).toISOString(), attemptId);
      }
      return toPublic(attemptRow(ctx, attemptId)!);
    case "TOKEN": {
      const v = await deps.world.validateIdToken(poll.idToken, Date.parse(a.started_at));
      return v.ok ? finish(ctx, deps, attemptId, "VERIFIED", v.claims) : finish(ctx, deps, attemptId, "ERROR", undefined, v.reason);
    }
    case "ERROR":
      return finish(ctx, deps, attemptId, "ERROR", undefined, poll.code);
    default:
      return finish(ctx, deps, attemptId, poll.status);
  }
}

/** First success links (iss, sub) to the user; afterwards any other pairing is IDENTITY_MISMATCH (SPEC §8.2 step 5). */
function bindIdentity(ctx: Ctx, userId: string, c: WorldClaims, nowIso: string): "VERIFIED" | "IDENTITY_MISMATCH" {
  const mine = ctx.db.prepare("SELECT iss, sub FROM world_identities WHERE user_id = ?").get(userId) as Row | undefined;
  if (mine) return mine.iss === c.iss && mine.sub === c.sub ? "VERIFIED" : "IDENTITY_MISMATCH";
  if (ctx.db.prepare("SELECT 1 FROM world_identities WHERE iss = ? AND sub = ?").get(c.iss, c.sub)) return "IDENTITY_MISMATCH";
  ctx.db.prepare("INSERT INTO world_identities (user_id, iss, sub, linked_at) VALUES (?, ?, ?, ?)").run(userId, c.iss, c.sub, nowIso);
  return "VERIFIED";
}

const INSERT_APPROVAL = `INSERT INTO approvals (id, attempt_id, purpose, target_hash, decision, created_at, expires_at, consumed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

/** VERIFIED + ACTIVATE_MANDATE: approve, consume, retire the old active mandate and activate (SPEC §8.2 step 6). */
function activateMandate(ctx: Ctx, a: Row, nowIso: string): AuthAttemptResult {
  const m = latestMandate(ctx, a.target_id);
  if (!m || m.state !== "PENDING_APPROVAL" || m.mandate_hash !== a.target_hash || Date.parse(m.expires_at) <= Date.parse(nowIso)) return "ERROR";
  const apv = newId("apv_");
  ctx.db.prepare(INSERT_APPROVAL).run(apv, a.id, a.purpose, a.target_hash, "APPROVED", nowIso, new Date(Date.parse(nowIso) + APPROVAL_TTL_MS).toISOString(), nowIso);
  // One ACTIVE mandate per user (unique index): retire whatever is live now.
  const retired = ctx.db.prepare("SELECT * FROM mandates WHERE user_id = ? AND state IN ('ACTIVE','EXHAUSTED') ORDER BY version DESC").all(a.user_id) as Row[];
  ctx.db.prepare("UPDATE mandates SET state = 'REVOKED', revoked_at = ? WHERE user_id = ? AND state IN ('ACTIVE','EXHAUSTED')").run(nowIso, a.user_id);
  for (const r of retired) appendAuditEvent(ctx, "MANDATE_REVOKED", { mandateHash: r.mandate_hash });
  // shortcut: carry the old version's budget use forward; in-flight purchases stay pinned to the old version, so
  // releases/spends after this land on the retired row, not here. Known limitation until purchases follow the version.
  const prev = retired.find((r) => r.id === m.id);
  ctx.db.prepare("UPDATE mandates SET state = 'ACTIVE', activation_approval_id = ?, spent = ?, reserved = ? WHERE id = ? AND version = ?")
    .run(apv, prev?.spent ?? m.spent, prev?.reserved ?? m.reserved, m.id, m.version);
  appendAuditEvent(ctx, "MANDATE_ACTIVATED", { mandateHash: m.mandate_hash });
  return "VERIFIED";
}

function finish(
  ctx: Ctx, deps: AuthDeps, attemptId: string, outcome: AuthAttemptResult, claims?: WorldClaims, reason?: string,
): AuthAttemptPublic {
  const nowD = ctx.now();
  const nowIso = nowD.toISOString();
  let result = outcome;
  let permit: SigningPermit | undefined;
  let done = false;
  // One transaction for the attempt result, the identity link and the protected action; issuePermitAfterApproval
  // nests as a savepoint, so a crash can't leave a VERIFIED attempt with an unconsumed approval.
  const a = ctx.db.transaction((): Row => {
    const a = attemptRow(ctx, attemptId)!;
    if (a.result !== "PENDING") return a; // superseded or finished by a concurrent poll
    if (claims) {
      result = bindIdentity(ctx, a.user_id, claims, nowIso);
      const authMs = claims.authTime < 1e12 ? claims.authTime * 1000 : claims.authTime; // JWT auth_time is seconds
      ctx.db.prepare("UPDATE auth_attempts SET iss = ?, sub = ?, auth_time = ?, acr = ?, amr = ? WHERE id = ?")
        .run(claims.iss, claims.sub, new Date(authMs).toISOString(), claims.acr ?? null, claims.amr ? JSON.stringify(claims.amr) : null, attemptId);
    }
    const purchaseWaiting = () => { const p = getPurchase(ctx, a.target_id); return p?.state === "AWAITING_APPROVAL" ? p : null; };

    if (result === "VERIFIED" && a.purpose === "ACTIVATE_MANDATE") {
      result = activateMandate(ctx, a, nowIso);
      if (result !== "VERIFIED") reason = "TARGET_CHANGED";
    } else if (result === "VERIFIED") {
      if (!purchaseWaiting()) { result = "ERROR"; reason = "TARGET_CHANGED"; }
      else {
        const apv = newId("apv_");
        ctx.db.prepare(INSERT_APPROVAL).run(apv, a.id, a.purpose, a.target_hash, "APPROVED", nowIso, new Date(nowD.getTime() + APPROVAL_TTL_MS).toISOString(), null);
        const out = issuePermitAfterApproval(ctx, a.target_id, apv);
        if (out.kind === "PERMIT") permit = out.permit; else reason = out.reason;
      }
    } else if (a.purpose === "ACTIVATE_MANDATE") {
      // Failure path: no approval; the mandate stays non-active and the user can retry (SPEC §8.2 step 7).
      ctx.db.prepare("UPDATE mandates SET state = 'DRAFT' WHERE id = ? AND mandate_hash = ? AND state = 'PENDING_APPROVAL'").run(a.target_id, a.target_hash);
    } else if (purchaseWaiting()) {
      // Failure path: a DENIED approval makes issuePermitAfterApproval move to APPROVAL_DENIED, release and audit.
      const apv = newId("apv_");
      ctx.db.prepare(INSERT_APPROVAL).run(apv, a.id, a.purpose, a.target_hash, "DENIED", nowIso, nowIso, null);
      issuePermitAfterApproval(ctx, a.target_id, apv);
    }
    ctx.db.prepare("UPDATE auth_attempts SET result = ? WHERE id = ?").run(result, attemptId);
    done = true;
    return attemptRow(ctx, attemptId)!;
  }).immediate();

  if (!done) return toPublic(a); // lost the race: someone else finished it, nothing done here
  if (permit) {
    let m = permits.get(ctx.db);
    if (!m) permits.set(ctx.db, (m = new Map()));
    m.set(permit.purchaseId, permit);
  }
  deps.logger?.("world.attempt.finished", { attemptId, purpose: a.purpose, result, reason });
  return toPublic(a);
}
