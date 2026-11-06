// Mandates: draft, hash, version, lazy state refresh, revoke, preferences (SPEC §8.2, §9.3.3).
// Activation (World ID approval, retiring the old version) lives elsewhere.
import {
  MERCHANT_REGISTRY, addA, canonicalJson, cmpA, isAtomic, newId, sha256Hex, subA,
  type Mandate, type MandateDraft, type UserPreferences,
} from "@tollbooth/contracts";
import type { Ctx } from "./db.js";
import { mandateOf } from "./rows.js";

const bad = (why: string): never => { throw new Error(`INVALID_MANDATE: ${why}`); };

export function ensureUserAndAgent(ctx: Ctx, userId: string): { agentId: string; walletAccountId: string } {
  const wallet = ctx.env.AGENT_ACCOUNT_ID;
  if (!wallet) throw new Error("AGENT_ACCOUNT_ID not set");
  const nowIso = ctx.now().toISOString();
  return ctx.db.transaction(() => {
    ctx.db.prepare("INSERT OR IGNORE INTO users (id, display_name, created_at) VALUES (?, 'Demo user', ?)").run(userId, nowIso);
    ctx.db.prepare("INSERT OR IGNORE INTO agents (id, user_id, wallet_account_id, created_at) VALUES (?, ?, ?, ?)")
      .run(newId("agt_"), userId, wallet, nowIso);
    const a = ctx.db.prepare("SELECT id, wallet_account_id FROM agents WHERE user_id = ?").get(userId) as { id: string; wallet_account_id: string };
    return { agentId: a.id, walletAccountId: a.wallet_account_id };
  }).immediate();
}

export function computeMandateHash(m: Mandate): string {
  return sha256Hex(canonicalJson({
    id: m.id, version: m.version, userId: m.userId, agentId: m.agentId, walletAccountId: m.walletAccountId,
    network: m.network, assetId: m.assetId, assetDecimals: m.assetDecimals,
    totalBudgetAtomic: m.totalBudgetAtomic, perPaymentCapAtomic: m.perPaymentCapAtomic,
    autoApproveCapAtomic: m.autoApproveCapAtomic, allowedMerchantIds: [...m.allowedMerchantIds].sort(),
    maxPurchasesPerRun: m.maxPurchasesPerRun, maxRunDurationSeconds: m.maxRunDurationSeconds,
    validFrom: m.validFrom, expiresAt: m.expiresAt,
  }));
}

/** Validates and normalizes a draft (defaults filled, expiresAt as canonical ISO, merchants de-duplicated). */
function validateDraft(d: MandateDraft, now: Date): Required<MandateDraft> {
  for (const k of ["totalBudgetAtomic", "perPaymentCapAtomic", "autoApproveCapAtomic"] as const) {
    if (!isAtomic(d[k])) bad(`${k} must be an atomic integer string`);
  }
  if (cmpA(d.perPaymentCapAtomic, d.totalBudgetAtomic) > 0) bad("perPaymentCap exceeds totalBudget");
  if (cmpA(d.autoApproveCapAtomic, d.perPaymentCapAtomic) > 0) bad("autoApproveCap exceeds perPaymentCap");
  const ids = d.allowedMerchantIds;
  if (!Array.isArray(ids) || ids.length === 0) bad("allowedMerchantIds is empty");
  const known = new Set<string>(MERCHANT_REGISTRY.map((m) => m.id));
  for (const id of ids) if (!known.has(id)) bad(`unknown merchant ${String(id)}`);
  const maxPurchasesPerRun = d.maxPurchasesPerRun ?? 3;
  const maxRunDurationSeconds = d.maxRunDurationSeconds ?? 120;
  if (!Number.isInteger(maxPurchasesPerRun) || maxPurchasesPerRun < 1) bad("maxPurchasesPerRun must be an integer >= 1");
  if (!Number.isInteger(maxRunDurationSeconds) || maxRunDurationSeconds < 1) bad("maxRunDurationSeconds must be an integer >= 1");
  const exp = new Date(d.expiresAt);
  if (typeof d.expiresAt !== "string" || Number.isNaN(exp.getTime())) bad("expiresAt is not a valid date");
  if (exp.getTime() <= now.getTime()) bad("expiresAt must be in the future");
  return {
    totalBudgetAtomic: d.totalBudgetAtomic, perPaymentCapAtomic: d.perPaymentCapAtomic, autoApproveCapAtomic: d.autoApproveCapAtomic,
    allowedMerchantIds: [...new Set(ids)], maxPurchasesPerRun, maxRunDurationSeconds, expiresAt: exp.toISOString(),
  };
}

