import { describe, expect, it } from "vitest";
import { mintPermit, verifyPermit, type PermitFields } from "../src/permit.js";

const secret = "ab".repeat(32);
const fields: PermitFields = {
  permitId: "pmt_1", purchaseId: "pur_1", mandateId: "mdt_1", mandateVersion: 1,
  network: "hedera:testnet", assetId: "0.0.1", amountAtomic: "20000", payTo: "0.0.2", feePayer: "0.0.3",
  quoteHash: "q".repeat(8), issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:01:00.000Z",
};
const now = new Date("2026-01-01T00:00:30.000Z");

describe("permit", () => {
  const p = mintPermit(fields, secret);
  it("verifies a good permit", () => {
    expect(p.mac).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyPermit(p, secret, now)).toEqual({ ok: true });
  });
  it("detects tamper of every field", () => {
    const tampered: Record<string, unknown> = {
      permitId: "pmt_2", purchaseId: "pur_2", mandateId: "mdt_2", mandateVersion: 2,
      network: "hedera:mainnet", assetId: "0.0.9", amountAtomic: "20001", payTo: "0.0.9", feePayer: "0.0.9",
      quoteHash: "z", issuedAt: "2026-01-01T00:00:01.000Z", expiresAt: "2026-01-01T00:09:00.000Z",
    };
    for (const [k, v] of Object.entries(tampered))
      expect(verifyPermit({ ...p, [k]: v }, secret, now), k).toEqual({ ok: false, reason: "BAD_MAC" });
  });
  it("bad mac forms", () => {
    expect(verifyPermit({ ...p, mac: "" }, secret, now)).toEqual({ ok: false, reason: "BAD_MAC" });
    expect(verifyPermit({ ...p, mac: "zz" }, secret, now)).toEqual({ ok: false, reason: "BAD_MAC" });
  });
  it("wrong secret", () => {
    expect(verifyPermit(p, "cd".repeat(32), now)).toEqual({ ok: false, reason: "BAD_MAC" });
  });
  it("expiry and not-yet-valid", () => {
    expect(verifyPermit(p, secret, new Date("2026-01-01T00:01:00.000Z"))).toEqual({ ok: false, reason: "EXPIRED" });
    expect(verifyPermit(p, secret, new Date("2025-12-31T23:59:59.000Z"))).toEqual({ ok: false, reason: "NOT_YET_VALID" });
  });
});
