# Branch 2: token-check merchants on real mainnet data

You are implementing one quarter of a pivot of Kakashi, alone, on git branch `branch-2`. Three teammates are building the other quarters on `branch-1`, `branch-3` and `branch-4` at the same time. This file is your complete instruction set: where it conflicts with SPEC.md or any other file in `prompts/`, this file wins.

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

If that prints anything, run `git stash push -u -m "before branch-2"` and mention the stash in your final summary. Never drop it. Then:

```
git fetch origin && git checkout -b branch-2 origin/main && pnpm install --frozen-lockfile && pnpm -r build
```

**On this branch, the registry paths are still `/m/<id>/forecast`.** Merchant routes come from `MERCHANT_REGISTRY`, so in tests always build URLs from `MERCHANT_REGISTRY.find((m) => m.id === "quickcast")!.path`, never from a literal path.

## Phase 1: config and pure analysis

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
- `holderStats(totalSupply: string, treasury: string, balances: {account: string; balance: number | string}[])` returns the `holders` object from contract item 6. Sort whales by balance, largest first.
  - Do all the arithmetic in BigInt. Compute `pct = Number(balance * 10000n / supply) / 100`.
- `treasuryStats(tokenId, treasury, transactions)` returns the `treasury` object from contract item 6.
  - Count only `token_transfers` entries for this `tokenId`.
  - Outflows are negative treasury amounts outside `TOKENMINT` and `TOKENBURN`.
  - `to` is the account in the same transaction with the matching positive amount.
- `holderFlags` and `treasuryFlags`, for example:
  - `WHALES: 9 wallets each hold over 1% (62.4% together)`
  - `TREASURY_SELLING: 12 outflows in the last 100 transactions`
  - `RECENT_MINTS: 3 mints in the last 100 transactions`

**Fixtures.** Record real SAUCE responses with curl into these files, then delete `daily.json`, `hourly.json` and `current.json`:
- `apps/merchants/fixtures/token.json` from `GET https://mainnet-public.mirrornode.hedera.com/api/v1/tokens/0.0.731861`
- `apps/merchants/fixtures/holders.json` from `GET .../api/v1/tokens/0.0.731861/balances?account.balance=gt:<total_supply/100>&limit=100`
- `apps/merchants/fixtures/treasury.json` from `GET .../api/v1/transactions?account.id=0.0.1077627&limit=100&order=desc`

**Tests**: new `apps/merchants/test/analysis.test.ts`:
- `keyFlags` on the SAUCE fixture gives ADMIN_KEY and SUPPLY_KEY, and no WIPE_KEY or FREEZE_KEY.
- A USDC-like token gives FREEZE_KEY.
- A token with no keys gives only NO_ADMIN_KEYS.
- A fractional fee gives CUSTOM_FEES.
- `holderStats` with DOVU's supply `15924365595423638` and one balance of exactly a quarter of it gives `pct` exactly 25, with no precision loss. `treasurySharePct` is correct.
- `treasuryStats` counts TOKENMINT and negative treasury transfers of this token, and ignores other tokens' transfers.

Gate: `pnpm -C apps/merchants test -- analysis`

## Phase 2: data and app

**`apps/merchants/src/data.ts`**: replace Open-Meteo with mirror node calls, each with a 5 s timeout, against `tokenMirrorUrl`:
- Token info: `GET /api/v1/tokens/{tokenId}`
- Holders: `GET /api/v1/tokens/{tokenId}/balances?account.balance=gt:{totalSupply/100n}&limit=100`
- Treasury: `GET /api/v1/transactions?account.id={treasury}&limit=100&order=desc`

Bodies follow contract item 6 exactly:
- `quickcast` and `gouger` return `token` and the `keyFlags` result.
- `groundtruth` returns `holders` and the `holderFlags` result.
- `hourlypro` returns `treasury` and the `treasuryFlags` result.
- Drop `location`, `window`, `units` and `fieldUnits`.

Errors and fallbacks:
- If the token lookup returns 404, return the NOT_FOUND body.
- If any fetch fails for a network or 5xx reason, or `fixtureMode` is on, use the fixtures with `tokenId: "0.0.731861"`. Never relabel fixture data as another token. Reword the existing shortcut comment to match.

Other changes in this module:
- `querySchema` becomes `z.object({ tokenId: z.string().regex(/^0\.0\.\d{1,10}$/) })`. Keep it non-strict so extra keys, such as `run`, still pass.
- Keep the faults: `STALE_DATA` ages `generatedAt` by 2 days, and `INJECT_TEXT` adds `note: INJECTED_NOTE`. Leave the `INJECTED_NOTE` constant unchanged; it is the test payload for the prompt-injection defence.

**`apps/merchants/src/app.ts`**: the 400 message becomes `invalid query: expected tokenId (0.0.N)`. Nothing else changes; routes still come from the registry.

**Tests**: update `apps/merchants/test/merchants.test.ts`:
- `QUERY = { tokenId: "0.0.731861" }`. Add `tokenMirrorUrl: "http://mainnet-mirror.test"` to `baseConfig`. Every URL comes from the registry path.
- A missing tokenId, `SAUCE` and `0.0.x` each get a 400.
- Every existing 402, settle, idempotency, recover and fault test passes with the new query.
- Live mode (`fixtureMode: false`) with a mocked fetch:
  - It calls exactly the 3 mainnet URLs on `tokenMirrorUrl`, with the `account.balance=gt:` threshold equal to supply/100.
  - No token-data request goes to `mirrorUrl`.
  - A 404 token gives the NOT_FOUND body.
  - A network failure gives a fixture body with tokenId `0.0.731861`.
- The body shape matches contract item 6 for every merchant id.

Gate: `pnpm -C apps/merchants build && pnpm -C apps/merchants test && pnpm -C apps/merchants typecheck`

## Phase 3: live smoke on real mainnet data (cut if late)

Write a throwaway script outside the repo that imports the built `apps/merchants/dist/data.js` and calls `buildBody` with `fixtureMode: false` and the real `fetch` for `0.0.731861`, `0.0.456858` and `0.0.624505`. Print the flags. Expected results:
- USDC shows FREEZE_KEY.
- SAUCE shows ADMIN_KEY and SUPPLY_KEY, and has at least 1 whale.
- DOVU's pct values are finite.

If mainnet is unreachable, note that and carry on. Don't commit the script.

## Phase 4: commit and push

- Run `git status`. Confirm that only `apps/merchants` changed, and revert tracked changes elsewhere. Leave untracked files you didn't create alone.
- Run `git add apps/merchants`.
- Commit with exactly the message `feat: token-check merchants on mainnet mirror data`. The message must have no `Co-Authored-By` trailer and no "Generated with Claude Code" line. If your tooling would add either, stop and give the human the exact `git commit` command instead.
- Run `git push -u origin branch-2`. Don't merge, and don't open a PR.
- Print: "branch-2 pushed. Tell the branch-1 owner."
