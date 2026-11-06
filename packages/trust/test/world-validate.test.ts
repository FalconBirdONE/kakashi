import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { createWorldClient } from "../src/world/client";
import { validateIdToken, type ValidateConfig } from "../src/world/validate";

const ISS = "https://auth.world.org";
const CID = "app_client_123";
const NOW = new Date("2030-01-01T00:10:00.000Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const STARTED = NOW.getTime() - 60_000; // attempt started a minute ago
const cfg: ValidateConfig = { issuer: ISS, clientId: CID };

let priv: CryptoKey, otherPriv: CryptoKey, keys: JWTVerifyGetKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256", { extractable: true });
  priv = kp.privateKey;
  otherPriv = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

type Opts = { claims?: JWTPayload; omit?: string[]; key?: CryptoKey; iss?: string; aud?: string; exp?: number };
async function token(o: Opts = {}): Promise<string> {
  const payload: JWTPayload = { sub: "sub_abc", auth_time: Math.floor(STARTED / 1000) + 10, ...o.claims };
  for (const k of o.omit ?? []) delete payload[k];
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(o.iss ?? ISS).setAudience(o.aud ?? CID)
    .setIssuedAt(NOW_S - 30).setExpirationTime(o.exp ?? NOW_S + 300)
    .sign(o.key ?? priv);
}
const check = async (t: string, c: Partial<ValidateConfig> = {}) => validateIdToken(t, keys, { ...cfg, ...c }, STARTED, NOW);
const reason = async (t: string, c: Partial<ValidateConfig> = {}) => { const r = await check(t, c); return r.ok ? "OK" : r.reason; };

describe("validateIdToken", () => {
  it("accepts a valid token and passes acr/amr through", async () => {
    const r = await check(await token({ claims: { acr: "https://world.org/oidc/acr/orb", amr: ["orb", "face"] } }));
    expect(r).toEqual({ ok: true, claims: { iss: ISS, sub: "sub_abc", authTime: Math.floor(STARTED / 1000) + 10, acr: "https://world.org/oidc/acr/orb", amr: ["orb", "face"] } });
  });
  it("maps verification failures", async () => {
    expect(await reason(await token({ key: otherPriv }))).toBe("BAD_SIGNATURE");
    expect(await reason(await token({ iss: "https://evil.example" }))).toBe("BAD_ISSUER");
    expect(await reason(await token({ aud: "other_client" }))).toBe("BAD_AUDIENCE");
    expect(await reason(await token({ exp: NOW_S - 10 }))).toBe("EXPIRED");
    expect(await reason(await token({ omit: ["auth_time"] }))).toBe("MISSING_AUTH_TIME");
  });
  it("rejects auth_time older than startedAt - 5 s, accepts exactly the boundary", async () => {
    const at = (s: number) => token({ claims: { auth_time: s } });
    const boundary = (STARTED - 5000) / 1000; // STARTED is a whole second
    expect(await reason(await at(boundary - 1))).toBe("STALE_AUTH_TIME");
    expect(await reason(await at(boundary))).toBe("OK");
  });
  it("enforces requiredAcr", async () => {
    const t = await token({ claims: { acr: "https://world.org/oidc/acr/orb" } });
    expect(await reason(t, { requiredAcr: "https://world.org/oidc/acr/orb-face" })).toBe("ACR_NOT_MET");
    expect(await reason(t, { requiredAcr: "https://world.org/oidc/acr/orb" })).toBe("OK");
    expect(await reason(await token(), { requiredAcr: "https://world.org/oidc/acr/orb" })).toBe("ACR_NOT_MET");
  });
  it("enforces requiredAmr", async () => {
    const t = await token({ claims: { amr: ["orb", "face"] } });
    expect(await reason(t, { requiredAmr: ["orb", "pin"] })).toBe("AMR_NOT_MET");
    expect(await reason(t, { requiredAmr: ["orb", "face"] })).toBe("OK");
    expect(await reason(await token(), { requiredAmr: ["orb"] })).toBe("AMR_NOT_MET");
    expect(await reason(await token(), { requiredAmr: [] })).toBe("OK");
  });
  it("does not throw on garbage", async () => {
    for (const g of ["garbage", "", "a.b.c", "eyJhbGciOiJSUzI1NiJ9.e30.AAAA"]) {
      expect(["INVALID", "BAD_SIGNATURE"]).toContain(await reason(g));
    }
  });
});

// ---- client ----
const SECRET = "s3cr3t-client-value";
const DEVICE_CODE = "dev-code-XYZ-987";
const USER_CODE = "USER-CODE-42";
const ID_TOKEN = "id.token.value-abc";
const ENV = { WORLD_CLIENT_ID: CID, WORLD_CLIENT_SECRET: SECRET, WORLD_ISSUER: `${ISS}/` };
const DISC = {
  issuer: ISS, token_endpoint: `${ISS}/api/v1/token`, device_authorization_endpoint: `${ISS}/api/v1/device_authorization`,
  jwks_uri: `${ISS}/.well-known/jwks.json`,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function setup(tokenReply: () => Response | Promise<Response> = () => json(400, { error: "authorization_pending" }), env: Record<string, string | undefined> = ENV) {
  const calls: { url: string; form?: URLSearchParams }[] = [];
  const logs: unknown[][] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init?.body instanceof URLSearchParams ? { form: init.body } : {}) });
    if (url.endsWith("/.well-known/openid-configuration")) return json(200, DISC);
    if (url === DISC.device_authorization_endpoint) {
      return json(200, { device_code: DEVICE_CODE, user_code: USER_CODE, verification_uri: "https://world.org/device", verification_uri_complete: `https://world.org/device?code=${USER_CODE}` });
    }
    if (url === DISC.token_endpoint) return tokenReply();
    throw new Error(`unexpected ${url}`);
  });
  const client = createWorldClient(env, { fetch: fetchMock as typeof fetch, logger: (e, d) => { logs.push([e, d]); } });
  return { client, calls, logs, fetchMock };
}

