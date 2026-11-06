// Server-side ID token validation (SPEC §8.2 step 5). Never throws for a bad token; never logs.
import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import type { ValidateFailure, ValidateResult } from "./types";

export type ValidateConfig = { issuer: string; clientId: string; requiredAcr?: string; requiredAmr?: string[]; clockToleranceSec?: number };

const AUTH_TIME_SKEW_MS = 5000;

function mapError(e: unknown): ValidateFailure {
  if (e instanceof errors.JWTExpired) return "EXPIRED";
  if (e instanceof errors.JWTClaimValidationFailed) {
    if (e.claim === "iss") return "BAD_ISSUER";
    if (e.claim === "aud") return "BAD_AUDIENCE";
    if (e.claim === "auth_time") return "MISSING_AUTH_TIME";
    return "INVALID";
  }
  if (e instanceof errors.JWSSignatureVerificationFailed || e instanceof errors.JWKSNoMatchingKey
    || e instanceof errors.JWKSMultipleMatchingKeys || e instanceof errors.JWKSInvalid
    || e instanceof errors.JWKSTimeout || e instanceof errors.JWKInvalid) return "BAD_SIGNATURE";
  return "INVALID";
}

export async function validateIdToken(
  idToken: string, keys: JWTVerifyGetKey, cfg: ValidateConfig, startedAtMs: number, now?: Date,
): Promise<ValidateResult> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, keys, {
      issuer: cfg.issuer, audience: cfg.clientId, algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "auth_time", "sub"],
      ...(now ? { currentDate: now } : {}),
      ...(cfg.clockToleranceSec !== undefined ? { clockTolerance: cfg.clockToleranceSec } : {}),
    }));
  } catch (e) {
    return { ok: false, reason: mapError(e) };
  }
  const { iss, sub, auth_time: authTime, acr, amr } = payload;
  if (typeof authTime !== "number") return { ok: false, reason: "MISSING_AUTH_TIME" };
  if (authTime * 1000 < startedAtMs - AUTH_TIME_SKEW_MS) return { ok: false, reason: "STALE_AUTH_TIME" };
  if (cfg.requiredAcr && acr !== cfg.requiredAcr) return { ok: false, reason: "ACR_NOT_MET" };
  const amrList = Array.isArray(amr) ? amr.filter((v): v is string => typeof v === "string") : undefined;
  if (cfg.requiredAmr?.length && !(amrList && cfg.requiredAmr.every((v) => amrList.includes(v)))) return { ok: false, reason: "AMR_NOT_MET" };
  if (typeof iss !== "string" || typeof sub !== "string") return { ok: false, reason: "INVALID" };
  return {
    ok: true,
    claims: { iss, sub, authTime, ...(typeof acr === "string" ? { acr } : {}), ...(amrList ? { amr: amrList } : {}) },
  };
}
