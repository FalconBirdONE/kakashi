# App branch notes (apps/server)

## Running
`pnpm --filter @tollbooth/server dev` starts on fakes at :4000. Set `DEMO_MODE=true` to enable `/api/demo/*` and `/api/dev/*`.
`USE_REAL=rails,brain,trust` switches each named part to its real factory (still stubs that throw until those branches merge).
`SESSION_SECRET` signs the session cookie. It is not in `.env.example`; without it an ephemeral secret is used and sessions reset on restart.
Browser flow: `POST /api/session` first (issues the signed cookie for the single demo user).

## Gaps in the frozen Trust interface (worked around in-process)
`Trust` has no lookup by id and no "list runs", so `orchestrator/context.ts` keeps in memory:
mandate/attempt/run/purchase ownership, the run history list, and delivered response bodies (input to synthesis).
All of it is lost on restart. Asking the lead to decide: add `getMandate`, `listRuns`, `getPurchase`, and a place to
store delivered bodies, or accept the limit for the demo (restart recovery of UNKNOWN purchases then needs these too, SPEC A1).

## Behaviour choices where the spec is silent
- SKIP decisions create a purchase row moved to AGENT_SKIPPED, so the UI can show BUY/SKIP with reasons. Policy-rejected quotes get no purchase row; they appear in `quotes[].policyResult`.
- Run ends DONE only if every need has valid evidence and nothing is unresolved or invalid; PARTIAL if there is an answer or any spend; FAILED otherwise.
- After a brain failure (decide) or timeout, synthesis is skipped and no new purchases are made.
- A run is not re-synthesized when an awaiting-approval purchase is later paid.
- Signer refusal sets FAILED_FINAL (nothing signed). A merchant REJECTED response leaves SUBMITTED for reconciliation. A SETTLED response whose tx differs from the signed one becomes UNKNOWN.
- `POST /api/demo/fault` returns 501 on real rails until it proxies to `${MERCHANTS_URL}/admin/fault` (TODO in `routes/demo.ts`).

## Workers (`src/workers/`)
Started from `src/index.ts`, stopped on shutdown. Reconciler: every 3 s plus once at startup. Audit worker: every 2 s.
- Purchase age is measured from `updatedAt` (last transition), so an UNKNOWN purchase's NOT_FOUND deadline is `maxTimeoutSeconds + 30 s` after it became UNKNOWN, never earlier than signing. Slightly late, never early.
- If `recoverDelivery` fails after a purchase is CONFIRMED, delivery is set to NOT_RECEIVED with an issue and is not retried (CONFIRMED leaves `listUnresolved`).
- The run record is not updated when the reconciler resolves a purchase after the run ended; the UI should read purchase state from the run view.
- Audit publishes strictly in order: a failure stops the batch and backs off 1 s, 2 s, 4 s ... capped at 60 s, so anchored order equals chain order.

## Web UI (`apps/web`)
- Hash routes: `#/mandate`, `#/research[/<runId>]`, `#/ledger`, `#/history`. Dev proxy `/api` -> `http://localhost:4000`.
- The contracts index imports `node:crypto`, so the browser only imports pure modules through aliases (`@tollbooth/contracts/money`, `/registry`, see `vite.config.ts` and `tsconfig.json`). Everything else from contracts is `import type`.
- Server routes added for the UI: `GET /api/config` (public flags), `GET /api/purchases` (delivery, audit and 0G fields per purchase), `audit` map on `GET /api/runs/:id`, `dataSpendAtomic` on run history.
- Audit status per purchase comes from the audit worker's in-memory anchors; after a server restart it shows "Audit status unknown" until re-anchored.
- Demo drawer fault selectors are write-only (the server has no fault getter).
- Not checked: a real browser session (console errors, layout at 375 px). Tests use jsdom; the walkthrough ran through the Vite proxy with curl.

## Real-mode changes (before integration)
- `POST /api/demo/fault` on real rails forwards `{merchantId, fault}` to `${MERCHANTS_URL}/admin/fault` (URL from env only). Unreachable merchants -> 502 `MERCHANTS_UNREACHABLE`; refused fault -> 400 `FAULT_REJECTED`.
- The real trust read model does not return `policyResult` on quotes, so the server keeps the precheck result per quote in memory and merges it into `GET /api/runs/:id`. Lost on restart.
- With the real brain, new mandates default to `maxRunDurationSeconds=300` (measured 16-28 s per 0G call; the spec default of 120 s would cut runs short). Fakes keep 120.
- `pnpm --filter @tollbooth/server start` runs `node --import tsx dist/index.js` because the workspace packages are TypeScript source.
- 0G model: `glm-5.3` with `ZG_VERIFY_TEE=false`. The Router returned `tee_verified: null` for it and for `0gm-1.0-35b-a3b`; only `0gm-1.0-35b-a3b-sia` returned `true`, but it writes its reasoning into the answer so the brain's JSON parse fails (`SCHEMA_INVALID`). Measured cost: about $0.0056 per plan call on `glm-5.3`. UI wording must not claim "TEE verified" in this configuration.
