import { afterEach, describe, expect, it } from "vitest";
import { verifyPermit, type AuthorizeResult, type SigningPermit, type Trust } from "@kakashi/contracts";
import { createTrust, verifyAuditChain, type PollResult, type WorldClient } from "../src";
import { USER, cleanup, decision, draft, inferenceInput, iso, makeFx, propose, quoteInput, setup, step, type Fx } from "./helpers";

// SPEC §7.6: every Trust method, called once or more through createTrust, in the order the app would call them.

const SECRET = "ab".repeat(32);
const ENV = { PERMIT_SECRET: SECRET, MERCHANT_QUICKCAST_PAYTO: "0.0.3001", MERCHANT_HOURLYPRO_PAYTO: "0.0.3002" };
const ISS = "https://auth.world.org";
const SUB = "sub_conformance_secret_person";
const QUESTION = "Will it rain on the conformance picnic tomorrow?";
const PREFS = "I prefer conformance-preference-text sources";
const TX_SMALL = "0.0.9185802@1700000000.000000001";
const TX_BIG = "0.0.9185802@1700000000.000000002";
const ZG = "0852f405-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

// Compile-time: METHODS lists exactly the keys of Trust (a missing or extra name fails the build).
const METHODS = [
  "createMandateDraft", "startAuth", "pollAuth", "revokeMandate", "getActiveMandate", "getPreferences", "setPreferences",
  "createRun", "updateRun", "recordQuote", "precheck", "proposePurchase", "authorize", "getPermitForPurchase",
  "transition", "setDelivery", "listUnresolved", "recordInference", "listPendingAudit", "markAnchored", "markAuditRetry",
  "getRunView", "getLedgerView",
] as const satisfies readonly (keyof Trust)[];
const allListed: [Exclude<Exclude<keyof Trust, "persistence">, (typeof METHODS)[number]>] extends [never] ? true : never = true;

afterEach(cleanup);

/** Scriptable World: every poll returns a token for the same human; every token validates. */
function fakeWorld(fx: Fx): WorldClient {
  return {
    async startDevice() {
      return { deviceCode: "DEV-CODE", userCode: "USER-CODE", verificationUri: "https://world.org/device", interval: 5, expiresIn: 600 };
    },
    async pollDevice(): Promise<PollResult> { return { status: "TOKEN", idToken: "fake.id.token" }; },
    async validateIdToken() { return { ok: true, claims: { iss: ISS, sub: SUB, authTime: Math.floor(fx.clock.t / 1000) } }; },
  };
}

/** Wraps trust so every method call is recorded by name. */
function recording(raw: Trust, called: Set<string>): Trust {
  return new Proxy(raw, {
    get(target, key, receiver) {
      const v: unknown = Reflect.get(target, key, receiver);
      if (typeof v !== "function" || typeof key !== "string") return v;
      return (...args: unknown[]) => { called.add(key); return (v as (...a: unknown[]) => unknown).apply(target, args); };
    },
  });
}

function permitOf(r: AuthorizeResult): SigningPermit {
  if (r.kind !== "PERMIT") throw new Error(`expected PERMIT, got ${r.kind}`);
  return r.permit;
}