describe("createWorldClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("caches discovery and uses client_secret_post with scope openid", async () => {
    const { client, calls } = setup();
    const d = await client.startDevice();
    expect(d).toMatchObject({ deviceCode: DEVICE_CODE, userCode: USER_CODE, verificationUri: "https://world.org/device", interval: 5, expiresIn: 600 });
    await client.pollDevice(DEVICE_CODE);
    await client.pollDevice(DEVICE_CODE);
    expect(calls.filter((c) => c.url.includes("openid-configuration"))).toHaveLength(1);
    const start = calls.find((c) => c.url === DISC.device_authorization_endpoint)?.form;
    expect(Object.fromEntries(start ?? [])).toEqual({ client_id: CID, client_secret: SECRET, scope: "openid" });
    const poll = calls.find((c) => c.url === DISC.token_endpoint)?.form;
    expect(Object.fromEntries(poll ?? [])).toEqual({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: DEVICE_CODE, client_id: CID, client_secret: SECRET });
  });

  it("retries discovery after a failure", async () => {
    let fail = true;
    const fetchMock = vi.fn(async () => (fail ? json(500, {}) : json(200, DISC)));
    const client = createWorldClient(ENV, { fetch: fetchMock as typeof fetch, logger: () => {} });
    await expect(client.validateIdToken("x", 0)).rejects.toThrow("WORLD_DISCOVERY_FAILED");
    fail = false;
    expect(await client.validateIdToken("x", 0)).toEqual({ ok: false, reason: "INVALID" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps every poll outcome", async () => {
    const cases: [Response | Error, unknown][] = [
      [json(200, { id_token: ID_TOKEN, access_token: "at", refresh_token: "rt" }), { status: "TOKEN", idToken: ID_TOKEN }],
      [json(400, { error: "authorization_pending" }), { status: "PENDING", slowDown: false }],
      [json(400, { error: "slow_down" }), { status: "PENDING", slowDown: true }],
      [json(400, { error: "access_denied" }), { status: "DENIED" }],
      [json(400, { error: "expired_token" }), { status: "EXPIRED" }],
      [json(400, { error: "user_cancelled" }), { status: "CANCELLED" }],
      [json(400, { error: "invalid_grant" }), { status: "ERROR", code: "invalid_grant" }],
      [new TypeError("fetch failed"), { status: "ERROR", code: "NETWORK" }],
    ];
    for (const [reply, expected] of cases) {
      const { client } = setup(() => { if (reply instanceof Error) throw reply; return reply; });
      expect(await client.pollDevice(DEVICE_CODE)).toEqual(expected);
    }
  });

  it("throws on startDevice failure without leaking the secret", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("openid-configuration") ? json(200, DISC) : json(401, { error: "invalid_client" }));
    const client = createWorldClient(ENV, { fetch: fetchMock as typeof fetch, logger: () => {} });
    const err = await client.startDevice().catch((e: Error) => e);
    expect(String(err)).toContain("WORLD_DEVICE_START_FAILED: 401 invalid_client");
    expect(String(err)).not.toContain(SECRET);
  });

  it("boots without creds and throws on first use", async () => {
    const { client, fetchMock } = setup(undefined, { WORLD_CLIENT_ID: CID });
    await expect(client.startDevice()).rejects.toThrow("WORLD_CLIENT_ID/WORLD_CLIENT_SECRET not set");
    await expect(client.pollDevice("d")).rejects.toThrow("WORLD_CLIENT_ID/WORLD_CLIENT_SECRET not set");
    await expect(client.validateIdToken("t", 0)).rejects.toThrow("WORLD_CLIENT_ID/WORLD_CLIENT_SECRET not set");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never logs secrets, codes or tokens (captured logger and console)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const replies = [json(400, { error: "authorization_pending" }), json(400, { error: "slow_down" }), json(200, { id_token: ID_TOKEN, access_token: "at-SECRET" })];
    const { client, logs } = setup(() => replies.shift() ?? json(400, { error: "access_denied" }));
    await client.startDevice();
    for (let i = 0; i < 4; i++) await client.pollDevice(DEVICE_CODE);
    await client.validateIdToken(ID_TOKEN, 0);
    // default logger goes to console.info
    const dflt = createWorldClient(ENV, { fetch: setup().fetchMock as typeof fetch });
    await dflt.startDevice();
    await dflt.pollDevice(DEVICE_CODE);
    expect(logs.length).toBeGreaterThan(0);
    const all = [...logs, ...spies.flatMap((s) => s.mock.calls)].map((c) => JSON.stringify(c)).join("\n");
    expect(spies[1]?.mock.calls.length).toBeGreaterThan(0);
    for (const s of [SECRET, DEVICE_CODE, USER_CODE, ID_TOKEN, "at-SECRET", "sub_abc"]) expect(all).not.toContain(s);
  });
});
