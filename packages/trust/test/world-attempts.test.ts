import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK, type JWTVerifyGetKey } from "jose";
import type { AuthAttemptPublic, AuthAttemptResult, Purchase } from "@kakashi/contracts";
import { createTrust, issuePermitAfterApproval, type PollResult, type ValidateResult, type WorldClient } from "../src";
import { createMandateVersion, getMandate, revokeMandate } from "../src/mandates";
import { getPurchase, getQuote, proposePurchase, recordQuote } from "../src/purchases";
import { validateIdToken } from "../src/world/validate";
import { START, USER, MIN, activeMandate, budget, cleanup, decision, draft, makeFx, propose, quoteInput, setup, type Fx } from "./helpers";

// SPEC §2.2, §8.2, §8.4 step 3, §13 T1-T3: the World ID attempt flow driven through createTrust with a fake WorldClient.

const SECRET = "ab".repeat(32);
const ENV = { PERMIT_SECRET: SECRET, MERCHANT_QUICKCAST_PAYTO: "0.0.3001" };
const ISS = "https://auth.world.org";
const OTHER_ISS = "https://other-issuer.example";
const CID = "app_client_123";
const DEVICE_CODE = "DEV-SECRET-CODE";
const USER_CODE = "USER-CODE";
const ID_TOKEN = "fake.id.token";
const SUB_A = "sub_user_a";
const USER_B = "usr_b";
const INTERVAL_MS = 5000;
const TOKEN: PollResult = { status: "TOKEN", idToken: ID_TOKEN };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Validate = (idToken: string, startedAtMs: number) => Promise<ValidateResult>;
type FakeWorld = WorldClient & {
  polls: PollResult[]; checks: ValidateResult[]; validate?: Validate; failStart?: Error;
  calls: { start: number; poll: number; validate: number };
};

/** Scriptable World: fixed device codes, queued poll and validation results. An unexpected call throws. */
function fakeWorld(): FakeWorld {
  const w: FakeWorld = {
    polls: [], checks: [], calls: { start: 0, poll: 0, validate: 0 },
    async startDevice() {
      w.calls.start++;
      if (w.failStart) throw w.failStart;
      return { deviceCode: DEVICE_CODE, userCode: USER_CODE, verificationUri: "https://world.org/device", interval: 5, expiresIn: 600 };
    },
    async pollDevice(code) {
      w.calls.poll++;
      if (code !== DEVICE_CODE) throw new Error(`wrong device code ${code}`);
      const p = w.polls.shift();
      if (!p) throw new Error("unexpected pollDevice");
      return p;
    },
    async validateIdToken(idToken, startedAtMs) {
      w.calls.validate++;
      if (w.validate) return w.validate(idToken, startedAtMs);
      const c = w.checks.shift();
      if (!c) throw new Error("unexpected validateIdToken");
      return c;
    },
  };
  return w;
}

type H = { fx: Fx; w: FakeWorld; t: ReturnType<typeof createTrust>; logs: [string, Record<string, unknown>][] };
function harness(): H {
  const fx = makeFx(ENV);
  const w = fakeWorld();
  const logs: H["logs"] = [];
  const t = createTrust(fx.ctx.env, { ctx: fx.ctx, world: w, logger: (e, d) => { logs.push([e, d]); } });
  return { fx, w, t, logs };
}

const ok = (h: H, sub = SUB_A, iss = ISS): ValidateResult => ({ ok: true, claims: { iss, sub, authTime: Math.floor(h.fx.clock.t / 1000) } });

/** Queue one World answer, step past next_poll_at, poll. */
async function pollWith(h: H, id: string, r: PollResult, v?: ValidateResult): Promise<AuthAttemptPublic> {
  h.w.polls.push(r);
  if (v) h.w.checks.push(v);
  h.fx.advance(INTERVAL_MS);
  return h.t.pollAuth(id);
}