describe("Trust conformance", () => {
  it("every interface method works through createTrust in a realistic order", async () => {
    expect(allListed).toBe(true);
    const fx = makeFx(ENV);
    const raw = createTrust(fx.ctx.env, { ctx: fx.ctx, world: fakeWorld(fx) });
    const called = new Set<string>();
    const t = recording(raw, called);

    // Mandate and preferences.
    const m = t.createMandateDraft(USER, draft(fx));
    expect(m).toMatchObject({ state: "DRAFT", version: 1, autoApproveCapAtomic: "20000" });
    expect(t.getActiveMandate(USER)).toBeNull();
    expect(t.getPreferences(USER)).toBeNull();
    t.setPreferences(USER, PREFS);
    expect(t.getPreferences(USER)).toMatchObject({ userId: USER, text: PREFS });

    // Activation with World ID.
    const act = await t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
    expect(act).toMatchObject({ purpose: "ACTIVATE_MANDATE", targetId: m.id, result: "PENDING", userCode: "USER-CODE" });
    fx.advance(5000);
    expect((await t.pollAuth(act.id)).result).toBe("VERIFIED");
    expect(t.getActiveMandate(USER)).toMatchObject({ id: m.id, state: "ACTIVE", mandateHash: m.mandateHash });

    // Run, quotes, precheck.
    const run = t.createRun(USER, QUESTION);
    expect(run).toMatchObject({ userId: USER, mandateId: m.id, mandateVersion: 1, state: "PLANNING" });
    const fresh = { receivedAt: iso(fx.clock.t), localExpiresAt: iso(fx.clock.t + 60_000) };
    const small = t.recordQuote(run.id, quoteInput({ ...fresh, requestHash: "rh_small" }));
    const big = t.recordQuote(run.id, quoteInput({
      ...fresh, merchantId: "hourlypro", path: "/m/hourlypro/treasury", amountAtomic: "50000", payTo: "0.0.3002", requestHash: "rh_big",
    }));
    expect(small).toMatchObject({ runId: run.id, amountAtomic: "10000" });
    expect(small.quoteHash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.precheck(small.id)).toEqual({ allowed: true, reasons: [], needsApproval: false });
    expect(t.precheck(big.id)).toEqual({ allowed: true, reasons: [], needsApproval: true });

    // Propose and authorize: the small one gets a permit, the big one needs a human.
    const pSmall = t.proposePurchase(small.id, decision({ needId: "n1" }));
    const pBig = t.proposePurchase(big.id, decision({ needId: "n2" }));
    expect(pSmall).toMatchObject({ state: "PROPOSED", quoteId: small.id, quoteHash: small.quoteHash });
    const smallPermit = permitOf(t.authorize(pSmall.id));
    expect(smallPermit).toMatchObject({ purchaseId: pSmall.id, amountAtomic: "10000", payTo: "0.0.3001", mandateVersion: 1 });
    expect(verifyPermit(smallPermit, SECRET, new Date(smallPermit.issuedAt))).toEqual({ ok: true });
    const needs = t.authorize(pBig.id);
    expect(needs.kind).toBe("NEEDS_APPROVAL");
    if (needs.kind === "NEEDS_APPROVAL") expect(needs.purchase.state).toBe("AWAITING_APPROVAL");

    // Step-up approval with World ID, then the permit exactly once.
    const apr = await t.startAuth(USER, "APPROVE_PURCHASE", pBig.id);
    expect(apr).toMatchObject({ purpose: "APPROVE_PURCHASE", targetId: pBig.id, result: "PENDING" });
    fx.advance(5000);
    expect((await t.pollAuth(apr.id)).result).toBe("VERIFIED");
    const bigPermit = t.getPermitForPurchase(pBig.id);
    expect(bigPermit).toMatchObject({ purchaseId: pBig.id, amountAtomic: "50000", payTo: "0.0.3002" });
    expect(verifyPermit(bigPermit!, SECRET, new Date(bigPermit!.issuedAt))).toEqual({ ok: true });
    expect(t.getPermitForPurchase(pBig.id)).toBeNull();

    // Execute both payments; the big one sits unresolved for a while.
    expect(t.transition(pSmall.id, "SIGNED", { hederaTxId: TX_SMALL })).toMatchObject({ state: "SIGNED", hederaTxId: TX_SMALL });
    expect(t.transition(pSmall.id, "SUBMITTED").state).toBe("SUBMITTED");
    expect(t.transition(pSmall.id, "CONFIRMED").state).toBe("CONFIRMED");
    t.transition(pBig.id, "SIGNED", { hederaTxId: TX_BIG });
    t.transition(pBig.id, "SUBMITTED");
    expect(t.listUnresolved().map((p) => [p.id, p.state])).toEqual([[pBig.id, "SUBMITTED"]]);
    t.transition(pBig.id, "CONFIRMED");
    expect(t.listUnresolved()).toEqual([]);
    t.setDelivery(pSmall.id, "RECEIVED_VALID");
    t.setDelivery(pBig.id, "RECEIVED_INVALID", ["missing hourly field"]);

    // 0G record and run completion.
    const inf = t.recordInference(inferenceInput(run.id, { zgRequestId: ZG, totalCost: "0.25" }));
    expect(inf).toMatchObject({ runId: run.id, zgRequestId: ZG });
    expect(inf.id).toMatch(/^inf_/);
    t.updateRun(run.id, { state: "DONE", finishedAt: iso(fx.clock.t) });

    // Read models.
    const rv = t.getRunView(run.id);
    expect(rv.run.state).toBe("DONE");
    expect(rv.quotes.map((q) => q.id).sort()).toEqual([small.id, big.id].sort());
    expect(rv.purchases.map((p) => [p.id, p.state, p.delivery]).sort()).toEqual([
      [pSmall.id, "CONFIRMED", "RECEIVED_VALID"], [pBig.id, "CONFIRMED", "RECEIVED_INVALID"],
    ].sort());
    expect(rv.inferenceCalls.map((c) => c.id)).toEqual([inf.id]);
    const ledger = t.getLedgerView(USER);
    expect(ledger).toMatchObject({
      limitAtomic: "200000", spentAtomic: "60000", reservedAtomic: "0", availableAtomic: "140000",
      dataSpendAtomic: "60000", inferenceSpend: "0.25",
    });
    expect(ledger.receipts.map((r) => r.hederaTxId).sort()).toEqual([TX_SMALL, TX_BIG]);

    // Audit outbox worker: anchor one, fail one, the failed one comes back after its 1 s backoff.
    const pending = t.listPendingAudit(100);
    const total = (fx.ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number }).n;
    expect(pending).toHaveLength(total);
    expect(pending.every((e) => e.state === "PENDING")).toBe(true);
    const [first, second] = pending;
    t.markAnchored(first!.id, { topicId: "0.0.5005", sequenceNumber: 1, consensusTimestamp: "1700000000.000000001" });
    t.markAuditRetry(second!.id);
    expect(t.listPendingAudit(100).map((e) => e.id)).not.toContain(second!.id);
    expect(t.listPendingAudit(100).map((e) => e.id)).not.toContain(first!.id);
    fx.advance(1000);
    expect(t.listPendingAudit(100)[0]).toMatchObject({ id: second!.id, state: "RETRYING", attempts: 1 });

    // Revocation.
    expect(t.revokeMandate(m.id)).toMatchObject({ id: m.id, state: "REVOKED" });
    expect(t.getActiveMandate(USER)).toBeNull();

    // Completeness: every method of the returned object was called, and that object is exactly the Trust interface.
    const keys = Object.keys(raw).filter(k => typeof (raw as unknown as Record<string,unknown>)[k] === "function").sort();
    expect(keys).toEqual([...METHODS].sort());
    expect(keys).toHaveLength(23);
    expect([...called].sort()).toEqual(keys);

    // Audit chain and content.
    const chain = verifyAuditChain(fx.ctx);
    expect(chain.ok).toBe(true);
    const rows = fx.ctx.db.prepare("SELECT type, payload FROM audit_events ORDER BY seq").all() as { type: string; payload: string }[];
    if (chain.ok) expect(chain.count).toBe(rows.length);
    const types = new Set(rows.map((r) => r.type));
    for (const ty of ["MANDATE_ACTIVATED", "PURCHASE_DECIDED", "APPROVAL_GRANTED", "PURCHASE_CONFIRMED", "DELIVERY_RESULT", "RUN_COMPLETED", "MANDATE_REVOKED"]) {
      expect(types, ty).toContain(ty);
    }
    for (const r of rows) {
      expect(r.payload).not.toContain(QUESTION);
      expect(r.payload).not.toContain(PREFS);
      expect(r.payload).not.toContain(SUB);
    }
  });

  it("transition with a malformed hederaTxId throws INVALID_TX_ID and changes nothing", () => {
    const fx = makeFx(ENV);
    const t = createTrust(fx.ctx.env, { ctx: fx.ctx, world: fakeWorld(fx) });
    const { run } = setup(fx);
    const { purchase } = propose(fx, run.id);
    step(fx, purchase.id, "RESERVED");
    const snapshot = () => {
      const tables = fx.ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
      return JSON.stringify(tables.map((x) => [x.name, fx.ctx.db.prepare(`SELECT * FROM "${x.name}" ORDER BY rowid`).all()]));
    };
    const before = snapshot();
    expect(() => t.transition(purchase.id, "SIGNED", { hederaTxId: "0.0.9185802-1700000000-000000001" })).toThrow("INVALID_TX_ID");
    expect(snapshot()).toBe(before);
  });

  it("recordInference with a zgRequestId containing a space throws INVALID_ZG_REQUEST_ID", () => {
    const fx = makeFx(ENV);
    const t = createTrust(fx.ctx.env, { ctx: fx.ctx, world: fakeWorld(fx) });
    const { run } = setup(fx);
    expect(() => t.recordInference(inferenceInput(run.id, { zgRequestId: "zg 1" }))).toThrow("INVALID_ZG_REQUEST_ID");
    expect(t.getRunView(run.id).inferenceCalls).toEqual([]);
  });
});
