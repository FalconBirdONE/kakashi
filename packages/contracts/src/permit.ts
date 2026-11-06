import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "./hash.js";
import type { Atomic } from "./money.js";

export type SigningPermit = {
  permitId: string; purchaseId: string; mandateId: string; mandateVersion: number;
  network: string; assetId: string; amountAtomic: Atomic; payTo: string; feePayer: string;
  quoteHash: string; issuedAt: string; expiresAt: string;
  mac: string;
};
export type PermitFields = Omit<SigningPermit, "mac">;

const mac = (fields: PermitFields, secretHex: string): string =>
  createHmac("sha256", Buffer.from(secretHex, "hex")).update(canonicalJson(fields)).digest("hex");

export function mintPermit(fields: PermitFields, secretHex: string): SigningPermit {
  return { ...fields, mac: mac(fields, secretHex) };
}

export function verifyPermit(
  permit: SigningPermit,
  secretHex: string,
  now: Date,
): { ok: true } | { ok: false; reason: "BAD_MAC" | "EXPIRED" | "NOT_YET_VALID" } {
  const { mac: given, ...fields } = permit;
  const want = Buffer.from(mac(fields, secretHex), "hex");
  const got = Buffer.from(typeof given === "string" ? given : "", "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "BAD_MAC" };
  const t = now.getTime();
  if (!Number.isFinite(t) || !(t < Date.parse(fields.expiresAt))) return { ok: false, reason: "EXPIRED" };
  if (!(t >= Date.parse(fields.issuedAt))) return { ok: false, reason: "NOT_YET_VALID" };
  return { ok: true };
}
