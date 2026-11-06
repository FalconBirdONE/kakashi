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
