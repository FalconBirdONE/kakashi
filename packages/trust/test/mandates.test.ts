import { afterEach, describe, expect, it } from "vitest";
import type { MandateDraft } from "@kakashi/contracts";
import {
  computeMandateHash, createMandateDraft, createMandateVersion, getActiveMandate, getMandate, getPreferences,
  revokeMandate, setPreferences,
} from "../src/mandates";
import { verifyAuditChain } from "../src/outbox";
import { MIN, USER, activeMandate, budget, cleanup, draft, iso, makeFx, propose, setup, step } from "./helpers";

afterEach(cleanup);

describe("createMandateDraft", () => {
  it("returns a version 1 DRAFT with zero spent/reserved and a 64-hex hash", () => {
    const fx = makeFx();
    const m = createMandateDraft(fx.ctx, USER, draft(fx));
    expect(m).toMatchObject({
      version: 1, state: "DRAFT", spentAtomic: "0", reservedAtomic: "0", revokedAt: null, activationApprovalId: null,
      network: "hedera:testnet", assetId: "0.0.429274", assetDecimals: 6, maxPurchasesPerRun: 3, maxRunDurationSeconds: 120,
    });
    expect(m.mandateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.id).toMatch(/^mdt_/);
    expect(getMandate(fx.ctx, m.id)).toEqual(m);
  });

  it("creates the user and agent with the wallet from AGENT_ACCOUNT_ID", () => {
    const fx = makeFx();
    const m = createMandateDraft(fx.ctx, USER, draft(fx));
    expect(fx.ctx.db.prepare("SELECT id FROM users WHERE id=?").get(USER)).toEqual({ id: USER });
    expect(fx.ctx.db.prepare("SELECT id, wallet_account_id FROM agents WHERE user_id=?").get(USER))
      .toEqual({ id: m.agentId, wallet_account_id: "0.0.2000" });
    expect(m.walletAccountId).toBe("0.0.2000");
    // second draft reuses the same agent
    expect(createMandateDraft(fx.ctx, USER, draft(fx)).agentId).toBe(m.agentId);
  });

  it("throws when AGENT_ACCOUNT_ID is not set", () => {
    const fx = makeFx({ AGENT_ACCOUNT_ID: undefined });
    expect(() => createMandateDraft(fx.ctx, USER, draft(fx))).toThrow("AGENT_ACCOUNT_ID not set");
  });

  it("ASSET_MODE=hbar gives asset 0.0.0 with 8 decimals", () => {
    const fx = makeFx({ ASSET_MODE: "hbar" });
    expect(createMandateDraft(fx.ctx, USER, draft(fx))).toMatchObject({ assetId: "0.0.0", assetDecimals: 8 });
  });

  describe("validation", () => {
    const cases: [string, (fx: ReturnType<typeof makeFx>) => Partial<MandateDraft>][] = [
      ["perPaymentCap > total", () => ({ perPaymentCapAtomic: "200001" })],
      ["autoApprove > perPaymentCap", () => ({ autoApproveCapAtomic: "100001" })],
      ["unknown merchant", () => ({ allowedMerchantIds: ["quickcast", "nope"] })],
      ["empty merchants", () => ({ allowedMerchantIds: [] })],
      ["non-atomic total (decimal)", () => ({ totalBudgetAtomic: "12.5" })],
      ["non-atomic total (negative)", () => ({ totalBudgetAtomic: "-1" })],
      ["non-atomic total (leading zero)", () => ({ totalBudgetAtomic: "0100" })],
      ["expiresAt in the past", (fx) => ({ expiresAt: iso(fx.clock.t - 1000) })],
      ["expiresAt equal to now", (fx) => ({ expiresAt: iso(fx.clock.t) })],
      ["expiresAt not a date", () => ({ expiresAt: "soon" })],
    ];
    it.each(cases)("rejects %s", (_n, over) => {
      const fx = makeFx();
      expect(() => createMandateDraft(fx.ctx, USER, draft(fx, over(fx)))).toThrow(/^INVALID_MANDATE/);
    });
  });
});

