// SPEC §7.8
export type PolicyReason =
  | "MANDATE_INACTIVE" | "MANDATE_EXPIRED" | "MERCHANT_NOT_ALLOWED" | "RECIPIENT_MISMATCH"
  | "ASSET_MISMATCH" | "NETWORK_MISMATCH" | "FEEPAYER_NOT_ALLOWED" | "OVER_PER_PAYMENT_CAP"
  | "OVER_BUDGET" | "MAX_PURCHASES_REACHED" | "PRICE_ANOMALY" | "QUOTE_EXPIRED"
  | "DUPLICATE_REQUEST" | "RUN_TIME_EXCEEDED";

export type RailsError =
  | "QUOTE_NOT_402" | "BAD_REQUIREMENTS_HEADER" | "UNKNOWN_MERCHANT" | "SIGNER_REFUSED"
  | "SIGNER_UNREACHABLE" | "NETWORK" | "SETTLEMENT_REJECTED" | "MIRROR_UNAVAILABLE";

export type BrainError =
  | "ZG_UNAVAILABLE" | "NO_PROVIDER_FOR_TRUST_MODE" | "TEE_NOT_VERIFIED"
  | "SCHEMA_INVALID" | "BUDGET_EXCEEDED" | "TIMEOUT";

/** Thrown by trust.transition for a transition not in PURCHASE_TRANSITIONS. */
export class IllegalTransitionError extends Error {
  readonly code = "ILLEGAL_TRANSITION";
  constructor(from: string, to: string) {
    super(`ILLEGAL_TRANSITION: ${from} -> ${to}`);
  }
}
