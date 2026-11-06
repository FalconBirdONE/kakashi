# Production fixes verification

Base: origin/main cca19af. Isolated branch fix/production-readiness. No publication or live spending authorized.

## Batch 1 — compiled backend
- Brain/trust emit dist JavaScript/declarations; backend build configs use NodeNext and explicit runtime extensions.
- Plain-Node smoke boots each real factory and all together without external calls.
- Verified: frozen install, workspace build, compiled smoke (4 scenarios), 436 tests passed / 1 skipped.
- Provider selection pending; no blocker for compiled backend.

## Batch 2 — accounts and authority
- Persistent invite-only OIDC account/session store; hashed opaque sessions, expiry/revocation/logout, PKCE/state/nonce, CSRF and durable rate counters.
- Demo sessions are restricted to demo mode; real trust/rails are forbidden in demo mode. Database-backed ownership replaces production map authority.
- Verified: workspace build, server 31 tests, web 23 tests, four plain-Node compiled startups.
- Decision pending: production sign-in provider. Generic OIDC plumbing is locally implemented; sign-in is unavailable without issuer/client/redirect configuration. No provider connection or live approval performed.
