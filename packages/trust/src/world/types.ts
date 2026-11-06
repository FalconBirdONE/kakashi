// Shared World ID types: the agreed seam between client.ts / validate.ts (real World) and attempts.ts (and test fakes).

/** Validated, non-secret claims. `sub` is an identifier: store it for binding, never log it. */
export type WorldClaims = { iss: string; sub: string; authTime: number; acr?: string; amr?: string[] };

export type ValidateFailure =
  | "BAD_SIGNATURE" | "BAD_ISSUER" | "BAD_AUDIENCE" | "EXPIRED" | "MISSING_AUTH_TIME"
  | "STALE_AUTH_TIME" | "ACR_NOT_MET" | "AMR_NOT_MET" | "INVALID";
export type ValidateResult = { ok: true; claims: WorldClaims } | { ok: false; reason: ValidateFailure };

/** Device authorization response. `deviceCode` stays server-side. */
export type DeviceStart = {
  deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete?: string;
  expiresIn: number; interval: number;
};

/** One token-endpoint poll, normalised. Never carries the access token; only the ID token for validation. */
export type PollResult =
  | { status: "PENDING"; slowDown: boolean } // authorization_pending / slow_down
  | { status: "TOKEN"; idToken: string }
  | { status: "DENIED" }                     // access_denied
  | { status: "CANCELLED" }                  // only if World reports a distinct cancel code
  | { status: "EXPIRED" }                    // expired_token
  | { status: "ERROR"; code: string };       // anything else, including network failures

/** Metadata-only logger: callers must never pass tokens, device codes, secrets or `sub`. */
export type WorldLogger = (event: string, data: Record<string, string | number | boolean | undefined>) => void;

export interface WorldClient {
  startDevice(): Promise<DeviceStart>;
  pollDevice(deviceCode: string): Promise<PollResult>;
  /** startedAtMs = when the attempt started; auth_time must be >= startedAtMs - 5 s. */
  validateIdToken(idToken: string, startedAtMs: number): Promise<ValidateResult>;
}
