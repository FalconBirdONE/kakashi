# Branch 1: token-check data path (contracts, merchants, rails, server glue)

You are implementing one half of a pivot of Kakashi, alone, on git branch `branch-1`. A teammate is building the other half on `branch-2` at the same time. This file is your complete instruction set: where it conflicts with SPEC.md, this file wins, so don't read SPEC.md unless you need to.

Run every phase in order without stopping to ask, except where a step tells you to stop. End each phase by running its gate and fixing failures before you move on. Work fast: make the smallest diff that works, with no refactors and no new dependencies. Run `date` now and before each phase. If more than 45 minutes have passed, skip anything marked (cut if late), then finish the gates and commit.

## The pivot

Kakashi was a research agent that bought weather data. It becomes a **pre-trade check for Hedera tokens**. The user asks, for example, "Should I put 2,000 USDC into 0.0.731861?" The agent (0G) plans which risks matter and gets x402 quotes from four check sellers. It buys only the checks that the trade size justifies, pays in USDC on Hedera **testnet**, and answers BUY, CAUTION or AVOID with receipts. The checks read real **Hedera mainnet** token data from the public mirror node.

Everything else stays as it is: mandates, World ID activation and step-up, the policy engine, the isolated signer, pay-once recovery and the HCS audit trail.

## Frozen shared contract (identical in both branch prompts; do not deviate)

1. `PlanOutput.query` becomes `{ tokenId: string; tradeUsd: number }`. The Zod schema is `z.object({ tokenId: z.string().regex(/^0\.0\.\d{1,10}$/), tradeUsd: z.number().positive().max(1_000_000_000) }).strict()`.
2. Merchant requests carry only `?tokenId=0.0.N`. The trade size never leaves our server.
3. Merchant ids, prices, reference prices, freshness values and payTo env var names stay the same. Only these fields change:

| id (unchanged) | price (unchanged) | name | path | capabilities | coverage | responseSchemaId |
|---|---|---|---|---|---|---|
| `quickcast` | 0.01 | KeyScan | `/m/quickcast/keys` | `["admin-keys","custom-fees","supply-config"]` | `token configuration` | `token-keys.v1` |
| `groundtruth` | 0.03 | HolderMap | `/m/groundtruth/holders` | `["holder-concentration","whale-wallets"]` | `every holder above 1% of supply` | `token-holders.v1` |
| `hourlypro` | 0.05 | TreasuryWatch | `/m/hourlypro/treasury` | `["treasury-outflows","recent-mints"]` | `treasury account, last 100 transactions` | `token-treasury.v1` |
| `gouger` (adversarial) | 0.50 | InsiderAlpha | `/m/gouger/alpha` | `["insider-alpha"]` | `claimed insider calls` | `token-alpha.v1` |

4. These mainnet token ids are verified and safe to use in examples and tests:
   - SAUCE `0.0.731861`: admin and supply keys, treasury `0.0.1077627`.
   - USDC `0.0.456858`: admin, freeze and supply keys.
   - DOVU `0.0.624505`: admin and supply keys. Total supply is `15924365595423638` with 8 decimals, which is more than 2^53.
   - GRELF `0.0.1159074`: no keys.
   - REALHP, "The Real Hashpack Token", `0.0.4696266`: no keys, copycat name.
5. Track rules that must keep holding:
   - KeyScan (0.01) is below the default auto-approve cap (0.02), so the agent buys it with no human approval (Hedera track).
   - HolderMap (0.03) and TreasuryWatch (0.05) are above that cap, so they need a World ID step-up (World track).
   - InsiderAlpha (0.50) is always rejected by policy.

## Ownership

You may edit only: `packages/contracts/**`, `apps/merchants/**`, `packages/rails/**`, `apps/server/**`, `apps/signer/test/**`, `packages/trust/test/**`, `scripts/**` (which includes `scripts/browser-journey.mjs` and `scripts/hedera/**`), `.env.example` and `docs/production/production.env.example`.

Never edit: `packages/brain/**`, `evals/**`, `apps/web/**`, `README.md`, `SPEC.md`, `docs/brain/**` or `prompts/**`. Branch 2 owns them.

## Phase 0: branch

```
git fetch origin && git checkout -b branch-1 origin/main && pnpm install --frozen-lockfile
pnpm -r build && pnpm -r test
```

Note any failures that already exist before you change anything, and carry on.

## Phase 1: contracts

- `packages/contracts/src/registry.ts`:
  - Apply the table above.
  - Add this line above `MERCHANT_REGISTRY`: `// shortcut: v1 weather ids kept as internal keys to avoid env, DB and test churn; rename after the event.`
