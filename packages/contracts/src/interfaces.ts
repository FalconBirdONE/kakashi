import type { Atomic } from "./money.js";
import type { SigningPermit } from "./permit.js";
import type { AuthPurpose, DeliveryState, PurchaseState } from "./enums.js";
import type { BrainError, RailsError } from "./errors.js";
import type {
  AgentDecision, AuditEvent, AuthAttemptPublic, AuthorizeResult, CatalogEntry, DecideOutput,
  InferenceCall, InferenceTrace, LedgerView, Mandate, MandateDraft, Need, PlanOutput, PolicyResult,
  Purchase, Quote, ResearchRun, RunView, SettlementInfo, SynthesisOutput, UserPreferences,
} from "./entities.js";

// SPEC §7.6

// ---- B1 rails ----
export type SignerStatus =
  | {state:'SIGNED';paymentHeader:string;hederaTxId:string}
  | {state:'NOT_FOUND'|'SIGNING'|'FAILED'|'REFUSED'|'UNAVAILABLE'};
export interface Rails {
  restoreRequest?(quote:Quote,query:Record<string,string>):void;
  signerStatus?(permit:SigningPermit):Promise<SignerStatus>;
  getCatalog(): Promise<CatalogEntry[]>;
  fetchQuote(merchantId: string, query: Record<string, string>):
    Promise<{ ok: true; quote: Omit<Quote, "id" | "runId"> } | { ok: false; error: RailsError }>;
  signPayment(permit: SigningPermit, requirementsB64: string):
    Promise<{ ok: true; paymentHeader: string; hederaTxId: string } | { ok: false; error: RailsError }>;
  submitPaidRequest(quote: Quote, paymentHeader: string):
    Promise<{ outcome: "SETTLED" | "REJECTED" | "NO_RESPONSE"; body?: unknown; settlement?: SettlementInfo; error?: RailsError }>;
  checkSettlement(hederaTxId: string, expect: { payTo: string; assetId: string; amountAtomic: Atomic }):
    Promise<"SUCCESS" | "FAILED" | "NOT_FOUND" | "MISMATCH">;
  recoverDelivery(merchantId: string, hederaTxId: string, requestHash: string):
    Promise<{ ok: boolean; body?: unknown }>;
  validateDelivery(merchantId: string, query: Record<string, string>, body: unknown):
    { valid: boolean; issues: string[] };
  publishAudit(event: { id: string; json: string }):
    Promise<{ topicId: string; sequenceNumber: number; consensusTimestamp: string }>;
}

// ---- B2 brain ----
export type Traced<T> =
  | { ok: true; value: T; trace: InferenceTrace; attempts?: import("./inference.js").InferenceAttempt[] }
  | { ok: false; error: BrainError; trace?: InferenceTrace; attempts?: import("./inference.js").InferenceAttempt[] };

export type PlanInput = {
  accounting?: import("./inference.js").InferenceAccounting;
  question: string; preferences?: string; catalog: CatalogEntry[];
  budgetRemainingAtomic: Atomic; perPaymentCapAtomic: Atomic; assetDecimals: number;
};
export type DecideInput = {
  accounting?: import("./inference.js").InferenceAccounting;
  question: string; preferences?: string; needs: Need[];
  quotes: {
    quoteId: string; merchantId: string; amountAtomic: Atomic;
    capabilities: string[]; coverage: string; freshnessSeconds: number;
    referencePrice: { min: Atomic; max: Atomic };
  }[];
  alreadyBought: { merchantId: string; needId: string; valid: boolean }[];
  budgetRemainingAtomic: Atomic; purchasesRemaining: number; round: 1 | 2;
};
export type SynthesisInput = {
  accounting?: import("./inference.js").InferenceAccounting;
  question: string; preferences?: string;
  evidence: { purchaseId: string; merchantId: string; valid: boolean; issues: string[]; data: unknown }[];
  gaps: string[];
};

export interface Brain {
  plan(i: PlanInput): Promise<Traced<PlanOutput>>;
  decide(i: DecideInput): Promise<Traced<DecideOutput>>;
  synthesize(i: SynthesisInput): Promise<Traced<SynthesisOutput>>;
}

// ---- B3 trust ----
export interface Trust {
  persistence?: import("./persistence.js").Persistence;
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