const INSERT = `INSERT INTO mandates (id, version, state, user_id, agent_id, wallet_account_id, network, asset_id, asset_decimals,
  total_budget, per_payment_cap, auto_approve_cap, allowed_merchant_ids, max_purchases_per_run, max_run_duration_seconds,
  valid_from, expires_at, revoked_at, spent, reserved, mandate_hash, activation_approval_id, created_at)
  VALUES (@id, @version, 'DRAFT', @userId, @agentId, @walletAccountId, @network, @assetId, @assetDecimals,
  @total, @cap, @auto, @merchants, @maxP, @maxD, @validFrom, @expiresAt, NULL, @spent, @reserved, @hash, NULL, @createdAt)`;

/** Builds the full Mandate (hash included) and inserts it as a DRAFT row. */
function insertDraft(ctx: Ctx, base: Pick<Mandate, "id" | "version" | "userId" | "agentId" | "walletAccountId" | "network" | "assetId" | "assetDecimals" | "spentAtomic" | "reservedAtomic">, d: Required<MandateDraft>): Mandate {
  const nowIso = ctx.now().toISOString();
  const m: Mandate = {
    ...base, state: "DRAFT",
    totalBudgetAtomic: d.totalBudgetAtomic, perPaymentCapAtomic: d.perPaymentCapAtomic, autoApproveCapAtomic: d.autoApproveCapAtomic,
    allowedMerchantIds: d.allowedMerchantIds, maxPurchasesPerRun: d.maxPurchasesPerRun, maxRunDurationSeconds: d.maxRunDurationSeconds,
    validFrom: nowIso, expiresAt: d.expiresAt, revokedAt: null, mandateHash: "", activationApprovalId: null, createdAt: nowIso,
  };
  m.mandateHash = computeMandateHash(m);
  ctx.db.prepare(INSERT).run({
    id: m.id, version: m.version, userId: m.userId, agentId: m.agentId, walletAccountId: m.walletAccountId, network: m.network,
    assetId: m.assetId, assetDecimals: m.assetDecimals, total: m.totalBudgetAtomic, cap: m.perPaymentCapAtomic,
    auto: m.autoApproveCapAtomic, merchants: JSON.stringify(m.allowedMerchantIds), maxP: m.maxPurchasesPerRun,
    maxD: m.maxRunDurationSeconds, validFrom: m.validFrom, expiresAt: m.expiresAt, spent: m.spentAtomic,
    reserved: m.reservedAtomic, hash: m.mandateHash, createdAt: m.createdAt,
  });
  return m;
}

export function createMandateDraft(ctx: Ctx, userId: string, draft: MandateDraft): Mandate {
  const d = validateDraft(draft, ctx.now());
  const { agentId, walletAccountId } = ensureUserAndAgent(ctx, userId);
  const hbar = (ctx.env.ASSET_MODE ?? "").toLowerCase() === "hbar";
  return insertDraft(ctx, {
    id: newId("mdt_"), version: 1, userId, agentId, walletAccountId,
    network: (ctx.env.HEDERA_NETWORK ?? "hedera:testnet") as Mandate["network"],
    assetId: hbar ? "0.0.0" : ctx.env.USDC_TOKEN_ID ?? "0.0.429274", assetDecimals: hbar ? 8 : 6,
    spentAtomic: "0", reservedAtomic: "0",
  }, d);
}

const latestRow = (ctx: Ctx, id: string) =>
  ctx.db.prepare("SELECT * FROM mandates WHERE id = ? ORDER BY version DESC LIMIT 1").get(id) as Record<string, any> | undefined;

export function createMandateVersion(ctx: Ctx, mandateId: string, patch: Partial<MandateDraft>): Mandate {
  return ctx.db.transaction(() => {
    const r = latestRow(ctx, mandateId);
    if (!r) throw new Error("MANDATE_NOT_FOUND");
    const prev = mandateOf(r);
    if (prev.state === "REVOKED" || prev.revokedAt) bad("REVOKED");
    const merged: MandateDraft = {
      totalBudgetAtomic: prev.totalBudgetAtomic, perPaymentCapAtomic: prev.perPaymentCapAtomic,
      autoApproveCapAtomic: prev.autoApproveCapAtomic, allowedMerchantIds: prev.allowedMerchantIds,
      maxPurchasesPerRun: prev.maxPurchasesPerRun, maxRunDurationSeconds: prev.maxRunDurationSeconds, expiresAt: prev.expiresAt,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    };
    return insertDraft(ctx, {
      id: prev.id, version: prev.version + 1, userId: prev.userId, agentId: prev.agentId, walletAccountId: prev.walletAccountId,
      network: prev.network, assetId: prev.assetId, assetDecimals: prev.assetDecimals,
      spentAtomic: prev.spentAtomic, reservedAtomic: prev.reservedAtomic,
    }, validateDraft(merged, ctx.now()));
  }).immediate();
}

