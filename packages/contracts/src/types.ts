import type { Atomic } from "./money";

// ---------- enums & state machines (SPEC §7.3) ----------
export type MandateState = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "REVOKED" | "EXHAUSTED";
export type AuthPurpose = "ACTIVATE_MANDATE" | "APPROVE_PURCHASE";
export type AuthAttemptResult =
  | "PENDING" | "VERIFIED" | "DENIED" | "EXPIRED" | "CANCELLED" | "ERROR" | "IDENTITY_MISMATCH" | "SUPERSEDED";
export type RunState = "PLANNING" | "QUOTING" | "DECIDING" | "PURCHASING" | "SYNTHESIZING" | "DONE" | "PARTIAL" | "FAILED";
export type PurchaseState =
  | "PROPOSED" | "POLICY_REJECTED" | "AGENT_SKIPPED" | "AWAITING_APPROVAL" | "APPROVAL_DENIED"
  | "RESERVED" | "SIGNED" | "SUBMITTED" | "CONFIRMED" | "FAILED_FINAL" | "UNKNOWN";
export type DeliveryState = "NOT_RECEIVED" | "RECEIVED_VALID" | "RECEIVED_INVALID" | "RECOVERED";
export type AuditState = "PENDING" | "ANCHORED" | "RETRYING";

