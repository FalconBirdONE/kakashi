# Spike S3: World ID Agent Pass

**Status: discovery done against the live issuer; the login flow has NOT been run** (no `WORLD_CLIENT_ID` / `WORLD_CLIENT_SECRET`, and a human has to approve in the World app). Everything under "Observed" is from the public discovery document and docs page. Everything under "Expected, not observed" is the OAuth spec's behaviour and still needs confirming by a real run.

## Run
```
# register a client at https://auth.world.org/portal, put WORLD_CLIENT_ID / WORLD_CLIENT_SECRET in the repo-root .env
cd packages/trust && npx tsx --env-file-if-exists=../../.env scripts/world-spike.ts
```
- Success path: open the printed link, enter the code, approve.
- Failure paths: run again and click Deny / Cancel in the World UI, or do nothing until the code expires (`--max-wait=<s>` caps the local wait).
- The script never prints tokens, `device_code`, the client secret or `sub`.

## Observed (live discovery, `GET https://auth.world.org/.well-known/openid-configuration`, 2026-11-06)
| Item | Value |
|---|---|
| issuer | `https://auth.world.org` (matches the URL it was fetched from) |
| authorization_endpoint | `https://auth.world.org/api/v1/authorize` |
| token_endpoint | `https://auth.world.org/api/v1/token` |
| **device_authorization_endpoint** | `https://auth.world.org/api/v1/device_authorization` |
| jwks_uri | `https://auth.world.org/.well-known/jwks.json` (one RSA key, `alg` RS256, `use` sig, has `kid`) |
| userinfo / revocation | `/api/v1/userinfo`, `/api/v1/revoke` |
| grant_types_supported | `authorization_code`, `urn:ietf:params:oauth:grant-type:device_code` |
| response_types / scopes | `code` / `openid` only |
| token endpoint auth | `client_secret_basic`, `client_secret_post`, `private_key_jwt`, `none` |
| PKCE | `S256` only |
| id_token_signing_alg | `RS256` |
| claims_supported | `iss, sub, aud, exp, iat, jti, nonce, auth_time, acr, amr` |
| **acr_values_supported** | `https://world.org/oidc/acr/orb`, `https://world.org/oidc/acr/orb-face` |
| subject_types_supported | `pairwise` |

## Flow used
Device flow is supported, so the code-flow + PKCE fallback is **not** needed. The script does: device_authorization (`client_secret_post`, scope `openid`) -> print `verification_uri` / `user_code` -> poll the token endpoint honouring `interval` and `slow_down` -> validate the ID token with jose (`createRemoteJWKSet`, `jwtVerify` with `issuer`, `audience = client_id`, `requiredClaims: exp, iat, auth_time`, then `auth_time >= attempt start - 5 s`).

## Claims observed
Not yet. Advertised: `acr`, `amr`, `auth_time` are all in `claims_supported`. The actual values in this environment (mocked proofs) are unknown until a run completes; record them here.

## Failure codes
Expected from RFC 8628 (NOT observed yet): `authorization_pending` (keep polling), `slow_down` (add 5 s), `access_denied` (user denied or cancelled), `expired_token` (code expired). Open question: does World distinguish deny from cancel? If not, `DENIED` and `CANCELLED` in our `AuthAttemptResult` collapse into one in practice.

## Differences and notes for SPEC §8.2 / the trust implementation
1. **`sub` scope.** The docs describe it as a stable identifier scoped to the app's "sector": apps in the same sector get the same one, others get different ones. `(iss, sub)` binding still works, but `sub` is not unique per client.
2. **`WORLD_REQUIRED_ACR` values are URIs**, one of the two `acr_values_supported` above. The device flow has no `acr_values` parameter that I could confirm; check whether the achieved `acr` can be requested or only checked afterwards.
3. **Only scope `openid`.** No profile or email, which is fine: we only need `sub`, `auth_time`, `acr`, `amr`.
4. A **revocation endpoint** exists; not needed for the demo.
5. **OAuth Playground** (https://oauth-playground.toolsforhumanity.dev/, linked from the docs) is the likely way to see real token shapes by hand.
6. Single JWKS key with a `kid`: use the remote JWKS set (jose caches it and refetches on an unknown `kid`).
