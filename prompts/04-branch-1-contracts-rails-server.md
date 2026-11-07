# Branch 1: token-check contracts, rails, server glue and integration

You are implementing one quarter of a pivot of Kakashi, alone, on git branch `branch-1`. Three teammates are building the other quarters on `branch-2`, `branch-3` and `branch-4` at the same time. This file is your complete instruction set: where it conflicts with SPEC.md or any other file in `prompts/`, this file wins.

Run every phase in order without stopping to ask, except where a step tells you to stop. End each phase by running its gate and fixing failures before you move on. Work fast: make the smallest diff that works, with no refactors and no new dependencies. Run `date` now and before each phase. If more than 35 minutes have passed, skip anything marked (cut if late), then finish the gates and commit.

## The pivot

Kakashi was a research agent that bought weather data. It becomes a **pre-trade check for Hedera tokens**. The user asks, for example, "Should I put 2,000 USDC into 0.0.731861?" The agent (0G) plans which risks matter and gets x402 quotes from four check sellers. It buys only the checks that the trade size justifies, pays in USDC on Hedera **testnet**, and answers BUY, CAUTION or AVOID with receipts. The checks read real **Hedera mainnet** token data from the public mirror node.

Everything else stays as it is: mandates, World ID activation and step-up, the policy engine, the isolated signer, pay-once recovery and the HCS audit trail.

**Why anyone pays.** Tokens on Hedera can carry issuer keys that freeze, wipe or pause balances, or mint more supply, and they can carry hidden transfer fees. Most traders never check. The free mirror node can't tell you who the top holders are, because it lists balances by account id, not by size. You pay cents per check, scaled to what you're putting in, instead of a monthly analytics subscription.

A different "treasury payment firewall" story was prototyped locally by a teammate. It isn't used. Don't build it, and don't merge it.

## Frozen shared contract (identical in all four prompts; do not deviate)

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
   - SAUCE `0.0.731861`: admin and supply keys, treasury `0.0.1077627`, 9 wallets above 1% when checked.
   - USDC `0.0.456858`: admin, freeze and supply keys.
   - DOVU `0.0.624505`: admin and supply keys. Total supply is `15924365595423638` with 8 decimals, which is more than 2^53.
   - GRELF `0.0.1159074`: no keys.
   - REALHP, "The Real Hashpack Token", `0.0.4696266`: no keys, copycat name.

   Never invent other token ids.
5. Track rules that must keep holding:
   - KeyScan (0.01) is below the default auto-approve cap (0.02), so the agent buys it with no human approval (Hedera track).
   - HolderMap (0.03) and TreasuryWatch (0.05) are above that cap, so they need a World ID step-up (World track).
   - InsiderAlpha (0.50) is always rejected by policy.
6. **Merchant response bodies.** Branch 2 produces them, and branch 1 validates them in `packages/rails/src/validate.ts`.
   - Every body is `{ merchant: "<id>", source: "hedera-mainnet-mirror" | "fixture", tokenId: "0.0.N", generatedAt: "<ISO datetime>", flags: string[], note?: string }` plus one kind object:
     - `quickcast` and `gouger` (`token-keys.v1`): `token: { name, symbol, decimals, totalSupply, maxSupply, supplyType, treasury, createdAt, memo, pauseStatus, keys: { admin, freeze, wipe, supply, pause, kyc, feeSchedule } (booleans), customFees: { fixed, fractional, royalty } (counts) } | null`
     - `groundtruth` (`token-holders.v1`): `holders: { thresholdPct: 1, whales: [{ account, balance: string, pct: number }], whaleCount, whaleSharePct, treasurySharePct }`
     - `hourlypro` (`token-treasury.v1`): `treasury: { account, sampled, mints: [{ timestamp, amount }], outflows: [{ timestamp, amount, to }], outflowTotal: string }`
   - A token that doesn't exist on mainnet gets `token: null` (or empty stats) and the flag `NOT_FOUND: no such token on Hedera mainnet`.
   - Fixture data always carries its real `tokenId`, `0.0.731861`, so validation catches a mismatch.

## Who owns what

| Branch | Owns |
|---|---|
| 1 | `packages/contracts`, `packages/rails`, `apps/server`, `apps/signer/test`, `packages/trust/test`, `scripts/`, `.env.example`, `docs/production/production.env.example`. Branch 1 also runs the final integration. |
| 2 | `apps/merchants` |
| 3 | `packages/brain`, `evals`, `docs/brain`, `README.md` |
| 4 | `apps/web` |

Edit only your own row's paths. Nobody edits `SPEC.md` or `prompts/`.

## Rules that keep the branches independent

- Until branch 1 merges, `packages/contracts` still has the old weather registry: the names QuickCast and so on, the paths `/m/<id>/forecast` and the lat/lon plan type. Every other branch must pass both before and after branch 1 merges:
  - Read merchant names and paths from `MERCHANT_REGISTRY` by id; never hard-code them in tests.
  - Read the plan's token fields through `plan.query as { tokenId?: string; tradeUsd?: number }`.