- `packages/contracts/src/schemas.ts` and `entities.ts`: apply the new `query` shape.
- `packages/contracts/src/fakes/brain.ts`: `plan` returns `query: { tokenId: "0.0.731861", tradeUsd: 100 }`. The default need description becomes `"token risk"`.
- `packages/contracts/src/fakes/rails.ts`:
  - The body becomes `{ merchant: m.id, source: "fake", tokenId: query.tokenId ?? "0.0.731861", generatedAt, data: { summary } }`.
  - In the fake `validateDelivery`, replace the location check with "tokenId present".
  - Keep all fault behaviour.
- Tests in `packages/contracts/test/smoke.test.ts`:
  - The registry still has the 4 ids at their old prices, with the new names, paths and schema ids.
  - `planOutputSchema()` accepts `{tokenId:"0.0.731861",tradeUsd:2000}`.
  - It rejects the old lat/lon shape, `tokenId:"SAUCE"`, `tradeUsd:0` and extra keys.

Gate: `pnpm -C packages/contracts build && pnpm -C packages/contracts test && pnpm -C packages/contracts typecheck`

## Phase 2: merchants (real mainnet data)

**`apps/merchants/src/config.ts`**
- Add `TOKEN_MIRROR_URL`, defaulting to `https://mainnet-public.mirrornode.hedera.com`, and expose it as `tokenMirrorUrl` in `MerchantsConfig`.
- Never use `MIRROR_NODE_URL` for token data. That one is testnet and verifies payments.

**New pure module `apps/merchants/src/analysis.ts`** (no I/O):
- `keyFlags(token)` returns a string array:
  - `ADMIN_KEY: issuer can change the token's keys`
  - `FREEZE_KEY: issuer can freeze any holder's balance`
  - `WIPE_KEY: issuer can wipe any holder's balance`
  - `PAUSE_KEY: issuer can pause all transfers`
  - `SUPPLY_KEY: issuer can mint more (supply type <FINITE|INFINITE>, max <max_supply>)`
  - `KYC_KEY: transfers need issuer KYC`
  - `FEE_SCHEDULE_KEY: issuer can add transfer fees later`
  - `CUSTOM_FEES: <n> fixed, <n> fractional, <n> royalty fees on transfer`
  - `NO_ADMIN_KEYS: configuration is immutable`, used only when none of the flags above apply.
- `holderStats(totalSupply: string, treasury: string, balances: {account: string; balance: number | string}[])` returns `{ thresholdPct: 1, whales: [{account, balance: string, pct: number}], whaleCount, whaleSharePct, treasurySharePct }`. Sort whales by balance, largest first.
  - Do all the arithmetic in BigInt. Compute `pct = Number(balance * 10000n / supply) / 100`.
- `treasuryStats(tokenId, treasury, transactions)` returns `{ account, sampled, mints: [{timestamp, amount}], outflows: [{timestamp, amount, to}], outflowTotal: string }`.
  - Count only `token_transfers` entries for this `tokenId`.
  - Outflows are negative treasury amounts outside `TOKENMINT` and `TOKENBURN`.
  - `to` is the account in the same transaction with the matching positive amount.
- Also export `holderFlags` and `treasuryFlags`, for example:
  - `WHALES: 9 wallets each hold over 1% (62.4% together)`
  - `TREASURY_SELLING: 12 outflows in the last 100 transactions`
  - `RECENT_MINTS: 3 mints in the last 100 transactions`

**`apps/merchants/src/data.ts`**: replace Open-Meteo with mirror node calls, each with a 5 s timeout, against `tokenMirrorUrl`:
- Token info: `GET /api/v1/tokens/{tokenId}`
- Holders: `GET /api/v1/tokens/{tokenId}/balances?account.balance=gt:{totalSupply/100n}&limit=100`
- Treasury: `GET /api/v1/transactions?account.id={treasury}&limit=100&order=desc`

Bodies:
- Every body starts with `{ merchant, source: "hedera-mainnet-mirror" | "fixture", tokenId, generatedAt }`. Drop `location`, `window`, `units` and `fieldUnits`.
- `quickcast` and `gouger` return `token-keys.v1`: `{ token: { name, symbol, decimals, totalSupply, maxSupply, supplyType, treasury, createdAt, memo, pauseStatus, keys: {admin, freeze, wipe, supply, pause, kyc, feeSchedule} (booleans), customFees: {fixed, fractional, royalty} (counts) } | null, flags }`.
- `groundtruth` returns `token-holders.v1`: `{ holders: holderStats(...), flags }`.
- `hourlypro` returns `token-treasury.v1`: `{ treasury: treasuryStats(...), flags }`.

