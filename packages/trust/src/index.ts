import { createPersistence } from "./persistence.js";
import type { Trust } from "@kakashi/contracts";
import { createCtx, type Ctx } from "./db.js";
import * as mandates from "./mandates.js";
import * as purchases from "./purchases.js";
import * as runs from "./runs.js";
import * as views from "./views.js";
import * as authz from "./authorize.js";
import * as attempts from "./world/attempts.js";
import * as outbox from "./outbox.js";
import { createWorldClient } from "./world/client.js";
import type { WorldClient, WorldLogger } from "./world/types.js";

/** `world` is the test seam: inject a fake WorldClient to simulate every World result. */
export type TrustOptions = { now?: () => Date; ctx?: Ctx; world?: WorldClient; logger?: WorldLogger };

export function createTrust(env: Record<string, string | undefined> = process.env, opts: TrustOptions = {}): Trust {
  const ctx = opts.ctx ?? createCtx(env, { now: opts.now });
  // createWorldClient reads credentials on first use, so a trust without World creds still boots.
  const auth = { world: opts.world ?? createWorldClient(env, { logger: opts.logger }), logger: opts.logger };
  return {
    persistence: createPersistence(ctx),
    // identity and mandates
    createMandateDraft: (userId, draft) => mandates.createMandateDraft(ctx, userId, draft),
    revokeMandate: (id) => mandates.revokeMandate(ctx, id),
    getActiveMandate: (userId) => mandates.getActiveMandate(ctx, userId),
    getPreferences: (userId) => mandates.getPreferences(ctx, userId),
    setPreferences: (userId, text) => mandates.setPreferences(ctx, userId, text),
    // runs, quotes, purchases
    createRun: (userId, q) => runs.createRun(ctx, userId, q),
    updateRun: (id, patch) => runs.updateRun(ctx, id, patch),
    recordQuote: (runId, q) => purchases.recordQuote(ctx, runId, q),
    proposePurchase: (quoteId, d) => purchases.proposePurchase(ctx, quoteId, d),
    transition: (id, to, data) => purchases.transition(ctx, id, to, data),
    setDelivery: (id, d, issues) => purchases.setDelivery(ctx, id, d, issues),
    listUnresolved: () => purchases.listUnresolved(ctx),
    recordInference: (c) => purchases.recordInference(ctx, c),
    // read models
    getRunView: (runId) => views.getRunView(ctx, runId),
    getLedgerView: (userId) => views.getLedgerView(ctx, userId),
    // policy and authorization
    precheck: (quoteId) => authz.precheck(ctx, quoteId),
    authorize: (purchaseId) => authz.authorize(ctx, purchaseId),
    // World ID: activation and purchase step-up
    startAuth: (userId, purpose, targetId) => attempts.startAuth(ctx, auth, userId, purpose, targetId),
    pollAuth: (attemptId) => attempts.pollAuth(ctx, auth, attemptId),
    getPermitForPurchase: (purchaseId) => attempts.getPermitForPurchase(ctx, purchaseId),
    // audit outbox (worker lives in the app; rails publishes to HCS)
    listPendingAudit: (limit) => outbox.listPendingAudit(ctx, limit),
    markAnchored: (eventId, r) => outbox.markAnchored(ctx, eventId, r),
    markAuditRetry: (eventId) => outbox.markAuditRetry(ctx, eventId),
  } satisfies Trust;
}

export { createCtx } from "./db.js";
export type { Ctx } from "./db.js";
// Internal to the World approval flow; exported for tests and scripts, not part of the Trust interface.
export { issuePermitAfterApproval } from "./authorize.js";
export { verifyAuditChain } from "./outbox.js";
export type { WorldClient, WorldClaims, PollResult, DeviceStart, ValidateResult, WorldLogger } from "./world/types.js";
export { evaluate, policyConfigFromEnv } from "./policy.js";
