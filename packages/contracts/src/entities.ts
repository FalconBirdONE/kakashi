import type { Atomic } from "./money.js";
import type {
  AuditEventType, AuditState, AuthAttemptResult, AuthPurpose, DeliveryState,
  InferenceKind, MandateState, PurchaseState, RunState, TrustTier,
} from "./enums.js";
import type { PolicyReason } from "./errors.js";
import type { SigningPermit } from "./permit.js";

// SPEC §7.4. All timestamps are ISO-8601 strings; all amounts are Atomic strings.

export type User = { id: string; displayName: string; createdAt: string };
export type WorldIdentity = { userId: string; iss: string; sub: string; linkedAt: string };
export type Agent = { id: string; userId: string; walletAccountId: string; createdAt: string };

export type Mandate = {
  id: string; version: number; state: MandateState;
  userId: string; agentId: string; walletAccountId: string;
  network: "hedera:testnet"; assetId: string; assetDecimals: number;
  totalBudgetAtomic: Atomic;
  perPaymentCapAtomic: Atomic;
  autoApproveCapAtomic: Atomic;
  allowedMerchantIds: string[];
  maxPurchasesPerRun: number;
  maxRunDurationSeconds: number;
  validFrom: string; expiresAt: string; revokedAt: string | null;
  spentAtomic: Atomic; reservedAtomic: Atomic;
  mandateHash: string;
  activationApprovalId: string | null;
  createdAt: string;
};

/** Caller-supplied fields for a new mandate draft; the rest is derived by trust. Shape chosen by us (spec silent). */
export type MandateDraft = {
  totalBudgetAtomic: Atomic;
  perPaymentCapAtomic: Atomic;
  autoApproveCapAtomic: Atomic;
  allowedMerchantIds: string[];
  maxPurchasesPerRun?: number;      // default 3
  maxRunDurationSeconds?: number;   // default 120
  expiresAt: string;
};

export type UserPreferences = { userId: string; text: string; updatedAt: string };

export type AuthAttempt = {
  id: string; userId: string; purpose: AuthPurpose;
  targetHash: string; // mandateHash or purchaseHash
  startedAt: string; expiresAt: string; result: AuthAttemptResult;
  deviceCodeRef: string; // server-side only, never sent to the browser
  verificationUri: string; userCode: string;
  iss?: string; sub?: string; authTime?: string; acr?: string; amr?: string[];
};

/** What the browser may see: AuthAttempt minus deviceCodeRef and identity claims. */
export type AuthAttemptPublic = {
  id: string; purpose: AuthPurpose; targetId: string;
  startedAt: string; expiresAt: string; result: AuthAttemptResult;
  verificationUri: string; userCode: string;
};

export type Approval = {
  id: string; attemptId: string; purpose: AuthPurpose; targetHash: string;
  decision: "APPROVED" | "DENIED";
  createdAt: string; expiresAt: string; consumedAt: string | null;
};

export type PolicyResult = { allowed: boolean; reasons: PolicyReason[]; needsApproval: boolean };

export type AuthorizeResult =
  | { kind: "PERMIT"; permit: SigningPermit }
  | { kind: "NEEDS_APPROVAL"; purchase: Purchase }
  | { kind: "REJECTED"; reasons: PolicyReason[] };

/** Decoded PAYMENT-RESPONSE (SPEC §4.1). Exact JSON is recorded in docs/rails/COMPAT.md; fields here are the minimum. */
export type SettlementInfo = {
  success: boolean;
  transaction: string; // Hedera tx id, e.g. 0.0.1235@1700000000.000000000
  network: string;
  payer?: string;
  errorReason?: string;
};

/** The brain's verdict on one quote (an element of DecideOutput.decisions). */
export type AgentDecision = {
  action: "BUY" | "SKIP";
  reasonCode: "FILLS_NEED" | "REDUNDANT" | "TOO_EXPENSIVE_FOR_VALUE" | "LOW_RELEVANCE" | "CORROBORATES_CONFLICT";
  needId: string;
  expectedUsefulness: number; // 0..1
  rationale: string;          // <= 200 chars
  inferenceCallId?: string;
};

export type ResearchRun = {
  id: string; userId: string; mandateId: string; mandateVersion: number; question: string;
  state: RunState; startedAt: string; finishedAt?: string;
  answer?: SynthesisOutput; failureReason?: string;
  /** Set by the orchestrator after PLAN so the UI can show needs from the read model. Added by us (spec silent). */
  plan?: PlanOutput;
};

