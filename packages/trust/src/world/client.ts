// World ID Agent Pass OIDC device-flow client (SPEC §8.2). Approach validated by scripts/world-spike.ts.
// The client secret is read only here. Logs are metadata only: no tokens, device/user codes, secret or `sub`.
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import type { DeviceStart, PollResult, WorldClient, WorldLogger } from "./types";
import { validateIdToken } from "./validate";

type Discovery = { tokenEndpoint: string; deviceEndpoint: string; jwks: JWTVerifyGetKey };
type Json = Record<string, unknown>;

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export function createWorldClient(
  env: Record<string, string | undefined>,
  deps: { fetch?: typeof fetch; logger?: WorldLogger; now?: () => Date } = {},
): WorldClient {
  const doFetch = deps.fetch ?? fetch;
  const log: WorldLogger = deps.logger ?? ((event, data) => console.info(JSON.stringify({ at: "world", event, ...data })));
  const now = deps.now ?? (() => new Date());
  // || not ??: .env.example ships `WORLD_ISSUER=` (empty), which must still fall back to the default.
  const issuer = (env.WORLD_ISSUER || "https://auth.world.org").replace(/\/+$/, "");
  const requiredAcr = env.WORLD_REQUIRED_ACR || undefined;
  const requiredAmr = env.WORLD_REQUIRED_AMR?.split(",").map((s) => s.trim()).filter(Boolean);

  // Checked on first use, not at construction, so a server without World creds still boots.
  const creds = () => {
    const clientId = env.WORLD_CLIENT_ID, clientSecret = env.WORLD_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("WORLD_CLIENT_ID/WORLD_CLIENT_SECRET not set");
    return { clientId, clientSecret };
  };

  let discovery: Promise<Discovery> | undefined;
  const discover = () => {
    discovery ??= (async () => {
      const res = await doFetch(`${issuer}/.well-known/openid-configuration`, { headers: { accept: "application/json" } });
      log("discovery", { httpStatus: res.status });
      if (!res.ok) throw new Error(`WORLD_DISCOVERY_FAILED: ${res.status}`);
      const d = (await res.json()) as Json;
      if (d.issuer !== issuer) throw new Error("WORLD_DISCOVERY_FAILED: issuer mismatch");
      const deviceEndpoint = str(d.device_authorization_endpoint), tokenEndpoint = str(d.token_endpoint), jwksUri = str(d.jwks_uri);
      if (!deviceEndpoint) throw new Error("WORLD_DISCOVERY_FAILED: no device_authorization_endpoint");
      if (!tokenEndpoint || !jwksUri) throw new Error("WORLD_DISCOVERY_FAILED: no token_endpoint/jwks_uri");
      return { deviceEndpoint, tokenEndpoint, jwks: createRemoteJWKSet(new URL(jwksUri)) };
    })();
    discovery.catch(() => { discovery = undefined; }); // retry on a later call
    return discovery;
  };

  const post = async (url: string, form: Record<string, string>) => {
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form),
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    return { res, body };
  };

  return {
    async startDevice(): Promise<DeviceStart> {
      const { clientId, clientSecret } = creds();
      const d = await discover();
      const { res, body } = await post(d.deviceEndpoint, { client_id: clientId, client_secret: clientSecret, scope: "openid" });
      const errorCode = str(body.error);
      log("device_start", { httpStatus: res.status, errorCode });
      if (!res.ok) throw new Error(`WORLD_DEVICE_START_FAILED: ${res.status} ${errorCode ?? "unknown"}`);
      const deviceCode = str(body.device_code), userCode = str(body.user_code), verificationUri = str(body.verification_uri);
      if (!deviceCode || !userCode || !verificationUri) throw new Error(`WORLD_DEVICE_START_FAILED: ${res.status} malformed_response`);
      const complete = str(body.verification_uri_complete);
      return {
        deviceCode, userCode, verificationUri, ...(complete ? { verificationUriComplete: complete } : {}),
        expiresIn: Number(body.expires_in ?? 600) || 600, interval: Number(body.interval ?? 5) || 5,
      };
    },

    async pollDevice(deviceCode: string): Promise<PollResult> {
      const { clientId, clientSecret } = creds();
      let res: Response, body: Json;
      try {
        const d = await discover();
        ({ res, body } = await post(d.tokenEndpoint, { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: clientId, client_secret: clientSecret }));
      } catch {
        log("poll", { status: "ERROR", errorCode: "NETWORK" });
        return { status: "ERROR", code: "NETWORK" };
      }
      const errorCode = str(body.error);
      const idToken = str(body.id_token);
      const result: PollResult =
        res.ok && idToken ? { status: "TOKEN", idToken }
        : errorCode === "authorization_pending" ? { status: "PENDING", slowDown: false }
        : errorCode === "slow_down" ? { status: "PENDING", slowDown: true }
        : errorCode === "access_denied" ? { status: "DENIED" }
        : errorCode === "expired_token" ? { status: "EXPIRED" }
        : errorCode?.includes("cancel") ? { status: "CANCELLED" }
        : { status: "ERROR", code: errorCode ?? (res.ok ? "NO_ID_TOKEN" : `HTTP_${res.status}`) };
      log("poll", { status: result.status, httpStatus: res.status, errorCode });
      return result;
    },

    async validateIdToken(idToken: string, startedAtMs: number) {
      const { clientId } = creds();
      const d = await discover();
      return validateIdToken(idToken, d.jwks, {
        issuer, clientId,
        ...(requiredAcr ? { requiredAcr } : {}),
        ...(requiredAmr?.length ? { requiredAmr } : {}),
      }, startedAtMs, now());
    },
  };
}
