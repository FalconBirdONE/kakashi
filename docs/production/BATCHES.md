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

## Batch 3 — accounting, deadlines, budgets
- Exact decimal normalization/arithmetic; per-provider request keys and billing status, persistence callbacks before/after every retry/repair, admission reservations retained for unknown billing, idempotent confirmed charges.
- Quote/run/mandate deadlines rechecked after human approval; permits capped to earliest deadline; invalid permit timestamps fail closed.
- SQLite amount bounds and overflow-safe reservation predicate; unresolved purchases block mandate versioning/replacement activation.
- Verified: workspace build; brain 34, trust 262, server 31 tests passed.
- Configured per-request admission ceiling must be a conservative upper bound for the selected model/token policy. Unknown billing retains the ceiling; no automatic assumption of zero cost. Live provider billing validation remains gated.

## Batch 4 — durable payment and delayed-answer recovery
- Encrypted permits and signer signatures, authenticated durable signer status, one signature claim per purchase, restoration of exact request queries.
- Ownership indexes/evidence reconstruct from SQLite. Reconciliation covers abandoned approvals, safe unsigned expiry, post-sign crashes and retried delivery after confirmation. Existing transaction is checked before resubmission.
- Persisted synthesis revision/lease prevents repeated answers after restart; SSE refreshes updated answers/citations. Interrupted planning with no purchase is failed explicitly for a user-controlled rerun rather than repeating paid work blindly.
- Verified: build; trust 262, signer 22 (1 live test skipped), server 37 and web 24 passed; four compiled startup scenarios.
- SIGNING/UNAVAILABLE outcomes remain reserved for reconciliation; never assume an ambiguous signer response proves no payment. HCS delivery is at least once; consumers deduplicate event ids.
