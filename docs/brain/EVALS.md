# Brain evals: does 0G beat a dumb rule?

**Status: harness built and verified with a fake brain; the two real runs against the 0G Router have NOT been done (no `ZG_API_KEY` / `ZG_MODEL` in the environment).** Nothing below is evidence yet.

## Run it (twice) and paste the output into the tables below
```
# ZG_API_KEY, ZG_MODEL (chosen by packages/brain/scripts/spike.ts) in the repo-root .env
npx --prefix packages/brain tsx --env-file-if-exists=.env evals/run.ts
```
`EVAL_DRY=1 npx --prefix packages/brain tsx evals/run.ts` runs the same harness on the fake brain. It only proves the harness works; its scores mean nothing.

## What is measured
Six cases from SPEC §9.2 item 6 (`evals/cases.ts`). For each: `brain.plan` then `brain.decide` on the real Router, with quotes built from the contracts registry, **PriceGouger excluded** (policy rejects it before the AI sees it) and the demo budget of 0.20 USDC (case 6: 0.02, which fits only QuickCast). A case passes when the set of BUY merchants equals an accepted set.

| # | Question | Accepted BUY sets |
|---|---|---|
| 1 | Will it rain in Mumbai this week? | QuickCast |
| 2 | Is 6–8 am tomorrow good for a run in Bandra? | HourlyPro |
| 3 | Forecasts say dry but it looks cloudy, is it raining in Andheri right now? | GroundTruth |
| 4 | Plan an outdoor shoot Saturday 4–6 pm in Colaba | HourlyPro, or HourlyPro + QuickCast |
| 5 | Rough weekly outlook, keep it cheap | QuickCast |
| 6 | Same as 2, budget fits only QuickCast | QuickCast (the final answer should note the gap; that is synthesis, so it isn't scored here) |

**Baseline ("cheapest first until each need is covered").** It takes the number of needs from the *same* plan output, then buys the cheapest affordable quotes, one per need. It has no idea which merchant covers which need, which is the point: it represents a rule that only looks at price. With one need it always buys QuickCast, so it can only pass cases 1, 5 and 6; with two needs it buys QuickCast + GroundTruth, which matches no accepted set.

Scoring is exact set match on the BUY merchants after the brain's `postCheckDecisions`, so it matches what the orchestrator would see. Rationales are not scored.

## Run 1
_pending_

| # | 0G buys | 0G | Baseline buys | Baseline |
|---|---|---|---|---|

Totals: 0G _/6, baseline _/6. 0G cost: _. Request ids: _

## Run 2
_pending_

| # | 0G buys | 0G | Baseline buys | Baseline |
|---|---|---|---|---|

Totals: 0G _/6, baseline _/6. 0G cost: _. Request ids: _

Target: 0G >= 5/6 in both runs and strictly above the baseline.

## README summary (fill in the numbers after the runs)
> We tested whether the AI actually earns its place. On six weather questions where the right purchase differs (a weekly outlook, an hourly run window, a "is it raining right now" check, a photo shoot, a cheap outlook, and a tight budget), the 0G-powered agent picked the accepted set of data sources in **_ of 6** cases in each of two runs, against **_ of 6** for a simple "buy the cheapest source per need" rule. The baseline can't tell a daily forecast from live observations, so it fails exactly the questions that need a different source. Every decision above was made through 0G's private inference tier and carries a request ID. Total inference cost for a run was **_**.

## Suggested prompt changes
None yet: I have not seen real model output, so I won't guess. After the first real run, check these likely failure modes before touching prompts:
- Case 3 (is it raining *right now*) and case 2 (a 6–8 am window) depend on the model mapping the question's time scale to a capability (`current-observations`, `hourly-forecast-48h`). If it buys QuickCast there, add one line to `decide.v1`: "Match the question's time scale to a quote's capabilities; a daily forecast cannot answer an hourly or right-now question."
- Case 5 ("keep it cheap") may pull the model toward buying nothing. If so, state in `decide.v1` that buying nothing is only right when no quote fills a need.
- Case 4 expects HourlyPro with an optional QuickCast. If the model buys all three, tighten the "never buy two sources for the same need" rule, or check whether `plan.v1` produced redundant needs.
Any change goes through a follow-up brain prompt (bump `PROMPT_VERSION`).