type Row = Record<string, any>;
const approvalsFor = (h: H, attemptId: string) => h.fx.ctx.db.prepare("SELECT * FROM approvals WHERE attempt_id = ?").all(attemptId) as Row[];
const attemptRow = (h: H, id: string) => h.fx.ctx.db.prepare("SELECT * FROM auth_attempts WHERE id = ?").get(id) as Row;
const auditTypes = (h: H) => (h.fx.ctx.db.prepare("SELECT type FROM audit_events ORDER BY seq").all() as { type: string }[]).map((r) => r.type);
const count = (h: H, table: string) => (h.fx.ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const stateOf = (h: H, id: string): Purchase["state"] => getPurchase(h.fx.ctx, id)!.state;
const changes = (h: H) => (h.fx.ctx.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
function snapshot(h: H): string {
  const tables = h.fx.ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  return JSON.stringify(tables.map((t) => [t.name, h.fx.ctx.db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()]));
}
const link = (h: H, userId: string, sub: string, iss = ISS) =>
  h.fx.ctx.db.prepare("INSERT INTO world_identities (user_id, iss, sub, linked_at) VALUES (?, ?, ?, ?)").run(userId, iss, sub, new Date(START).toISOString());

/** Active (directly) mandate, a run, and a 25000 purchase above autoApproveCap (20000) -> AWAITING_APPROVAL. */
function awaiting(h: H, requestHash = "rh_1") {
  const { mandate, run } = setup(h.fx);
  return { mandate, run, ...awaitingIn(h, run.id, requestHash) };
}
function awaitingIn(h: H, runId: string, requestHash: string) {
  const { purchase, quote } = proposeAt(h.fx, runId, "25000", requestHash);
  expect(h.t.authorize(purchase.id).kind).toBe("NEEDS_APPROVAL");
  return { purchase, quote };
}

function proposeAt(fx: Fx, runId: string, amountAtomic: string, requestHash: string) {
  const quote = recordQuote(fx.ctx, runId, quoteInput({ amountAtomic, requestHash }));
  return { quote, purchase: proposePurchase(fx.ctx, quote.id, decision()) };
}

type Fail = { name: string; result: AuthAttemptResult; prep?: (h: H) => void; act: (h: H, id: string) => Promise<AuthAttemptPublic> };
const FAILS: Fail[] = [
  { name: "World access_denied", result: "DENIED", act: (h, id) => pollWith(h, id, { status: "DENIED" }) },
  { name: "World cancel", result: "CANCELLED", act: (h, id) => pollWith(h, id, { status: "CANCELLED" }) },
  { name: "World expired_token", result: "EXPIRED", act: (h, id) => pollWith(h, id, { status: "EXPIRED" }) },
  {
    name: "local expiry", result: "EXPIRED",
    act: async (h, id) => {
      h.fx.advance(10 * MIN); // past both the 600 s device expiry and the 5 min purchase cap
      const r = await h.t.pollAuth(id);
      expect(h.w.calls.poll).toBe(0);
      return r;
    },
  },
  { name: "World error", result: "ERROR", act: (h, id) => pollWith(h, id, { status: "ERROR", code: "invalid_grant" }) },
  { name: "failed token validation", result: "ERROR", act: (h, id) => pollWith(h, id, TOKEN, { ok: false, reason: "BAD_SIGNATURE" }) },
  {
    name: "identity mismatch", result: "IDENTITY_MISMATCH",
    prep: (h) => { link(h, USER, "sub_original"); },
    act: (h, id) => pollWith(h, id, TOKEN, ok(h, SUB_A)),
  },
];

describe("T1: mandate activation", () => {
  for (const f of FAILS) {
    it(`${f.name} -> ${f.result}: mandate not active, no approval, no run`, async () => {
      const h = harness();
      const m = h.t.createMandateDraft(USER, draft(h.fx));
      f.prep?.(h);
      const a = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
      expect(a.result).toBe("PENDING");
      expect(getMandate(h.fx.ctx, m.id)!.state).toBe("PENDING_APPROVAL");

      const r = await f.act(h, a.id);
      expect(r.result).toBe(f.result);
      expect(attemptRow(h, a.id).result).toBe(f.result);
      expect(h.t.getActiveMandate(USER)).toBeNull();
      expect(getMandate(h.fx.ctx, m.id)!.state).toBe("DRAFT");
      expect(approvalsFor(h, a.id)).toEqual([]);
      expect(count(h, "approvals")).toBe(0);
      expect(auditTypes(h)).not.toContain("MANDATE_ACTIVATED");
      expect(() => h.t.createRun(USER, "weather?")).toThrow("MANDATE_INACTIVE");
      expect(count(h, "runs")).toBe(0); // no run means nothing to propose or authorize

      // Terminal: polling again returns the same result without calling World.
      const polls = h.w.calls.poll;
      h.fx.advance(INTERVAL_MS);
      expect((await h.t.pollAuth(a.id)).result).toBe(f.result);
      expect(h.w.calls.poll).toBe(polls);
    });
  }

  it("VERIFIED -> ACTIVE, consumed APPROVED approval over mandateHash, MANDATE_ACTIVATED audit, run allowed", async () => {
    const h = harness();
    const m = h.t.createMandateDraft(USER, draft(h.fx));
    const a = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
    const r = await pollWith(h, a.id, TOKEN, ok(h));
    expect(r.result).toBe("VERIFIED");
    expect(h.w.calls).toEqual({ start: 1, poll: 1, validate: 1 });

    const active = h.t.getActiveMandate(USER)!;
    expect(active).toMatchObject({ id: m.id, version: 1, state: "ACTIVE", mandateHash: m.mandateHash });
    const apv = approvalsFor(h, a.id);
    expect(apv).toHaveLength(1);
    expect(apv[0]).toMatchObject({ decision: "APPROVED", purpose: "ACTIVATE_MANDATE", target_hash: m.mandateHash });
    expect(apv[0]!.consumed_at).not.toBeNull();
    expect(active.activationApprovalId).toBe(apv[0]!.id);
    const audit = h.fx.ctx.db.prepare("SELECT payload FROM audit_events WHERE type = 'MANDATE_ACTIVATED'").all() as { payload: string }[];
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.payload).mandateHash).toBe(m.mandateHash);
    expect(h.fx.ctx.db.prepare("SELECT user_id, iss, sub FROM world_identities").all()).toEqual([{ user_id: USER, iss: ISS, sub: SUB_A }]);
    expect(h.t.createRun(USER, "weather?").mandateVersion).toBe(1);
  });

  it("a failed attempt can be retried and then verify", async () => {
    const h = harness();
    const m = h.t.createMandateDraft(USER, draft(h.fx));
    const a1 = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
    expect((await pollWith(h, a1.id, { status: "DENIED" })).result).toBe("DENIED");
    const a2 = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
    expect((await pollWith(h, a2.id, TOKEN, ok(h))).result).toBe("VERIFIED");
    expect(h.t.getActiveMandate(USER)?.id).toBe(m.id);
  });
});

