// Spike S3: one real World ID Agent Pass login (OIDC device flow), validated server-side with jose.
// Run: cd packages/trust && npx tsx --env-file-if-exists=../../.env scripts/world-spike.ts [--max-wait=<seconds>]
// Needs WORLD_CLIENT_ID and WORLD_CLIENT_SECRET (WORLD_ISSUER defaults to https://auth.world.org).
// To observe failure paths: run again and click Deny/Cancel in the World UI, or do nothing until the code expires.
// Never prints: tokens, device_code, client secret, or `sub`.
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";

const t0 = Date.now();
const issuer = (process.env.WORLD_ISSUER ?? "https://auth.world.org").replace(/\/$/, "");
const clientId = process.env.WORLD_CLIENT_ID, clientSecret = process.env.WORLD_CLIENT_SECRET;
const maxWait = Number(process.argv.find((a) => a.startsWith("--max-wait="))?.split("=")[1] ?? "0");
const log = (...a: unknown[]) => console.log(...a);

// (a) discovery
const disc = (await (await fetch(`${issuer}/.well-known/openid-configuration`)).json()) as Record<string, any>;
log("issuer:", disc.issuer);
for (const k of ["authorization_endpoint", "token_endpoint", "device_authorization_endpoint", "jwks_uri"]) log(`${k}:`, disc[k] ?? "(none)");
log("grant_types_supported:", disc.grant_types_supported?.join(", "));
log("scopes_supported:", disc.scopes_supported?.join(", "));
log("claims_supported:", disc.claims_supported?.join(", "));
log("acr_values_supported:", disc.acr_values_supported?.join(", "));
log("token_endpoint_auth_methods_supported:", disc.token_endpoint_auth_methods_supported?.join(", "));
if (disc.issuer !== issuer) { console.error(`issuer mismatch: discovery says ${disc.issuer}`); process.exit(1); }

if (!clientId || !clientSecret) {
  console.error("\nWORLD_CLIENT_ID / WORLD_CLIENT_SECRET not set (register a client at https://auth.world.org/portal). Discovery only; no flow started.");
  process.exit(2);
}
if (!disc.device_authorization_endpoint) {
  console.error("Device flow NOT supported by this issuer: the authorization-code + PKCE fallback is not implemented in this spike.");
  process.exit(3);
}

// (b) device authorization, client_secret_post
const form = (o: Record<string, string>) => ({
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(o),
});
const startedAt = Math.floor(Date.now() / 1000);
const dres = await fetch(disc.device_authorization_endpoint, form({ client_id: clientId, client_secret: clientSecret, scope: "openid" }));
const dev = (await dres.json()) as Record<string, any>;
if (!dres.ok) { console.error("device_authorization failed:", dres.status, dev.error, dev.error_description ?? ""); process.exit(1); }
log("\ndevice_authorization response fields:", Object.keys(dev).join(", "));
log("verification_uri:", dev.verification_uri);
if (dev.verification_uri_complete) log("verification_uri_complete:", dev.verification_uri_complete);
log("user_code:", dev.user_code, " expires_in:", dev.expires_in, " interval:", dev.interval);
log("\nOpen the link, enter the code, then approve (or deny/cancel/wait to see failure codes)...");

let interval = Number(dev.interval ?? 5);
const deadline = Date.now() + Math.min(Number(dev.expires_in ?? 600), maxWait > 0 ? maxWait : Infinity) * 1000;
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
let tok: Record<string, any> | undefined;
while (Date.now() < deadline) {
  await sleep(interval);
  const r = await fetch(disc.token_endpoint, form({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: dev.device_code, client_id: clientId, client_secret: clientSecret,
  }));
  const body = (await r.json()) as Record<string, any>;
  if (r.ok && body.id_token) { tok = body; break; }
  log(`poll -> http ${r.status} error=${body.error}${body.error_description ? ` (${body.error_description})` : ""}`);
  if (body.error === "authorization_pending") continue;
  if (body.error === "slow_down") { interval += 5; continue; }
  console.error(`TERMINAL failure: ${body.error}. No token issued; protected action must not happen.`);
  log(`elapsed ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(1);
}
if (!tok) { console.error("TIMED OUT locally before a terminal result (raise --max-wait or wait for expired_token)."); process.exit(1); }

// (c) validate the ID token server-side
log("\ntoken response fields:", Object.keys(tok).join(", "), " token_type:", tok.token_type, " scope:", tok.scope);
const jwks = createRemoteJWKSet(new URL(disc.jwks_uri));
const { payload } = await jwtVerify(tok.id_token, jwks, { issuer, audience: clientId, requiredClaims: ["exp", "iat", "auth_time"] });
const hdr = decodeProtectedHeader(tok.id_token);
if (typeof payload.auth_time !== "number" || payload.auth_time < startedAt - 5) throw new Error("auth_time missing or older than this attempt");
log("VALID id_token. header alg:", hdr.alg, " kid present:", Boolean(hdr.kid));
log("claim names:", Object.keys(payload).join(", "));
log("acr:", payload.acr, " amr:", JSON.stringify(payload.amr));
log("auth_time offset from attempt start (s):", payload.auth_time - startedAt, " lifetime exp-iat (s):", (payload.exp ?? 0) - (payload.iat ?? 0));
log("sub present:", typeof payload.sub === "string", "(value never printed)");
log(`\nTIME TO FIRST SUCCESS (script start -> validated token): ${Math.round((Date.now() - t0) / 1000)}s`);
