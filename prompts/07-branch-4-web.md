# Branch 4: token-check web app and landing deck

You are implementing one quarter of a pivot of Kakashi, alone, on git branch `branch-4`. Three teammates are building the other quarters on `branch-1`, `branch-2` and `branch-3` at the same time. This file is your complete instruction set: where it conflicts with SPEC.md or any other file in `prompts/`, this file wins.

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

If that prints anything, run `git stash push -u -m "before branch-4"` and mention the stash in your final summary. Never drop it. If this machine has the earlier treasury-firewall homepage work, the stash keeps it; don't reuse that story. Then:

```
git fetch origin && git checkout -b branch-4 origin/main && pnpm install --frozen-lockfile && pnpm -r build
```

## Phase 1: web app (outside the landing deck)

**`apps/web/src/screens/ResearchScreen.tsx`**
- `EXAMPLES` becomes:
  - "Should I put 20 USDC into SAUCE (0.0.731861)?"
  - "I'm about to put 2,000 USDC into 0.0.731861. Is it safe?"
  - "Is the supply of DOVU (0.0.624505) concentrated? Planning 300 USD."
  - "Quick check before a 5 USD trade of 0.0.4696266"
- Change the heading and helper copy to "Check a token before you buy." Keep the textbox label `Your question` and the `Run` button.
- If the question contains neither `0.0.<digits>` nor one of SAUCE, USDC, DOVU or GRELF (case-insensitive), show "Add the token ID, for example 0.0.731861" and disable Run.

**Plan display:** where the plan's needs are rendered, also show `Token <id>`, linked to `https://hashscan.io/mainnet/token/<id>`, and `Trade <tradeUsd> USD`, whenever those fields are present. Use the loose cast from the rules above.

**Answer display:** if the answer starts with `**BUY**`, `**CAUTION**` or `**AVOID**`, show a coloured verdict badge in green, yellow or red. (cut if late)

**`apps/web/src/screens/MandateScreen.tsx`:** change the preferences placeholder to "e.g. Avoid tokens whose issuer can freeze or wipe balances".

**Other copy:** change any other user-visible weather copy under `apps/web/src`, outside `screens/landing` and `LandingScreen.tsx`, to token copy. Merchant names come from the registry, so leave them alone.

**Tests**
- In `ResearchScreen.test.tsx`:
  - Replace the literal `"QuickCast"` with the registry name for id `quickcast`.
  - Turn the fixture question and need into token ones.
  - New: the examples render.
  - New: the missing-token hint shows and Run is disabled.
  - New: a plan with `query: { tokenId: "0.0.731861", tradeUsd: 2000 }` renders a link to `https://hashscan.io/mainnet/token/0.0.731861`. Cast the fixture if the old type objects.
- Fix any other web test that breaks.

Gate: `pnpm -C apps/web build && pnpm -C apps/web test && pnpm -C apps/web typecheck`

## Phase 2: landing deck (copy and data only)

Keep every component, the layout, the animations and the presenter keys. The files are `apps/web/src/screens/LandingScreen.tsx`, `apps/web/src/screens/landing/Demos.tsx` and `apps/web/src/screens/landing/Flow.tsx`. These are hard-coded marketing strings, so writing the new merchant names literally is fine here. Do the work in this order:

1. **Intro example run** (the merchant rows near the top of `LandingScreen.tsx`):
   - Question: "I'm about to put 2,000 USDC into SAUCE (0.0.731861). Safe?"
   - Rows:
     - KeyScan, "Issuer keys and fees", 0.01, Buy.
     - HolderMap, "Wallets above 1% of supply", 0.03, "Buy · World ID approved".
     - TreasuryWatch, "Treasury selling and mints", 0.05, "Buy · World ID approved".
     - InsiderAlpha, "“Insider” calls", 0.50, "Blocked by policy".
   - Answer: "CAUTION. The issuer holds admin and supply keys and can mint more; 9 wallets each hold over 1%."
2. **Hero and problem slide:** the tagline is "Check a token before you buy it." The "why pay" paragraph from the top of this file goes in the problem slide.
3. **Three jobs slide:**
   - World decides who may spend.
   - 0G decides which checks this trade size justifies.
   - Hedera pays per check, proves it, and supplies the HTS-specific risks.
4. **0G slide (`Demos.tsx`):**
   - Use 3 questions with these AI picks:
     - "Should I put 20 USDC into SAUCE (0.0.731861)?": KeyScan only.
     - "I'm about to put 2,000 USDC into 0.0.731861. Is it safe?": KeyScan, HolderMap and TreasuryWatch.
     - "Is the team dumping GRELF (0.0.1159074)? I hold 1,000 USD of it.": TreasuryWatch.
   - The cheapest-first toggle buys only KeyScan every time.
   - Show live scores as "pending re-run".
   - The "what breaks without 0G" sentence is: "Without 0G, Kakashi can't tell which checks a trade is worth paying for (a cheapest-first rule buys KeyScan every time and misses whales and treasury dumps), and your token and trade size would go to an ordinary model provider in plaintext instead of sealed TEE inference that returns a trace ID for every decision."
5. **Live demo slide** (the timed script). Replace it with these steps, which use no demo faults:
   - 0:00: activate a mandate with World ID.
   - 0:35: "Should I put 20 USDC into 0.0.731861?" KeyScan is paid with no human, and InsiderAlpha is blocked by policy.
   - 1:10: "I'm about to put 2,000 USDC into 0.0.731861." The agent adds HolderMap and TreasuryWatch, and you approve the step-up with World ID.
   - 1:50: Ledger, showing the HashScan transaction, the HCS topic and the 0G trace.
   - 2:20: History, then "Run again", which is the reason to come back.

   Remove the DROP_AFTER_SETTLE and INJECT_TEXT steps from this script.
6. **Honest limits slide:** add "Checks read public Hedera mainnet data; what you pay for is the indexing and the judgment. Payments run on testnet. Merchants see only the token ID, never your trade size."
7. **(cut if late)** `Flow.tsx`: change the 8 walkthrough steps and wire blocks to token checks, for example `GET /m/quickcast/keys?tokenId=0.0.731861` returning `402` with `PAYMENT-REQUIRED`.
8. **(cut if late)** Attack lab slide: keep the six defences, but use the new merchant names. Examples: InsiderAlpha is overpriced; a token memo carries injected instructions; a check seller swaps its payTo.
9. Leave the Proof slide unchanged; its real transaction ids stay valid. Keep "Built at ETHGlobal Mumbai".

Update `apps/web/src/screens/LandingScreen.test.tsx` to the new text, and keep the World cancel test.

Gate: `pnpm -C apps/web build && pnpm -C apps/web test && pnpm -C apps/web typecheck`. Then run `grep -rniE 'weather|forecast|umbrella|rain in|bandra|open-meteo|QuickCast|HourlyPro|GroundTruth|PriceGouger' apps/web/src --include=*.tsx`. It must match nothing outside test files, except internal ids written in lower case.

## Phase 3: commit and push

- Run `git status`. Confirm that only `apps/web` changed, and revert tracked changes elsewhere. Leave untracked files you didn't create alone.
- Run `git add apps/web`.
- Commit with exactly the message `feat: token-check web app and landing deck`. The message must have no `Co-Authored-By` trailer and no "Generated with Claude Code" line. If your tooling would add either, stop and give the human the exact `git commit` command instead.
- Run `git push -u origin branch-4`. Don't merge, and don't open a PR.
- Print: "branch-4 pushed. Tell the branch-1 owner."