describe("T1: purchase approval", () => {
  for (const f of FAILS) {
    it(`${f.name} -> ${f.result}: DENIED approval, APPROVAL_DENIED, reservation released, no permit`, async () => {
      const h = harness();
      const { mandate, purchase } = awaiting(h);
      expect(budget(h.fx, mandate).reserved).toBe("25000");
      f.prep?.(h);
      const a = await h.t.startAuth(USER, "APPROVE_PURCHASE", purchase.id);

      const r = await f.act(h, a.id);
      expect(r.result).toBe(f.result);
      const apv = approvalsFor(h, a.id);
      expect(apv).toHaveLength(1);
      expect(apv[0]).toMatchObject({ decision: "DENIED", target_hash: purchase.purchaseHash, consumed_at: null });
      expect(stateOf(h, purchase.id)).toBe("APPROVAL_DENIED");
      expect(getPurchase(h.fx.ctx, purchase.id)!.permitId).toBeUndefined();
      expect(budget(h.fx, mandate)).toEqual({ spent: "0", reserved: "0" });
      expect(h.t.getPermitForPurchase(purchase.id)).toBeNull();
      expect(auditTypes(h)).toContain("APPROVAL_DENIED");
      expect(auditTypes(h)).not.toContain("APPROVAL_GRANTED");
    });
  }

  it("VERIFIED -> RESERVED, reservation not doubled, permit matches the quote and is handed out once", async () => {
    const h = harness();
    const { mandate, purchase } = awaiting(h);
    const a = await h.t.startAuth(USER, "APPROVE_PURCHASE", purchase.id);
    expect(Date.parse(a.expiresAt) - Date.parse(a.startedAt)).toBe(5 * MIN); // purchase approvals capped at 5 min
    expect((await pollWith(h, a.id, TOKEN, ok(h))).result).toBe("VERIFIED");

    const p = getPurchase(h.fx.ctx, purchase.id)!;
    expect(p.state).toBe("RESERVED");
    expect(budget(h.fx, mandate)).toEqual({ spent: "0", reserved: "25000" });
    const apv = approvalsFor(h, a.id);
    expect(apv).toHaveLength(1);
    expect(apv[0]).toMatchObject({ decision: "APPROVED", target_hash: purchase.purchaseHash });
    expect(apv[0]!.consumed_at).not.toBeNull();
    expect(p.approvalId).toBe(apv[0]!.id);

    const permit = h.t.getPermitForPurchase(purchase.id);
    const q = getQuote(h.fx.ctx, p.quoteId)!;
    expect(permit).toMatchObject({
      network: q.network, assetId: q.assetId, amountAtomic: q.amountAtomic, payTo: q.payTo, feePayer: q.feePayer,
      quoteHash: p.quoteHash, purchaseId: p.id, permitId: p.permitId,
    });
    expect(q.amountAtomic).toBe("25000");
    expect(h.t.getPermitForPurchase(purchase.id)).toBeNull();
  });
});