export function refreshMandate(ctx: Ctx, id: string, version: number): Mandate {
  return ctx.db.transaction(() => {
    const row = ctx.db.prepare("SELECT * FROM mandates WHERE id = ? AND version = ?").get(id, version) as Record<string, any> | undefined;
    if (!row) throw new Error("MANDATE_NOT_FOUND");
    const m = mandateOf(row);
    const set = (state: Mandate["state"]): Mandate => {
      ctx.db.prepare("UPDATE mandates SET state = ? WHERE id = ? AND version = ?").run(state, id, version);
      return { ...m, state };
    };
    if (m.state === "REVOKED" || m.state === "EXPIRED") return m;
    if (m.revokedAt) return set("REVOKED");
    const expired = new Date(m.expiresAt).getTime() <= ctx.now().getTime();
    if (expired && (m.state === "ACTIVE" || m.state === "EXHAUSTED" || m.state === "PENDING_APPROVAL")) return set("EXPIRED");
    if (m.state !== "ACTIVE" && m.state !== "EXHAUSTED") return m; // DRAFT, PENDING_APPROVAL stay as they are
    const available = subA(subA(m.totalBudgetAtomic, m.spentAtomic), m.reservedAtomic);
    const low = cmpA(available, ctx.minPriceAtomic) < 0;
    if (m.state === "ACTIVE" && low) return set("EXHAUSTED");
    if (m.state === "EXHAUSTED" && !low) {
      try { return set("ACTIVE"); } catch { return m; } // another version is ACTIVE (unique index): stay EXHAUSTED
    }
    return m;
  }).immediate();
}

export function getMandate(ctx: Ctx, mandateId: string, version?: number): Mandate | null {
  const r = (version === undefined
    ? latestRow(ctx, mandateId)
    : ctx.db.prepare("SELECT * FROM mandates WHERE id = ? AND version = ?").get(mandateId, version)) as Record<string, any> | undefined;
  return r ? refreshMandate(ctx, r.id, r.version) : null;
}

export function getActiveMandate(ctx: Ctx, userId: string): Mandate | null {
  const rows = ctx.db.prepare("SELECT id, version FROM mandates WHERE user_id = ? AND state IN ('ACTIVE','EXHAUSTED') ORDER BY created_at, version")
    .all(userId) as { id: string; version: number }[];
  const fresh = rows.map((r) => refreshMandate(ctx, r.id, r.version));
  return fresh.find((m) => m.state === "ACTIVE") ?? null;
}

export function revokeMandate(ctx: Ctx, mandateId: string): Mandate {
  return ctx.db.transaction(() => {
    if (!latestRow(ctx, mandateId)) throw new Error("MANDATE_NOT_FOUND");
    ctx.db.prepare("UPDATE mandates SET state = 'REVOKED', revoked_at = ? WHERE id = ? AND state NOT IN ('REVOKED','EXPIRED')")
      .run(ctx.now().toISOString(), mandateId);
    return mandateOf(latestRow(ctx, mandateId)!);
  }).immediate();
}

export function getPreferences(ctx: Ctx, userId: string): UserPreferences | null {
  const r = ctx.db.prepare("SELECT user_id, text, updated_at FROM user_preferences WHERE user_id = ?").get(userId) as
    { user_id: string; text: string; updated_at: string } | undefined;
  return r ? { userId: r.user_id, text: r.text, updatedAt: r.updated_at } : null;
}

export function setPreferences(ctx: Ctx, userId: string, text: string): void {
  if (typeof text !== "string" || text.length > 2000) throw new Error("INVALID_PREFERENCES");
  const nowIso = ctx.now().toISOString();
  ctx.db.transaction(() => {
    ctx.db.prepare("INSERT OR IGNORE INTO users (id, display_name, created_at) VALUES (?, 'Demo user', ?)").run(userId, nowIso);
    ctx.db.prepare("INSERT INTO user_preferences (user_id, text, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at")
      .run(userId, text, nowIso);
  }).immediate();
}