export const PURCHASE_TRANSITIONS: Record<PurchaseState, readonly PurchaseState[]> = {
  PROPOSED: ["POLICY_REJECTED", "AGENT_SKIPPED", "RESERVED", "AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["RESERVED", "APPROVAL_DENIED"],
  RESERVED: ["SIGNED", "FAILED_FINAL"],
  SIGNED: ["SUBMITTED", "FAILED_FINAL"],
  SUBMITTED: ["CONFIRMED", "FAILED_FINAL", "UNKNOWN"],
  UNKNOWN: ["CONFIRMED", "FAILED_FINAL"],
  POLICY_REJECTED: [], AGENT_SKIPPED: [], APPROVAL_DENIED: [], CONFIRMED: [], FAILED_FINAL: [],
};
/** Entering these adds to `reserved`; CONFIRMED moves reserved->spent; the next two release it. */
export const RESERVING_STATES: readonly PurchaseState[] = ["RESERVED", "AWAITING_APPROVAL"];
export const RELEASING_STATES: readonly PurchaseState[] = ["APPROVAL_DENIED", "FAILED_FINAL"];

// ---------- error / reason codes (SPEC §7.8) ----------
export type PolicyReason =
  | "MANDATE_INACTIVE" | "MANDATE_EXPIRED" | "MERCHANT_NOT_ALLOWED" | "RECIPIENT_MISMATCH"
  | "ASSET_MISMATCH" | "NETWORK_MISMATCH" | "FEEPAYER_NOT_ALLOWED" | "OVER_PER_PAYMENT_CAP"
  | "OVER_BUDGET" | "MAX_PURCHASES_REACHED" | "PRICE_ANOMALY" | "QUOTE_EXPIRED"
  | "DUPLICATE_REQUEST" | "RUN_TIME_EXCEEDED";
export type PolicyResult = { allowed: boolean; reasons: PolicyReason[]; needsApproval: boolean };
export type RailsError =
  | "QUOTE_NOT_402" | "BAD_REQUIREMENTS_HEADER" | "UNKNOWN_MERCHANT" | "SIGNER_REFUSED"
  | "SIGNER_UNREACHABLE" | "NETWORK" | "SETTLEMENT_REJECTED" | "MIRROR_UNAVAILABLE";
export type BrainError =
  | "ZG_UNAVAILABLE" | "NO_PROVIDER_FOR_TRUST_MODE" | "TEE_NOT_VERIFIED" | "SCHEMA_INVALID" | "BUDGET_EXCEEDED" | "TIMEOUT";
export class IllegalTransitionError extends Error {
  code = "ILLEGAL_TRANSITION" as const;
  constructor(from: PurchaseState, to: PurchaseState) { super(`ILLEGAL_TRANSITION ${from} -> ${to}`); }
}

// ---------- entities (SPEC §7.4) ----------
export type User = { id: string; displayName: string; createdAt: string };
export type WorldIdentity = { userId: string; iss: string; sub: string; linkedAt: string };
export type Agent = { id: string; userId: string; walletAccountId: string; createdAt: string };

export type Mandate = {
  id: string; version: number; state: MandateState;
  userId: string; agentId: string; walletAccountId: string;
  network: "hedera:testnet"; assetId: string; assetDecimals: number;
  totalBudgetAtomic: Atomic; perPaymentCapAtomic: Atomic; autoApproveCapAtomic: Atomic;
  allowedMerchantIds: string[]; maxPurchasesPerRun: number; maxRunDurationSeconds: number;
  validFrom: string; expiresAt: string; revokedAt: string | null;
  spentAtomic: Atomic; reservedAtomic: Atomic;
  mandateHash: string; activationApprovalId: string | null; createdAt: string;
};
export type MandateDraft = Pick<Mandate,
  "totalBudgetAtomic" | "perPaymentCapAtomic" | "autoApproveCapAtomic" | "allowedMerchantIds" |
  "maxPurchasesPerRun" | "maxRunDurationSeconds"> & { expiresInSeconds: number };

export type UserPreferences = { userId: string; text: string; updatedAt: string };

export type AuthAttempt = {
  id: string; userId: string; purpose: AuthPurpose; targetHash: string;
  startedAt: string; expiresAt: string; result: AuthAttemptResult;
  deviceCodeRef: string;                       // server-side only
  verificationUri: string; userCode: string;
  iss?: string; sub?: string; authTime?: number; acr?: string; amr?: string[];
};
/** What the browser may see: never deviceCodeRef. */
export type AuthAttemptPublic = Pick<AuthAttempt, "id" | "purpose" | "targetHash" | "expiresAt" | "result" | "verificationUri" | "userCode">;

export type Approval = {
  id: string; attemptId: string; purpose: AuthPurpose; targetHash: string;
  decision: "APPROVED" | "DENIED"; createdAt: string; expiresAt: string; consumedAt: string | null;
};

export type SynthesisOutput = {
  answer: string; confidence: "low" | "medium" | "high"; citations: string[];
  disagreements: string[]; gaps: string[]; suspiciousContent: string[];
};
export type ResearchRun = {
  id: string; userId: string; mandateId: string; mandateVersion: number; question: string;
  state: RunState; startedAt: string; finishedAt?: string; answer?: SynthesisOutput; failureReason?: string;
};

export type Quote = {
  id: string; runId: string; merchantId: string; method: "GET"; origin: string; path: string; requestHash: string;
  network: string; assetId: string; amountAtomic: Atomic; payTo: string; facilitatorUrl: string; feePayer: string;
  maxTimeoutSeconds: number;
  rawRequirements: string;                     // base64 PAYMENT-REQUIRED exactly as received
  receivedAt: string; localExpiresAt: string;  // min(receivedAt+60s, receivedAt+maxTimeoutSeconds)
  quoteHash: string;                           // sha256 of all fields above except raw + timestamps
};

export type SettlementInfo = { success: boolean; transaction: string; network: string; payer?: string };
export type AgentDecision = {
  quoteId: string; action: "BUY" | "SKIP";
  reasonCode: "FILLS_NEED" | "REDUNDANT" | "TOO_EXPENSIVE_FOR_VALUE" | "LOW_RELEVANCE" | "CORROBORATES_CONFLICT";
  needId: string; expectedUsefulness: number; rationale: string; inferenceId?: string;
};

export type Purchase = {
  id: string; runId: string; quoteId: string; quoteHash: string; mandateId: string; mandateVersion: number;
  state: PurchaseState; delivery: DeliveryState;
  policyResult?: PolicyResult; decision?: AgentDecision; approvalId?: string; permitId?: string;
  purchaseHash: string;                        // sha256({purchaseId, quoteHash, amountAtomic, payTo, mandateVersion})
  amountAtomic: Atomic;                        // denormalised from the quote for ledger math
  hederaTxId?: string; settlement?: SettlementInfo; deliveryIssues?: string[];
  createdAt: string; updatedAt: string;
};

export type InferenceKind = "PLAN" | "DECIDE" | "SYNTHESIZE";
export type InferenceTrace = {
  model: string; trustTier: "private" | "verified" | "standard";
  zgRequestId: string; provider: string; teeVerified: boolean | null;
  totalCost: string; latencyMs: number; inputHash: string; outputHash: string;
  independentVerified?: boolean | null;
};
export type InferenceCall = InferenceTrace & { id: string; runId: string; kind: InferenceKind; ok: boolean; error?: string };

export type AuditEventType =
  | "MANDATE_ACTIVATED" | "MANDATE_REVOKED" | "PURCHASE_DECIDED" | "APPROVAL_GRANTED" | "APPROVAL_DENIED"
  | "PURCHASE_CONFIRMED" | "PURCHASE_FAILED" | "DELIVERY_RESULT" | "RUN_COMPLETED";
/** ≤1 KB, no personal data, no question text, no World identifiers (SPEC §8.6). */
export type AuditPayload = {
  v: 1; type: AuditEventType; id: string; run?: string; pur?: string; mandateHash?: string;
  quoteHash?: string; decisionHash?: string; tx?: string; zg?: string; prev: string; ts: string;
};
export type AuditEvent = {
  id: string; type: AuditEventType; payload: AuditPayload; prevHash: string; hash: string;
  state: AuditState; topicId?: string; sequenceNumber?: number; consensusTimestamp?: string; attempts: number;
};

// ---------- permit (SPEC §7.7) ----------
export type SigningPermit = {
  permitId: string; purchaseId: string; mandateId: string; mandateVersion: number;
  network: string; assetId: string; amountAtomic: Atomic; payTo: string; feePayer: string;
  quoteHash: string; issuedAt: string; expiresAt: string;      // 60 s lifetime
  mac: string;                                                 // HMAC-SHA256(PERMIT_SECRET, canonicalJson(all other fields)), hex
};
export type AuthorizeResult =
  | { kind: "PERMIT"; permit: SigningPermit }
  | { kind: "NEEDS_APPROVAL"; purchase: Purchase }
  | { kind: "REJECTED"; reasons: PolicyReason[] };

// ---------- catalog, brain IO ----------
export type CatalogEntry = {
  id: string; name: string; path: string; capabilities: string[]; coverage: string;
  freshnessSeconds: number; responseSchemaId: string; referencePriceAtomic: { min: Atomic; max: Atomic };
  demoRole: "normal" | "adversarial"; livePriceAtomic?: Atomic;
};
export type Need = { needId: string; description: string; priority: 1 | 2 | 3 };
export type PlanInput = {
  question: string; preferences?: string; catalog: CatalogEntry[];
  budgetRemainingAtomic: Atomic; perPaymentCapAtomic: Atomic; assetDecimals: number;
};
export type PlanOutput = { needs: Need[]; query: { lat: number; lon: number; startDate: string; endDate: string } };
export type DecideInput = {
  question: string; preferences?: string; needs: Need[];
  quotes: { quoteId: string; merchantId: string; amountAtomic: Atomic; capabilities: string[]; coverage: string;
            freshnessSeconds: number; referencePrice: { min: Atomic; max: Atomic } }[];
  alreadyBought: { merchantId: string; needId: string; valid: boolean }[];
  budgetRemainingAtomic: Atomic; purchasesRemaining: number; round: 1 | 2;
};
export type DecideOutput = { decisions: AgentDecision[]; stop: boolean };
export type SynthesisInput = {
  question: string; preferences?: string;
  evidence: { purchaseId: string; merchantId: string; valid: boolean; issues: string[]; data: unknown }[];
  gaps: string[];
};
export type Traced<T> =
  | { ok: true; value: T; trace: InferenceTrace }
  | { ok: false; error: BrainError; trace?: InferenceTrace };

// ---------- read models (SPEC §9.3) ----------
export type RunView = {
  run: ResearchRun; quotes: Quote[]; purchases: (Purchase & { audit: AuditState })[];
  inferenceCalls: InferenceCall[]; needs?: Need[];
};
export type LedgerView = {
  mandate: Mandate | null; limitAtomic: Atomic; spentAtomic: Atomic; reservedAtomic: Atomic; availableAtomic: Atomic;
  dataSpendAtomic: Atomic; inferenceSpend: string; receipts: Purchase[];
};

// ---------- interfaces (SPEC §7.6) ----------
export type RailsResult<T> = ({ ok: true } & T) | { ok: false; error: RailsError };
export interface Rails {
  getCatalog(): Promise<CatalogEntry[]>;
  fetchQuote(merchantId: string, query: Record<string, string>):
    Promise<RailsResult<{ quote: Omit<Quote, "id" | "runId"> }>>;
  signPayment(permit: SigningPermit, requirementsB64: string):
    Promise<RailsResult<{ paymentHeader: string; hederaTxId: string }>>;
  submitPaidRequest(quote: Quote, paymentHeader: string):
    Promise<{ outcome: "SETTLED" | "REJECTED" | "NO_RESPONSE"; body?: unknown; settlement?: SettlementInfo; error?: RailsError }>;
  checkSettlement(hederaTxId: string, expect: { payTo: string; assetId: string; amountAtomic: Atomic }):
    Promise<"SUCCESS" | "FAILED" | "NOT_FOUND" | "MISMATCH">;
  recoverDelivery(merchantId: string, hederaTxId: string, requestHash: string): Promise<{ ok: boolean; body?: unknown }>;
  validateDelivery(merchantId: string, query: Record<string, string>, body: unknown): { valid: boolean; issues: string[] };
  publishAudit(event: { id: string; json: string }):
    Promise<{ topicId: string; sequenceNumber: number; consensusTimestamp: string }>;
}

export interface Brain {
  plan(i: PlanInput): Promise<Traced<PlanOutput>>;
  decide(i: DecideInput): Promise<Traced<DecideOutput>>;
  synthesize(i: SynthesisInput): Promise<Traced<SynthesisOutput>>;
}

export interface Trust {
  createMandateDraft(userId: string, draft: MandateDraft): Mandate;
  startAuth(userId: string, purpose: AuthPurpose, targetId: string): Promise<AuthAttemptPublic>;
  pollAuth(attemptId: string): Promise<AuthAttemptPublic>;
  revokeMandate(mandateId: string): Mandate;
  getActiveMandate(userId: string): Mandate | null;
  getPreferences(userId: string): UserPreferences | null;
  setPreferences(userId: string, text: string): void;
  createRun(userId: string, question: string): ResearchRun;
  updateRun(runId: string, patch: Partial<ResearchRun>): void;
  recordQuote(runId: string, q: Omit<Quote, "id" | "runId">): Quote;
  precheck(quoteId: string): PolicyResult;
  proposePurchase(quoteId: string, decision: AgentDecision): Purchase;
  authorize(purchaseId: string): AuthorizeResult;
  getPermitForPurchase(purchaseId: string): SigningPermit | null;
  transition(purchaseId: string, to: PurchaseState, data?: Partial<Purchase>): Purchase;
  setDelivery(purchaseId: string, d: DeliveryState, issues?: string[]): void;
  listUnresolved(): Purchase[];
  recordInference(c: Omit<InferenceCall, "id">): InferenceCall;
  listPendingAudit(limit: number): AuditEvent[];
  markAnchored(eventId: string, r: { topicId: string; sequenceNumber: number; consensusTimestamp: string }): void;
  markAuditRetry(eventId: string): void;
  getRunView(runId: string): RunView;
  getLedgerView(userId: string): LedgerView;
}