- `scripts/browser-journey.mjs` drives the web app. Keep these accessible names and texts exactly as they are:
  - Links: `Mandate`, `Research`, `Ledger`, `History`.
  - Buttons: `Create mandate`, `Activate with World ID`, `Run`.
  - Textbox: `Your question`.
  - Texts: `Active`, `Data recovered`, the `[1]` citation link, and the `0.00000003 0G credits` ledger format.
- `apps/server/scripts/controlled-stack.mjs` answers brain calls by matching the prompts, so these must stay true:
  - The SYSTEM prompts contain `TASK: planning` and `TASK: decide`.
  - With no preferences, the decide user message is plain JSON with a `quotes` array.
  - Synthesis evidence lines keep the form `purchaseId: <id>`.

## Phase 0: branch

```
git status --porcelain
```

If that prints anything, run `git stash push -u -m "before branch-1"` and mention the stash in your final summary. Never drop it. Then:

```
git fetch origin && git checkout -b branch-1 origin/main && pnpm install --frozen-lockfile && pnpm -r build
```

## Phase 1: contracts

- `packages/contracts/src/registry.ts`:
  - Apply the table.
  - Add this line above `MERCHANT_REGISTRY`: `// shortcut: v1 weather ids kept as internal keys to avoid env, DB and test churn; rename after the event.`
- `packages/contracts/src/schemas.ts` and `entities.ts`: apply the new `query` shape.
- `packages/contracts/src/fakes/brain.ts`: `plan` returns `query: { tokenId: "0.0.731861", tradeUsd: 100 }`. The default need description becomes `"token risk"`.
- `packages/contracts/src/fakes/rails.ts`:
  - The fake body becomes `{ merchant: m.id, source: "fixture", tokenId: query.tokenId ?? "0.0.731861", generatedAt, flags: [], data: { summary } }`.
  - In the fake `validateDelivery`, replace the location check with "tokenId present".
  - Keep all fault behaviour.
- Tests in `packages/contracts/test/smoke.test.ts`:
  - The registry has the 4 ids at their old prices, with the new names, paths and schema ids.
  - `planOutputSchema()` accepts `{tokenId:"0.0.731861",tradeUsd:2000}`.
  - It rejects the old lat/lon shape, `tokenId:"SAUCE"`, `tradeUsd:0` and extra keys.

Gate: `pnpm -C packages/contracts build && pnpm -C packages/contracts test && pnpm -C packages/contracts typecheck`

## Phase 2: rails

**`packages/rails/src/validate.ts`**
- Define one `RESPONSE_SCHEMAS` entry per new schema id, following contract item 6. The base fields are required. The kind objects use `.passthrough()`, and `token` is nullable.
- Replace the distance check with: if `body.tokenId !== query.tokenId`, report the issue `wrong token: <body>, requested <query>`.
- Remove the window and units checks, and remove `distanceKm` from this file, from `packages/rails/src/index.ts` and from the tests.
- Keep the merchant, freshness and future-timestamp checks.

**`packages/rails/test/rails.test.ts`**
- `QUERY` becomes `{ tokenId: "0.0.731861" }`.
- The quote URL assertion becomes `http://127.0.0.1:4200/m/quickcast/keys?tokenId=0.0.731861`.
- The path-injection test still rejects.
- Validation cases:
  - Valid: a good body for each of the 3 kinds, and a NOT_FOUND body with `token: null`.
  - Invalid: a wrong token, a stale body, a future timestamp, a schema violation and a wrong merchant.

Gate: `pnpm -C packages/rails build && pnpm -C packages/rails test && pnpm -C packages/rails typecheck`

## Phase 3: server glue, scripts and env

**Server code**
- `apps/server/src/orchestrator/run.ts`, around line 102: change it to `const query = { tokenId: planned.query.tokenId };`.
- `apps/server/src/orchestrator/util.ts` `planQuery`: change it to `return q?.tokenId ? { tokenId: q.tokenId } : {};`.

**Broken tests**
- Fix the plan fixtures in `apps/server/test/restart.test.ts` and `packages/trust/test/views.test.ts`.
- Fix any other test in your paths that the shape or path change breaks.
- In `apps/signer/test/signer.test.ts`, change the URLs to `/m/quickcast/keys?tokenId=0.0.731861`.
- Leave free-text questions such as "Will it rain?" in tests alone.

**New test** in `apps/server/test/orchestrator.test.ts`, named "merchants receive only the token ID, never the trade size":
- Use a brain whose plan returns `{tokenId:"0.0.731861", tradeUsd: 2000}`.
- Spy on `rails.fetchQuote` and assert that every query equals `{ tokenId: "0.0.731861" }`.

