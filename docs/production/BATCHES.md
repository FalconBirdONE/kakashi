# Production fixes verification

Base: origin/main cca19af. Isolated branch fix/production-readiness. No publication or live spending authorized.

## Batch 1 — compiled backend
- Brain/trust emit dist JavaScript/declarations; backend build configs use NodeNext and explicit runtime extensions.
- Plain-Node smoke boots each real factory and all together without external calls.
- Verified: frozen install, workspace build, compiled smoke (4 scenarios), 436 tests passed / 1 skipped.
- Provider selection pending; no blocker for compiled backend.