describe("mandate hash", () => {
  it("ignores state/spent/reserved", () => {
    const fx = makeFx();
    const m = createMandateDraft(fx.ctx, USER, draft(fx));
    expect(computeMandateHash(m)).toBe(m.mandateHash);
    expect(computeMandateHash({ ...m, state: "ACTIVE", spentAtomic: "5", reservedAtomic: "7" })).toBe(m.mandateHash);
  });

  it("changes with totalBudget, expiresAt or allowed merchants", () => {
    const fx = makeFx();
    const m = createMandateDraft(fx.ctx, USER, draft(fx));
    const h = new Set([
      m.mandateHash,
      computeMandateHash({ ...m, totalBudgetAtomic: "200001" }),
      computeMandateHash({ ...m, expiresAt: iso(fx.clock.t + 31 * MIN) }),
      computeMandateHash({ ...m, allowedMerchantIds: ["quickcast"] }),
    ]);
    expect(h.size).toBe(4);
  });

  it("does not depend on merchant order", () => {
    const fx = makeFx();
    const m = createMandateDraft(fx.ctx, USER, draft(fx));
    expect(computeMandateHash({ ...m, allowedMerchantIds: [...m.allowedMerchantIds].reverse() })).toBe(m.mandateHash);
  });
});

describe("createMandateVersion", () => {
  it("inserts v2 DRAFT with a new hash and carries spent/reserved, leaving v1 untouched", () => {
    const fx = makeFx();
    const v1 = createMandateDraft(fx.ctx, USER, draft(fx));
    fx.ctx.db.prepare("UPDATE mandates SET spent='5000', reserved='7000' WHERE id=? AND version=1").run(v1.id);
    const before = fx.ctx.db.prepare("SELECT * FROM mandates WHERE id=? AND version=1").get(v1.id);
    const v2 = createMandateVersion(fx.ctx, v1.id, { totalBudgetAtomic: "300000" });
    expect(v2).toMatchObject({ id: v1.id, version: 2, state: "DRAFT", spentAtomic: "5000", reservedAtomic: "7000", totalBudgetAtomic: "300000" });
    expect(v2.mandateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(v2.mandateHash).not.toBe(v1.mandateHash);
    expect(fx.ctx.db.prepare("SELECT * FROM mandates WHERE id=? AND version=1").get(v1.id)).toEqual(before);
    expect(getMandate(fx.ctx, v1.id)!.version).toBe(2); // latest by default
  });

  it("throws on a REVOKED mandate", () => {
    const fx = makeFx();
    const v1 = createMandateDraft(fx.ctx, USER, draft(fx));
    revokeMandate(fx.ctx, v1.id);
    expect(() => createMandateVersion(fx.ctx, v1.id, { totalBudgetAtomic: "300000" })).toThrow(/INVALID_MANDATE/);
  });
});

describe("revokeMandate", () => {
  it("is immediate, stamps every version, clears the active mandate, and is idempotent", () => {
    const fx = makeFx();
    const v1 = activeMandate(fx);
    createMandateVersion(fx.ctx, v1.id, { totalBudgetAtomic: "300000" });
    fx.advance(1000);
    const r = revokeMandate(fx.ctx, v1.id);
    expect(r).toMatchObject({ version: 2, state: "REVOKED", revokedAt: iso(fx.clock.t) });
    const rows = fx.ctx.db.prepare("SELECT version, state, revoked_at FROM mandates WHERE id=? ORDER BY version").all(v1.id);
    expect(rows).toEqual([
      { version: 1, state: "REVOKED", revoked_at: iso(fx.clock.t) },
      { version: 2, state: "REVOKED", revoked_at: iso(fx.clock.t) },
    ]);
    expect(getActiveMandate(fx.ctx, USER)).toBeNull();
    fx.advance(1000);
    revokeMandate(fx.ctx, v1.id); // idempotent: revokedAt keeps the first timestamp
    expect(fx.ctx.db.prepare("SELECT DISTINCT revoked_at FROM mandates WHERE id=?").all(v1.id)).toEqual([{ revoked_at: iso(fx.clock.t - 1000) }]);
    // One MANDATE_REVOKED (latest version's hash); the idempotent re-revoke adds none.
    const audit = fx.ctx.db.prepare("SELECT type, payload FROM audit_events").all() as { type: string; payload: string }[];
    expect(audit.map((a) => a.type)).toEqual(["MANDATE_REVOKED"]);
    expect(JSON.parse(audit[0]!.payload).mandateHash).toBe(r.mandateHash);
    expect(verifyAuditChain(fx.ctx)).toEqual({ ok: true, count: 1 });
  });

  it("leaves an EXPIRED version EXPIRED", () => {
    const fx = makeFx();
    const v1 = activeMandate(fx);
    createMandateVersion(fx.ctx, v1.id, { expiresAt: iso(fx.clock.t + 60 * MIN) });
    fx.advance(31 * MIN);
    expect(getMandate(fx.ctx, v1.id, 1)!.state).toBe("EXPIRED");
    revokeMandate(fx.ctx, v1.id);
    expect(fx.ctx.db.prepare("SELECT version, state FROM mandates WHERE id=? ORDER BY version").all(v1.id))
      .toEqual([{ version: 1, state: "EXPIRED" }, { version: 2, state: "REVOKED" }]);
  });

  it("throws MANDATE_NOT_FOUND for an unknown id", () => {
    expect(() => revokeMandate(makeFx().ctx, "mdt_nope")).toThrow("MANDATE_NOT_FOUND");
  });
});

describe("lazy state", () => {
  it("ACTIVE past expiresAt reads EXPIRED, persists it, and is no longer active", () => {
    const fx = makeFx();
    const m = activeMandate(fx);
    expect(getMandate(fx.ctx, m.id)!.state).toBe("ACTIVE");
    fx.advance(31 * MIN);
    expect(getMandate(fx.ctx, m.id)!.state).toBe("EXPIRED");
    expect(fx.ctx.db.prepare("SELECT state FROM mandates WHERE id=?").get(m.id)).toEqual({ state: "EXPIRED" });
    expect(getActiveMandate(fx.ctx, USER)).toBeNull();
  });

  it("getActiveMandate also expires lazily", () => {
    const fx = makeFx();
    activeMandate(fx);
    fx.advance(31 * MIN);
    expect(getActiveMandate(fx.ctx, USER)).toBeNull();
    expect(fx.ctx.db.prepare("SELECT state FROM mandates").get()).toEqual({ state: "EXPIRED" });
  });

  it("becomes EXHAUSTED when available < min price, and ACTIVE again after a release", () => {
    const fx = makeFx();
    const { mandate, run } = setup(fx);
    const { purchase } = propose(fx, run.id, "195000"); // available would be 5000 < 10000
    step(fx, purchase.id, "RESERVED");
    expect(getMandate(fx.ctx, mandate.id)!.state).toBe("EXHAUSTED");
    expect(fx.ctx.db.prepare("SELECT state FROM mandates WHERE id=?").get(mandate.id)).toEqual({ state: "EXHAUSTED" });
    expect(getActiveMandate(fx.ctx, USER)).toBeNull();
    step(fx, purchase.id, "FAILED_FINAL");
    expect(budget(fx, mandate)).toEqual({ spent: "0", reserved: "0" });
    expect(getMandate(fx.ctx, mandate.id)!.state).toBe("ACTIVE");
    expect(getActiveMandate(fx.ctx, USER)?.id).toBe(mandate.id);
  });

  it("EXHAUSTED via direct UPDATE of reserved, and back", () => {
    const fx = makeFx();
    const m = activeMandate(fx);
    fx.ctx.db.prepare("UPDATE mandates SET reserved='190001' WHERE id=?").run(m.id);
    expect(getMandate(fx.ctx, m.id)!.state).toBe("EXHAUSTED");
    fx.ctx.db.prepare("UPDATE mandates SET reserved='190000' WHERE id=?").run(m.id);
    expect(getMandate(fx.ctx, m.id)!.state).toBe("ACTIVE"); // exactly min price is enough
  });
});

describe("preferences", () => {
  it("is null initially, then set/get/upserts", () => {
    const fx = makeFx();
    expect(getPreferences(fx.ctx, USER)).toBeNull();
    setPreferences(fx.ctx, USER, "prefer cheap");
    expect(getPreferences(fx.ctx, USER)).toEqual({ userId: USER, text: "prefer cheap", updatedAt: iso(fx.clock.t) });
    fx.advance(1000);
    setPreferences(fx.ctx, USER, "prefer fast");
    expect(getPreferences(fx.ctx, USER)).toEqual({ userId: USER, text: "prefer fast", updatedAt: iso(fx.clock.t) });
    expect(fx.ctx.db.prepare("SELECT COUNT(*) AS n FROM user_preferences").get()).toEqual({ n: 1 });
  });

  it("accepts 2000 chars and rejects 2001 with INVALID_PREFERENCES", () => {
    const fx = makeFx();
    setPreferences(fx.ctx, USER, "x".repeat(2000));
    expect(() => setPreferences(fx.ctx, USER, "x".repeat(2001))).toThrow("INVALID_PREFERENCES");
    expect(getPreferences(fx.ctx, USER)!.text).toHaveLength(2000);
  });
});