**Scripts**
- `apps/server/scripts/controlled-stack.mjs`:
  - `validData` becomes a `token-keys.v1` SAUCE body, following contract item 6.
  - The planning value becomes `{needs:[{needId:'n1',description:'Admin keys and fees',priority:1}],query:{tokenId:'0.0.731861',tradeUsd:20}}`.
  - The synthesis answer becomes `'Controlled check: CAUTION, issuer holds admin and supply keys.'`.
- `scripts/browser-journey.mjs`:
  - The questions become `'Should I put 20 USDC into 0.0.731861?'` and `'Re-check 0.0.731861 after recovery'`, including the History lookup.
  - Wait for the new controlled answer text. Change no other selector.
- `scripts/hedera/e2e.ts` and `scripts/hedera/spike-pay.ts`: the query becomes `{ tokenId: "0.0.731861", run: ... }`, and the default URL becomes `/m/quickcast/keys?tokenId=0.0.731861`.

**Env files**: in `.env.example` and `docs/production/production.env.example`, add `TOKEN_MIRROR_URL=https://mainnet-public.mirrornode.hedera.com` with the comment `# mainnet, read-only token data; payments still use MIRROR_NODE_URL (testnet)`.

Gate (if Playwright has no browser, run `pnpm exec playwright install chromium` once):

```
pnpm -r build
for d in packages/contracts packages/rails packages/trust apps/server apps/signer scripts/hedera; do pnpm -C "$d" test || exit 1; done
for d in packages/contracts packages/rails apps/server scripts/hedera; do pnpm -C "$d" typecheck || exit 1; done
pnpm smoke:compiled && pnpm test:browser
```

Tests in `apps/merchants` and `apps/web` may fail on this branch because of the registry change. Those belong to branches 2 and 4, so don't fix them here.

## Phase 4: commit and push

- Run `git status`. Confirm that only your paths changed, and revert tracked changes outside them. Leave untracked files you didn't create alone: don't delete them and don't commit them.
- Run `git add packages/contracts packages/rails apps/server apps/signer/test packages/trust/test scripts .env.example docs/production/production.env.example`.
- Commit with exactly the message `feat: token-check contracts, rails and server glue`. The message must have no `Co-Authored-By` trailer and no "Generated with Claude Code" line. If your tooling would add either, stop and give the human the exact `git commit` command instead.
- Run `git push -u origin branch-1`. Don't merge, and don't open a PR.

## Phase 5: integrate (runs after all four branches are pushed)

Run `git fetch origin`. Each branch must contain its final commit. Check them with:
- `git log origin/branch-2 --oneline --grep 'token-check merchants'`
- `git log origin/branch-3 --oneline --grep 'token-check brain prompts'`
- `git log origin/branch-4 --oneline --grep 'token-check web app'`

If any of those prints nothing, stop and print which branches are missing, followed by: "Say 'run phase 5' when they are pushed." Otherwise run:

```
git checkout -b integrate origin/main
git merge --no-ff origin/branch-1 -m "merge branch-1: contracts, rails, server"
git merge --no-ff origin/branch-2 -m "merge branch-2: merchants"
git merge --no-ff origin/branch-3 -m "merge branch-3: brain, evals, README"
git merge --no-ff origin/branch-4 -m "merge branch-4: web"
pnpm install --frozen-lockfile
pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm smoke:compiled && pnpm test:browser
```

The branches own disjoint paths, so there should be no conflicts. If `pnpm-lock.yaml` conflicts, take `origin/main`'s version and re-run install. During integration you may edit any path, but only to fix integration breakages.

**Cross-branch contract check.** Write a throwaway script outside the repo that imports `apps/merchants/dist/data.js` (`buildBody`, with `fixtureMode: true`) and `packages/rails/dist/validate.js` (`validateDelivery`). For each of `quickcast`, `groundtruth`, `hourlypro` and `gouger`, build the body for `{ tokenId: "0.0.731861" }` and validate it; every body must be valid. Then validate a body for `{ tokenId: "0.0.456858" }` built from fixtures; it must be invalid with `wrong token`. Fix whichever side breaks contract item 6. Don't commit the script.

**Track checklist.** Each of these must hold:
- **Hedera:** the browser journey pays for KeyScan with no approval card, and the policy tests still reject the gouger.
- **World:** HolderMap and TreasuryWatch purchases need approval, and a cancelled approval means no payment. The existing trust and server tests cover both.
- **0G:** `pnpm -C evals test` passes; it shows that a cheapest-first rule fails at least half the eval cases.
- **Copy:** `grep -rniE 'weather|forecast|open-meteo|umbrella' apps/*/src packages/*/src README.md` matches nothing in user-visible text, apart from the README's screenshot note.

If you fixed anything, commit it as `fix: integrate token-check pivot`, again with no AI attribution. Then STOP and print these commands for the human to run. Never push main yourself:

```
git checkout main && git pull --ff-only && git merge --ff-only integrate && git push origin main
```
