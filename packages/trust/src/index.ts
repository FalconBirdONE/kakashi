import type { Trust } from "@tollbooth/contracts";
import { createCtx, type Ctx } from "./db";
import * as mandates from "./mandates";
import * as purchases from "./purchases";
import * as runs from "./runs";
import * as views from "./views";
import * as authz from "./authorize";

const later = (name: string) => () => {
  throw new Error(`trust.${name}: not implemented yet`);
};

export type TrustOptions = { now?: () => Date; ctx?: Ctx };

export function createTrust(env: Record<string, string | undefined> = process.env, opts: TrustOptions = {}): Trust {
  const ctx = opts.ctx ?? createCtx(env, { now: opts.now });
  return {
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
    // later prompts: World auth, permit hand-off, audit outbox
    startAuth: later("startAuth"),
    pollAuth: later("pollAuth"),
    getPermitForPurchase: later("getPermitForPurchase"),
    listPendingAudit: later("listPendingAudit"),
    markAnchored: later("markAnchored"),
    markAuditRetry: later("markAuditRetry"),
  } as Trust;
}

export { createCtx } from "./db";
export type { Ctx } from "./db";
// Used by the World approval flow (pollAuth, next prompt); not part of the Trust interface.
export { issuePermitAfterApproval } from "./authorize";
export { evaluate, policyConfigFromEnv } from "./policy";
