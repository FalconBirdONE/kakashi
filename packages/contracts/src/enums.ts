// SPEC §7.3
export type MandateState = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "REVOKED" | "EXHAUSTED";

export type AuthPurpose = "ACTIVATE_MANDATE" | "APPROVE_PURCHASE";
export type AuthAttemptResult =
  | "PENDING" | "VERIFIED" | "DENIED" | "EXPIRED" | "CANCELLED"
  | "ERROR" | "IDENTITY_MISMATCH" | "SUPERSEDED";

export type RunState =
  | "PLANNING" | "QUOTING" | "DECIDING" | "PURCHASING" | "SYNTHESIZING"
  | "DONE" | "PARTIAL" | "FAILED";

export type PurchaseState =
  | "PROPOSED" | "POLICY_REJECTED" | "AGENT_SKIPPED" | "AWAITING_APPROVAL"
  | "APPROVAL_DENIED" | "RESERVED" | "SIGNED" | "SUBMITTED" | "CONFIRMED"
  | "FAILED_FINAL" | "UNKNOWN";

export type DeliveryState = "NOT_RECEIVED" | "RECEIVED_VALID" | "RECEIVED_INVALID" | "RECOVERED";
export type AuditState = "PENDING" | "ANCHORED" | "RETRYING";

// SPEC §8.6
export type AuditEventType =
  | "MANDATE_ACTIVATED" | "MANDATE_REVOKED" | "PURCHASE_DECIDED" | "APPROVAL_GRANTED"
  | "APPROVAL_DENIED" | "PURCHASE_CONFIRMED" | "PURCHASE_FAILED" | "DELIVERY_RESULT" | "RUN_COMPLETED";

export type TrustTier = "private" | "verified" | "standard";
export type InferenceKind = "PLAN" | "DECIDE" | "SYNTHESIZE";

/** Faults a merchant can be told to simulate (SPEC §9.1, §10). */
export type MerchantFault = "NONE" | "DROP_AFTER_SETTLE" | "SWAP_PAYTO" | "STALE_DATA" | "INJECT_TEXT";

/** SPEC §7.3 allowed purchase transitions. Terminal states map to []. */
export const PURCHASE_TRANSITIONS: Readonly<Record<PurchaseState, readonly PurchaseState[]>> = {
  PROPOSED: ["POLICY_REJECTED", "AGENT_SKIPPED", "RESERVED", "AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["RESERVED", "APPROVAL_DENIED"],
  RESERVED: ["SIGNED", "FAILED_FINAL"],
  SIGNED: ["SUBMITTED", "FAILED_FINAL"],
  SUBMITTED: ["CONFIRMED", "FAILED_FINAL", "UNKNOWN"],
  UNKNOWN: ["CONFIRMED", "FAILED_FINAL"],
  POLICY_REJECTED: [],
  AGENT_SKIPPED: [],
  APPROVAL_DENIED: [],
  CONFIRMED: [],
  FAILED_FINAL: [],
};

export function canTransition(from: PurchaseState, to: PurchaseState): boolean {
  return PURCHASE_TRANSITIONS[from].includes(to);
}