Errors and fallbacks:
- If the token lookup returns 404, return a real, valid body with `token: null` (or empty stats) and the flag `NOT_FOUND: no such token on Hedera mainnet`.
- If any fetch fails for a network or 5xx reason, or `fixtureMode` is on, use the fixtures and set the body's `tokenId` to the fixture's real id `0.0.731861`. Never relabel fixture data as another token, so validation flags the mismatch. Reword the existing shortcut comment to match.

Other changes in this module:
- `querySchema` becomes `z.object({ tokenId: z.string().regex(/^0\.0\.\d{1,10}$/) })`. Keep it non-strict so extra keys, such as `run` in `scripts/hedera/e2e.ts`, still pass.
- Keep the faults: `STALE_DATA` ages `generatedAt` by 2 days, and `INJECT_TEXT` adds `note: INJECTED_NOTE`. Leave the `INJECTED_NOTE` constant unchanged; it is the test payload for the prompt-injection defence.

**Fixtures**
- Record real SAUCE responses with curl into `apps/merchants/fixtures/token.json`, `holders.json` and `treasury.json`, using the three URLs above for `0.0.731861`.
- Delete `daily.json`, `hourly.json` and `current.json`.

**`apps/merchants/src/app.ts`**: the 400 message becomes `invalid query: expected tokenId (0.0.N)`.

**Tests**
- New `apps/merchants/test/analysis.test.ts`:
  - `keyFlags` on the SAUCE fixture gives ADMIN_KEY and SUPPLY_KEY, and no WIPE_KEY or FREEZE_KEY.
  - A USDC-like token gives FREEZE_KEY.
  - A token with no keys gives only NO_ADMIN_KEYS.
  - A fractional fee gives CUSTOM_FEES.
  - `holderStats` with DOVU's supply `15924365595423638` and one balance of exactly a quarter of it gives `pct` exactly 25, with no precision loss. `treasurySharePct` is correct.
  - `treasuryStats` counts TOKENMINT and negative treasury transfers of this token, and ignores other tokens' transfers.
- Update `apps/merchants/test/merchants.test.ts`:
  - `QUERY = { tokenId: "0.0.731861" }`. Add `tokenMirrorUrl` to `baseConfig`.
  - A missing tokenId, `SAUCE` and `0.0.x` each get a 400.
  - Every existing 402, settle, idempotency, recover and fault test passes with the new query.
  - Live mode (`fixtureMode: false`) with a mocked fetch:
    - It calls exactly the 3 mainnet URLs, with the `account.balance=gt:` threshold equal to supply/100.
    - Nothing hits `mirrorUrl` except `/recover`'s payment check.
    - A 404 token gives a NOT_FOUND body.
    - A network failure gives a fixture body with tokenId `0.0.731861`.

Gate: `pnpm -C apps/merchants build && pnpm -C apps/merchants test && pnpm -C apps/merchants typecheck`

## Phase 3: rails

**`packages/rails/src/validate.ts`**
- Define one `RESPONSE_SCHEMAS` entry per new schema id. The base is `{ merchant, source, tokenId, generatedAt }`. The `token` (nullable), `holders` and `treasury` objects use `.passthrough()`, and `flags` is `z.array(z.string())`.
- Replace the distance check with: if `body.tokenId !== query.tokenId`, report the issue `wrong token: <body>, requested <query>`.
- Remove the window and units checks, and remove `distanceKm` from this file, from `packages/rails/src/index.ts` and from the tests.
- Keep the merchant, freshness and future-timestamp checks.

**`packages/rails/test/rails.test.ts`**
- `QUERY` becomes `{ tokenId: "0.0.731861" }`.
- The quote URL assertion becomes `http://127.0.0.1:4200/m/quickcast/keys?tokenId=0.0.731861`.
- The path-injection test still rejects.
- Validation cases: a good body is valid; a wrong token, a stale body, a future timestamp, a schema violation and a wrong merchant are each invalid.

Gate: `pnpm -C packages/rails build && pnpm -C packages/rails test && pnpm -C packages/rails typecheck`

## Phase 4: server glue, scripts and full gate

**Server code**
- `apps/server/src/orchestrator/run.ts`, around line 102: change it to `const query = { tokenId: planned.query.tokenId };`.
- `apps/server/src/orchestrator/util.ts` `planQuery`: change it to `return q?.tokenId ? { tokenId: q.tokenId } : {};`.

**Broken tests**
- Fix the plan fixtures in `apps/server/test/restart.test.ts` and `packages/trust/test/views.test.ts`.
- Fix any other test the new shape breaks.
- In `apps/signer/test/signer.test.ts`, change the URLs to `/m/quickcast/keys?tokenId=0.0.731861`.
- Leave free-text questions such as "Will it rain?" in tests alone; they are arbitrary strings.