describe("T2: identity binding", () => {
  it("only user A's first (iss, sub) ever verifies; nothing else is approved", async () => {
    const h = harness();
    const m = h.t.createMandateDraft(USER, draft(h.fx));
    const first = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
    expect((await pollWith(h, first.id, TOKEN, ok(h, SUB_A))).result).toBe("VERIFIED");

    // A, new mandate version, presenting a different sub, then a different iss.
    createMandateVersion(h.fx.ctx, m.id, { totalBudgetAtomic: "300000" });
    for (const v of [ok(h, "sub_someone_else"), ok(h, SUB_A, OTHER_ISS)]) {
      const a = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
      expect((await pollWith(h, a.id, TOKEN, v)).result).toBe("IDENTITY_MISMATCH");
      expect(approvalsFor(h, a.id)).toEqual([]);
      expect(getMandate(h.fx.ctx, m.id, 2)!.state).toBe("DRAFT");
      expect(h.t.getActiveMandate(USER)).toMatchObject({ id: m.id, version: 1 });
    }

    // A, purchase step-up presenting a different sub: denied.
    const run = h.t.createRun(USER, "weather?");
    const { purchase } = awaitingIn(h, run.id, "rh_t2");
    const pa = await h.t.startAuth(USER, "APPROVE_PURCHASE", purchase.id);
    expect((await pollWith(h, pa.id, TOKEN, ok(h, "sub_someone_else"))).result).toBe("IDENTITY_MISMATCH");
    expect(approvalsFor(h, pa.id).map((r) => r.decision)).toEqual(["DENIED"]);
    expect(stateOf(h, purchase.id)).toBe("APPROVAL_DENIED");
    expect(h.t.getPermitForPurchase(purchase.id)).toBeNull();

    // B presents A's (iss, sub).
    const mb = h.t.createMandateDraft(USER_B, draft(h.fx));
    const b = await h.t.startAuth(USER_B, "ACTIVATE_MANDATE", mb.id);
    expect((await pollWith(h, b.id, TOKEN, ok(h, SUB_A))).result).toBe("IDENTITY_MISMATCH");
    expect(approvalsFor(h, b.id)).toEqual([]);
    expect(getMandate(h.fx.ctx, mb.id)!.state).toBe("DRAFT");
    expect(h.t.getActiveMandate(USER_B)).toBeNull();
    expect(() => h.t.createRun(USER_B, "weather?")).toThrow("MANDATE_INACTIVE");

    expect(h.fx.ctx.db.prepare("SELECT user_id, iss, sub FROM world_identities").all()).toEqual([{ user_id: USER, iss: ISS, sub: SUB_A }]);
    expect((h.fx.ctx.db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE decision = 'APPROVED'").get() as { n: number }).n).toBe(1);
  });
});

describe("T3: approval reuse", () => {
  it("a consumed purchase approval is rejected elsewhere, and re-polling issues nothing new", async () => {
    const h = harness();
    const { mandate, run, purchase } = awaiting(h);
    const a = await h.t.startAuth(USER, "APPROVE_PURCHASE", purchase.id);
    expect((await pollWith(h, a.id, TOKEN, ok(h))).result).toBe("VERIFIED");
    expect(h.t.getPermitForPurchase(purchase.id)).not.toBeNull();
    const apv = approvalsFor(h, a.id)[0]!;
    const permitId = getPurchase(h.fx.ctx, purchase.id)!.permitId;

    const { purchase: other } = awaitingIn(h, run.id, "rh_2");
    expect(budget(h.fx, mandate).reserved).toBe("50000");
    const out = issuePermitAfterApproval(h.fx.ctx, other.id, apv.id);
    expect(out.kind).toBe("DENIED");
    expect(["APPROVAL_CONSUMED", "TARGET_MISMATCH"]).toContain(out.kind === "DENIED" ? out.reason : "");
    expect(stateOf(h, other.id)).toBe("APPROVAL_DENIED");
    expect(budget(h.fx, mandate).reserved).toBe("25000");
    expect(h.t.getPermitForPurchase(other.id)).toBeNull();

    const calls = { ...h.w.calls };
    h.fx.advance(INTERVAL_MS);
    expect((await h.t.pollAuth(a.id)).result).toBe("VERIFIED");
    expect(h.w.calls).toEqual(calls);
    expect(h.t.getPermitForPurchase(purchase.id)).toBeNull();
    expect(getPurchase(h.fx.ctx, purchase.id)!.permitId).toBe(permitId);
    expect(approvalsFor(h, a.id)).toHaveLength(1);
  });
});

describe("stale auth_time (real validateIdToken, local JWKS)", () => {
  let priv: CryptoKey, keys: JWTVerifyGetKey;
  beforeAll(async () => {
    const kp = await generateKeyPair("RS256", { extractable: true });
    priv = kp.privateKey;
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" }] });
  });

  const cases: [string, number, AuthAttemptResult][] = [
    ["older than startedAt - 5 s", -6, "ERROR"],
    ["exactly startedAt - 5 s", -5, "VERIFIED"],
  ];
  for (const [name, offsetS, result] of cases) {
    it(`auth_time ${name} -> ${result}`, async () => {
      const h = harness();
      h.w.validate = (tok, startedAtMs) => validateIdToken(tok, keys, { issuer: ISS, clientId: CID }, startedAtMs, new Date(h.fx.clock.t));
      const m = h.t.createMandateDraft(USER, draft(h.fx));
      const a = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
      expect(Date.parse(a.startedAt)).toBe(START);
      const nowS = Math.floor(START / 1000) + 5;
      const idToken = await new SignJWT({ sub: SUB_A, auth_time: START / 1000 + offsetS })
        .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISS).setAudience(CID)
        .setIssuedAt(nowS).setExpirationTime(nowS + 300).sign(priv);
      h.w.polls.push({ status: "TOKEN", idToken });
      h.fx.advance(INTERVAL_MS);
      expect((await h.t.pollAuth(a.id)).result).toBe(result);
      if (result === "ERROR") {
        expect(h.logs).toContainEqual(["world.attempt.finished", expect.objectContaining({ result: "ERROR", reason: "STALE_AUTH_TIME" })]);
        expect(getMandate(h.fx.ctx, m.id)!.state).toBe("DRAFT");
        expect(h.t.getActiveMandate(USER)).toBeNull();
        expect(approvalsFor(h, a.id)).toEqual([]);
      } else {
        expect(h.t.getActiveMandate(USER)?.id).toBe(m.id);
      }
    });
  }
});

describe("superseding", () => {
  it("mandate: a second start supersedes the first, which never calls World or touches the mandate", async () => {
    const h = harness();
    const m = h.t.createMandateDraft(USER, draft(h.fx));
    const a1 = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
    const a2 = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
    expect(attemptRow(h, a1.id).result).toBe("SUPERSEDED");
    h.fx.advance(INTERVAL_MS);
    expect((await h.t.pollAuth(a1.id)).result).toBe("SUPERSEDED");
    expect(h.w.calls.poll).toBe(0);
    expect(getMandate(h.fx.ctx, m.id)!.state).toBe("PENDING_APPROVAL");
    expect(approvalsFor(h, a1.id)).toEqual([]);
    expect((await pollWith(h, a2.id, TOKEN, ok(h))).result).toBe("VERIFIED");
    expect(h.t.getActiveMandate(USER)?.id).toBe(m.id);
    expect(attemptRow(h, a1.id).result).toBe("SUPERSEDED");
  });

  it("purchase: the superseded attempt does not deny the purchase; the newer one approves it", async () => {
    const h = harness();
    const { mandate, purchase } = awaiting(h);
    const a1 = await h.t.startAuth(USER, "APPROVE_PURCHASE", purchase.id);
    const a2 = await h.t.startAuth(USER, "APPROVE_PURCHASE", purchase.id);
    h.fx.advance(INTERVAL_MS);
    expect((await h.t.pollAuth(a1.id)).result).toBe("SUPERSEDED");
    expect(h.w.calls.poll).toBe(0);
    expect(stateOf(h, purchase.id)).toBe("AWAITING_APPROVAL");
    expect(budget(h.fx, mandate).reserved).toBe("25000");
    expect(approvalsFor(h, a1.id)).toEqual([]);
    expect((await pollWith(h, a2.id, TOKEN, ok(h))).result).toBe("VERIFIED");
    expect(stateOf(h, purchase.id)).toBe("RESERVED");
    expect(h.t.getPermitForPurchase(purchase.id)).not.toBeNull();
  });
});

describe("rate limiting", () => {
  it("does not call World before next_poll_at; slow_down adds 5 s to the interval", async () => {
    const h = harness();
    const m = h.t.createMandateDraft(USER, draft(h.fx));
    const a = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
    expect((await h.t.pollAuth(a.id)).result).toBe("PENDING"); // immediately after start
    expect(h.w.calls.poll).toBe(0);

    expect((await pollWith(h, a.id, { status: "PENDING", slowDown: true })).result).toBe("PENDING");
    expect(h.w.calls.poll).toBe(1);
    expect(attemptRow(h, a.id).interval_seconds).toBe(10);
    await h.t.pollAuth(a.id); // immediate second poll
    h.fx.advance(INTERVAL_MS); // 5 s is no longer enough
    await h.t.pollAuth(a.id);
    expect(h.w.calls.poll).toBe(1);

    h.w.polls.push({ status: "PENDING", slowDown: false });
    h.fx.advance(INTERVAL_MS); // now 10 s since the slow_down
    expect((await h.t.pollAuth(a.id)).result).toBe("PENDING");
    expect(h.w.calls.poll).toBe(2);
    expect(attemptRow(h, a.id).interval_seconds).toBe(10);
    expect(getMandate(h.fx.ctx, m.id)!.state).toBe("PENDING_APPROVAL");
  });
});

describe("no secrets in logs or public attempts", () => {
  it("real createWorldClient with mocked fetch: activation + purchase approval + denial", async () => {
    const CLIENT_SECRET = "SUPER-SECRET-VALUE";
    const ACCESS = "ACCESS-TOKEN-VALUE";
    const REFRESH = "REFRESH-TOKEN-VALUE";
    const kp = await generateKeyPair("RS256", { extractable: true });
    const jwk: JWK = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    const DISC = {
      issuer: ISS, token_endpoint: `${ISS}/api/v1/token`, device_authorization_endpoint: `${ISS}/api/v1/device_authorization`,
      jwks_uri: `${ISS}/.well-known/jwks.json`,
    };
    const env = { ...ENV, WORLD_CLIENT_ID: CID, WORLD_CLIENT_SECRET: CLIENT_SECRET, WORLD_ISSUER: ISS };
    const fx = makeFx(env);
    const issued: string[] = [];
    const sign = async () => {
      const nowS = Math.floor(Date.now() / 1000); // the real client validates exp against real time
      const t = await new SignJWT({ sub: SUB_A, auth_time: Math.floor(fx.clock.t / 1000) })
        .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISS).setAudience(CID)
        .setIssuedAt(nowS).setExpirationTime(nowS + 300).sign(kp.privateKey);
      issued.push(t);
      return t;
    };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const tokenReplies: (() => Promise<Response>)[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${ISS}/.well-known/openid-configuration`) return json(200, DISC);
      if (url === DISC.jwks_uri) return json(200, { keys: [jwk] });
      if (url === DISC.device_authorization_endpoint) {
        return json(200, { device_code: DEVICE_CODE, user_code: USER_CODE, verification_uri: "https://world.org/device", expires_in: 600, interval: 5 });
      }
      if (url === DISC.token_endpoint) {
        const next = tokenReplies.shift();
        if (!next) throw new Error("unexpected token poll");
        return next();
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const tokenOk = async () => json(200, { id_token: await sign(), access_token: ACCESS, refresh_token: REFRESH, token_type: "Bearer" });
    const tokenErr = (error: string) => async () => json(400, { error });

    const captured: unknown[] = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { captured.push(args); });
    }
    const t = createTrust(env, { ctx: fx.ctx, logger: (e, d) => { captured.push([e, d]); } });
    const pub: AuthAttemptPublic[] = [];
    const step = async (id: string, reply: () => Promise<Response>) => {
      tokenReplies.push(reply);
      fx.advance(10_000); // covers the slow_down interval; quotes from quoteInput expire at START + 60 s
      const r = await t.pollAuth(id);
      pub.push(r);
      return r;
    };

    const m = t.createMandateDraft(USER, draft(fx));
    const act = await t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
    pub.push(act);
    expect(act.userCode).toBe(USER_CODE);
    expect((await step(act.id, tokenErr("authorization_pending"))).result).toBe("PENDING");
    expect((await step(act.id, tokenErr("slow_down"))).result).toBe("PENDING");
    expect((await step(act.id, tokenOk)).result).toBe("VERIFIED");
    expect(t.getActiveMandate(USER)?.id).toBe(m.id);

    const run = t.createRun(USER, "weather?");
    const { purchase } = propose(fx, run.id, "25000");
    expect(t.authorize(purchase.id).kind).toBe("NEEDS_APPROVAL");
    const pa = await t.startAuth(USER, "APPROVE_PURCHASE", purchase.id);
    pub.push(pa);
    expect((await step(pa.id, tokenOk)).result).toBe("VERIFIED");
    expect(t.getPermitForPurchase(purchase.id)).not.toBeNull();

    const { purchase: p2 } = proposeAt(fx, run.id, "25000", "rh_2");
    expect(t.authorize(p2.id).kind).toBe("NEEDS_APPROVAL");
    const pd = await t.startAuth(USER, "APPROVE_PURCHASE", p2.id);
    pub.push(pd);
    expect((await step(pd.id, tokenErr("access_denied"))).result).toBe("DENIED");
    expect(stateOf({ fx } as H, p2.id)).toBe("APPROVAL_DENIED");

    expect(issued).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([u]) => String(u) === DISC.jwks_uri)).toBe(true);
    const out = JSON.stringify(captured);
    expect(out).toContain("world.attempt.finished"); // the capture really saw the logs
    expect(out).toContain("device_start");
    for (const s of [CLIENT_SECRET, DEVICE_CODE, USER_CODE, ACCESS, REFRESH, SUB_A, ...issued]) expect(out).not.toContain(s);

    for (const p of pub) {
      const s = JSON.stringify(p);
      expect(Object.keys(p).sort()).toEqual(["expiresAt", "id", "purpose", "result", "startedAt", "targetId", "userCode", "verificationUri"]);
      for (const bad of ["deviceCodeRef", "device_code", DEVICE_CODE, '"iss"', '"sub"', SUB_A, ...issued]) expect(s).not.toContain(bad);
    }
  });
});

describe("startAuth guards", () => {
  it("rejects a mandate that is ACTIVE, REVOKED or another user's, without calling World", async () => {
    const h = harness();
    const active = activeMandate(h.fx);
    await expect(h.t.startAuth(USER, "ACTIVATE_MANDATE", active.id)).rejects.toThrow(/AUTH_TARGET_INVALID/);

    const h2 = harness();
    const revoked = h2.t.createMandateDraft(USER, draft(h2.fx));
    revokeMandate(h2.fx.ctx, revoked.id);
    await expect(h2.t.startAuth(USER, "ACTIVATE_MANDATE", revoked.id)).rejects.toThrow(/AUTH_TARGET_INVALID/);

    const theirs = h2.t.createMandateDraft(USER_B, draft(h2.fx));
    await expect(h2.t.startAuth(USER, "ACTIVATE_MANDATE", theirs.id)).rejects.toThrow(/AUTH_TARGET_INVALID/);
    expect(getMandate(h2.fx.ctx, theirs.id)!.state).toBe("DRAFT");
    await expect(h2.t.startAuth(USER, "ACTIVATE_MANDATE", "mdt_missing")).rejects.toThrow(/AUTH_TARGET_INVALID/);

    expect(h.w.calls.start + h2.w.calls.start).toBe(0);
    expect(count(h, "auth_attempts") + count(h2, "auth_attempts")).toBe(0);
  });

  it("rejects a purchase that is not AWAITING_APPROVAL (PROPOSED, RESERVED) or another user's", async () => {
    const h = harness();
    const { run } = setup(h.fx);
    const { purchase: proposed } = propose(h.fx, run.id, "25000");
    await expect(h.t.startAuth(USER, "APPROVE_PURCHASE", proposed.id)).rejects.toThrow(/AUTH_TARGET_INVALID/);
    const { purchase: small } = proposeAt(h.fx, run.id, "10000", "rh_small");
    expect(h.t.authorize(small.id).kind).toBe("PERMIT");
    await expect(h.t.startAuth(USER, "APPROVE_PURCHASE", small.id)).rejects.toThrow(/AUTH_TARGET_INVALID/);
    const { purchase: waiting } = awaitingIn(h, run.id, "rh_w");
    await expect(h.t.startAuth(USER_B, "APPROVE_PURCHASE", waiting.id)).rejects.toThrow(/AUTH_TARGET_INVALID/);
    expect(h.w.calls.start).toBe(0);
    expect(count(h, "auth_attempts")).toBe(0);
  });

  it("a World startDevice failure leaves the DB unchanged (no supersede, no state change)", async () => {
    const h = harness();
    const m = h.t.createMandateDraft(USER, draft(h.fx));
    const a1 = await h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id);
    h.w.failStart = new Error("WORLD_DEVICE_START_FAILED: 503 unknown");
    const before = snapshot(h);
    const n = changes(h);
    await expect(h.t.startAuth(USER, "ACTIVATE_MANDATE", m.id)).rejects.toThrow("WORLD_DEVICE_START_FAILED");
    expect(changes(h)).toBe(n);
    expect(snapshot(h)).toBe(before);
    expect(attemptRow(h, a1.id).result).toBe("PENDING");

    const h2 = harness();
    const m2 = h2.t.createMandateDraft(USER, draft(h2.fx));
    h2.w.failStart = new Error("WORLD_DEVICE_START_FAILED: 503 unknown");
    const before2 = snapshot(h2);
    await expect(h2.t.startAuth(USER, "ACTIVATE_MANDATE", m2.id)).rejects.toThrow("WORLD_DEVICE_START_FAILED");
    expect(snapshot(h2)).toBe(before2);
    expect(getMandate(h2.fx.ctx, m2.id)!.state).toBe("DRAFT");
  });
});