export type Quote = {
  id: string; runId: string; merchantId: string; method: "GET"; origin: string; path: string; requestHash: string;
  network: string; assetId: string; amountAtomic: Atomic; payTo: string; facilitatorUrl: string; feePayer: string;
  maxTimeoutSeconds: number;
  rawRequirements: string; // base64 header exactly as received
  receivedAt: string; localExpiresAt: string; // min(receivedAt+60s, receivedAt+maxTimeoutSeconds)
  quoteHash: string; // sha256 of all fields except id, runId, raw and timestamps
};

export type Purchase = {
  id: string; runId: string; quoteId: string; quoteHash: string; mandateId: string; mandateVersion: number;
  state: PurchaseState; delivery: DeliveryState;
  policyResult?: PolicyResult; decision?: AgentDecision;
  approvalId?: string; permitId?: string;
  purchaseHash: string; // sha256({purchaseId, quoteHash, amountAtomic, payTo, mandateVersion})
  hederaTxId?: string;
  settlement?: SettlementInfo;
  deliveryIssues?: string[];
  createdAt: string; updatedAt: string;
};

export type InferenceTrace = {
  model: string; trustTier: TrustTier; zgRequestId: string; provider: string;
  teeVerified: boolean | null; totalCost: string; latencyMs: number;
  inputHash: string; outputHash: string;
  independentVerified?: boolean; // stretch (SPEC §9.2.5)
};

export type InferenceCall = {
  id: string; runId: string; kind: InferenceKind;
  requestKey?: string; billingState?: "CONFIRMED" | "UNKNOWN";
  model: string; trustTier: TrustTier;
  zgRequestId: string; provider: string; teeVerified: boolean | null;
  totalCost: string; latencyMs: number;
  inputHash: string; outputHash: string; ok: boolean; error?: string;
};

/** Compact audit payload, <= 1 KB, no personal data (SPEC §8.6). */
export type AuditPayload = {
  v: 1; type: AuditEventType; id: string;
  run?: string; pur?: string; mandateHash?: string; quoteHash?: string; decisionHash?: string;
  tx?: string; zg?: string; prev: string; ts: string;
};

export type AuditEvent = {
  id: string; type: AuditEventType; payload: AuditPayload; prevHash: string; hash: string;
  state: AuditState; topicId?: string; sequenceNumber?: number; consensusTimestamp?: string; attempts: number;
};

// ---- Brain I/O types (SPEC §9.2). Zod schemas for the outputs live in schemas.ts. ----
export type Need = { needId: string; description: string; priority: 1 | 2 | 3 };

export type PlanOutput = {
  needs: Need[];
  query: { lat: number; lon: number; startDate: string; endDate: string };
};
export type DecisionItem = AgentDecision & { quoteId: string };
export type DecideOutput = { decisions: DecisionItem[]; stop: boolean };
export type SynthesisOutput = {
  answer: string; confidence: "low" | "medium" | "high";
  citations: string[]; disagreements: string[]; gaps: string[]; suspiciousContent: string[];
};

export type CatalogEntry = {
  id: string; name: string; path: string; capabilities: string[]; coverage: string;
  freshnessSeconds: number; responseSchemaId: string;
  referencePriceAtomic: { min: Atomic; max: Atomic }; // configured, not observed
  priceAtomic: Atomic; // live price from the merchant
  demoRole: "normal" | "adversarial";
};

// ---- Read models (SPEC §9.3.8). The UI shows these numbers exactly as provided. ----
export type RunView = {
  run: ResearchRun;
  quotes: (Quote & { policyResult?: PolicyResult })[];
  purchases: Purchase[];
  inferenceCalls: InferenceCall[];
};

export type LedgerView = {
  mandate: Mandate | null;
  limitAtomic: Atomic; spentAtomic: Atomic; reservedAtomic: Atomic; availableAtomic: Atomic;
  dataSpendAtomic: Atomic;          // sum of CONFIRMED purchases
  inferenceBillingPending?: boolean;
  inferenceSpend: string;           // sum of 0G total_cost, decimal string in 0G credits; NOT counted against the mandate
  receipts: { purchaseId: string; merchantId: string; amountAtomic: Atomic; hederaTxId: string; zgRequestId?: string; at: string }[];
};