**New test** in `apps/server/test/orchestrator.test.ts`, named "merchants receive only the token ID, never the trade size":
- Use a brain whose plan returns `{tokenId:"0.0.731861", tradeUsd: 2000}`.
- Spy on `rails.fetchQuote` and assert that every query equals `{ tokenId: "0.0.731861" }`.

**Scripts**
- `apps/server/scripts/controlled-stack.mjs`:
  - `validData` becomes a `token-keys.v1` body for SAUCE.
  - The planning value becomes `{needs:[{needId:'n1',description:'Admin keys and fees',priority:1}],query:{tokenId:'0.0.731861',tradeUsd:20}}`.
  - The synthesis answer becomes `'Controlled check: CAUTION, issuer holds admin and supply keys.'`.
- `scripts/browser-journey.mjs`:
  - The questions become `'Should I put 20 USDC into 0.0.731861?'` and `'Re-check 0.0.731861 after recovery'`, including the History lookup.
  - Wait for the new controlled answer text.
  - Change no other selector. Branch 2 keeps the labels `Mandate`, `Research`, `Ledger`, `History`, `Create mandate`, `Activate with World ID`, `Run`, `Your question`, `Active` and `Data recovered`.
- `scripts/hedera/e2e.ts` and `scripts/hedera/spike-pay.ts`: the query becomes `{ tokenId: "0.0.731861", run: ... }`, and the default URL becomes `/m/quickcast/keys?tokenId=0.0.731861`.

**Env files**: in `.env.example` and `docs/production/production.env.example`, add `TOKEN_MIRROR_URL=https://mainnet-public.mirrornode.hedera.com` with the comment `# mainnet, read-only token data; payments still use MIRROR_NODE_URL (testnet)`.

Gate (if Playwright has no browser, run `pnpm exec playwright install chromium` once):

```
pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm smoke:compiled && pnpm test:browser
```

Brain and web are untouched on this branch and must still pass.

## Phase 5: live smoke on real mainnet data (cut if late)

Write a throwaway script outside the repo that imports the built `apps/merchants/dist/data.js` and calls `buildBody` with `fixtureMode: false` and the real `fetch` for `0.0.731861`, `0.0.456858` and `0.0.624505`. Print the flags. Expected results:
- USDC shows FREEZE_KEY.
- SAUCE shows ADMIN_KEY and SUPPLY_KEY, and has at least 1 whale.
- DOVU's pct values are finite.

If mainnet is unreachable, note that and carry on. Don't commit the script.

## Phase 6: commit and push

- Run `git status`. Confirm that only owned paths changed, and revert tracked changes outside them. Leave untracked files you didn't create (such as `prompts/*.md`) alone: don't delete them and don't commit them.
- Run `git add packages/contracts apps/merchants packages/rails apps/server apps/signer/test packages/trust/test scripts .env.example docs/production/production.env.example` and commit with the message `feat: pivot data path to Hedera token checks`. The message must have no `Co-Authored-By` trailer and no "Generated with Claude Code" line. If your tooling would add either, stop and give the human the exact `git commit` command instead.
- Run `git push -u origin branch-1`. Don't merge, and don't open a PR.

## Phase 7: integrate (person 1 runs this after both branches are pushed)

Run `git fetch origin`. If `origin/branch-2` doesn't exist, or `git log origin/branch-2 --oneline --grep 'pivot brain, evals and web'` prints nothing, stop and print: "branch-2 is not pushed yet. Say 'run phase 7' when it is." Otherwise run:

```
git checkout -b integrate origin/main
git merge --no-ff origin/branch-1 -m "merge branch-1: token-check data path"
git merge --no-ff origin/branch-2 -m "merge branch-2: token-check brain and web"
pnpm install --frozen-lockfile
pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm smoke:compiled && pnpm test:browser
```

There should be no conflicts, because the branches own disjoint paths. If `pnpm-lock.yaml` conflicts, take `origin/main`'s version and re-run install.

Then check that each of these holds, and fix integration breakages only:
- **Hedera:** a run asking "Should I put 20 USDC into 0.0.731861?" in demo mode buys KeyScan with no approval card, and InsiderAlpha shows "Rejected".
- **World:** a purchase of HolderMap or TreasuryWatch shows an approval card, and cancelling it means no payment. The existing trust and server tests cover this and must pass.
- **0G:** `pnpm -C evals test` passes; it shows that a cheapest-first rule fails at least half the eval cases.
- **Copy:** `grep -rniE 'weather|forecast|open-meteo|umbrella' apps/*/src packages/*/src README.md` matches nothing in user-visible text.

If you had to fix anything, commit it as `fix: integrate token-check pivot`, again with no AI attribution. Then STOP and print these commands for the human to run. Never push main yourself:

```
git checkout main && git merge --ff-only integrate && git push origin main
```
