// Row <-> entity mappers shared by every trust module. JSON columns hold structured fields; money stays a TEXT atomic string.
import type { InferenceCall, Mandate, Purchase, Quote, ResearchRun } from "@tollbooth/contracts";

type Row = Record<string, any>;
const json = <T>(s: string | null | undefined): T | undefined => (s == null ? undefined : (JSON.parse(s) as T));
export const toJson = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));

export const mandateOf = (r: Row): Mandate => ({
  id: r.id, version: r.version, state: r.state, userId: r.user_id, agentId: r.agent_id, walletAccountId: r.wallet_account_id,
  network: r.network, assetId: r.asset_id, assetDecimals: r.asset_decimals,
  totalBudgetAtomic: r.total_budget, perPaymentCapAtomic: r.per_payment_cap, autoApproveCapAtomic: r.auto_approve_cap,
  allowedMerchantIds: JSON.parse(r.allowed_merchant_ids), maxPurchasesPerRun: r.max_purchases_per_run,
  maxRunDurationSeconds: r.max_run_duration_seconds, validFrom: r.valid_from, expiresAt: r.expires_at, revokedAt: r.revoked_at,
  spentAtomic: r.spent, reservedAtomic: r.reserved, mandateHash: r.mandate_hash,
  activationApprovalId: r.activation_approval_id, createdAt: r.created_at,
});

export const runOf = (r: Row): ResearchRun => ({
  id: r.id, userId: r.user_id, mandateId: r.mandate_id, mandateVersion: r.mandate_version, question: r.question,
  state: r.state, startedAt: r.started_at,
  ...(r.finished_at != null && { finishedAt: r.finished_at }),
  ...(r.answer != null && { answer: json(r.answer) }),
  ...(r.failure_reason != null && { failureReason: r.failure_reason }),
  ...(r.plan != null && { plan: json(r.plan) }),
});

export const quoteOf = (r: Row): Quote & { policyResult?: import("@tollbooth/contracts").PolicyResult } => ({
  id: r.id, runId: r.run_id, merchantId: r.merchant_id, method: r.method, origin: r.origin, path: r.path,
  requestHash: r.request_hash, network: r.network, assetId: r.asset_id, amountAtomic: r.amount, payTo: r.pay_to,
  facilitatorUrl: r.facilitator_url, feePayer: r.fee_payer, maxTimeoutSeconds: r.max_timeout_seconds,
  rawRequirements: r.raw_requirements, receivedAt: r.received_at, localExpiresAt: r.local_expires_at, quoteHash: r.quote_hash,
  ...(r.policy_result != null && { policyResult: json(r.policy_result) }),
});

export const purchaseOf = (r: Row): Purchase => ({
  id: r.id, runId: r.run_id, quoteId: r.quote_id, quoteHash: r.quote_hash, mandateId: r.mandate_id, mandateVersion: r.mandate_version,
  state: r.state, delivery: r.delivery, purchaseHash: r.purchase_hash, createdAt: r.created_at, updatedAt: r.updated_at,
  ...(r.policy_result != null && { policyResult: json(r.policy_result) }),
  ...(r.decision != null && { decision: json(r.decision) }),
  ...(r.approval_id != null && { approvalId: r.approval_id }),
  ...(r.permit_id != null && { permitId: r.permit_id }),
  ...(r.hedera_tx_id != null && { hederaTxId: r.hedera_tx_id }),
  ...(r.settlement != null && { settlement: json(r.settlement) }),
  ...(r.delivery_issues != null && { deliveryIssues: json(r.delivery_issues) }),
});

export const inferenceOf = (r: Row): InferenceCall => ({
  id: r.id, runId: r.run_id, kind: r.kind, model: r.model, trustTier: r.trust_tier, zgRequestId: r.zg_request_id,
  provider: r.provider, teeVerified: r.tee_verified == null ? null : r.tee_verified === 1, totalCost: r.total_cost,
  latencyMs: r.latency_ms, inputHash: r.input_hash, outputHash: r.output_hash, ok: r.ok === 1,
  ...(r.error != null && { error: r.error }),
});
