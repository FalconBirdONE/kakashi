# Brain evals: does 0G beat a dumb rule?

**Status: run against the live 0G Router on 2026-11-07 with `ZG_MODEL=0gm-1.0-35b-a3b-sia`, `ZG_TRUST_MODE=private`, `ZG_VERIFY_TEE=true` (prompts plan.v2, decide.v1). Every scored call returned `tee_verified: true`. Target met in one of the two runs (4/6, 5/6); both runs beat the baseline.**

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
| # | 0G buys | 0G | Baseline buys | Baseline |
|---|---|---|---|---|
| 1 | quickcast | PASS | quickcast | PASS |
| 2 | quickcast | FAIL | quickcast | FAIL |
| 3 | groundtruth | PASS | quickcast | FAIL |
| 4 | hourlypro | PASS | quickcast | FAIL |
| 5 | decide failed: TIMEOUT (30 s) | FAIL | quickcast | PASS |
| 6 | quickcast | PASS | quickcast | PASS |

Totals: 0G 4/6, baseline 3/6. 0G cost: $0.021588. Request ids: 1 plan `b8032c34-58ec-41db-a985-ba73789f95e5`, 1 decide `f6e3f666-74ed-4c79-9db1-56f322f3d90a`, 2 plan `0bddd74d-e77b-4ba9-8e58-1f11b086dd4d`, 2 decide `f52f92f4-f22b-41b9-a27f-226681f64c35`, 3 plan `53a3758a-c459-4287-bdfe-dec734012aba`, 3 decide `b2f90f21-42d3-4ee1-9061-49ae9acadfda`, 4 plan `c3b188b5-f9d0-4a8c-8a39-570beb6731ae`, 4 decide `ab14ddb5-7864-4a26-b786-419cd557ccf4`, 5 plan `7c4c5580-b57d-4e59-97c2-44aeda8b15bf`, 6 plan `d8f1b042-6079-40ec-8d86-abd1526a18b6`, 6 decide `71f4aff9-07d1-427c-bcc0-a7aabae84fe9`.

## Run 2
| # | 0G buys | 0G | Baseline buys | Baseline |
|---|---|---|---|---|
| 1 | quickcast | PASS | quickcast | PASS |
| 2 | hourlypro | PASS | quickcast | FAIL |
| 3 | groundtruth | PASS | quickcast | FAIL |
| 4 | hourlypro + groundtruth | FAIL | quickcast + groundtruth | FAIL |
| 5 | quickcast | PASS | quickcast | PASS |
| 6 | quickcast | PASS | quickcast | PASS |

Totals: 0G 5/6, baseline 3/6. 0G cost: $0.032274. Request ids: 1 plan `188ad03f-7cf2-4380-97d2-036f98c4f101`, 1 decide `486133fc-407e-4f37-81ed-25e57e76a41b`, 2 plan `b15b4d21-465a-4540-9a69-16510ba56ce7`, 2 decide `b6e49d9d-4973-40b2-bc4d-60bec63beb54`, 3 plan `d5a956c5-b8ab-4efe-b64d-90790071cb60`, 3 decide `1156455d-b889-44ca-b9cc-df10067191c9`, 4 plan `51142e30-3163-4aa6-ac08-097d3b5c934f`, 4 decide `e7e94098-0f8d-4ac3-99ff-7ede0d18f649`, 5 plan `a267c126-1322-4ae9-8c8b-d60a4ca39528`, 5 decide `5ac9212f-dd4d-4b14-867c-d03de109740e`, 6 plan `b138573a-d42c-4dd3-b96f-28859becd62f`, 6 decide `d5469ec9-c6b7-462b-9eff-b41dcda0a456`.

Target: 0G >= 5/6 in both runs and strictly above the baseline. **Met in run 2 only.**

## Fixes needed before these runs (2026-11-07)
Three earlier live runs (6/6, 4/6, 2/6) exposed client bugs, now fixed in `packages/brain`:
- **Billing units.** The Router's `billing.total_cost` is micro-USD (it equals `total_cost_usd_micro`). The client read it as USD, so every call failed `BUDGET_EXCEEDED`. The client now prefers `total_cost_usd_micro` and divides by 10^6.
- **Reasoning in the answer.** `0gm-1.0-35b-a3b-sia` (the only chat model returning `tee_verified: true`) writes its reasoning before `</think>`, and sometimes omits the tag. The parser now reads what follows `</think>`, else the JSON object that ends the reply; the zod schema still validates it. Token limits were raised (plan 1500, decide and synthesize 2000) so reasoning does not crowd out the JSON.
- **No date in the plan prompt.** "Tomorrow" became 2024 dates or the literal `next-day`. `plan.v2` passes today's date (Asia/Kolkata).

Remaining failure modes: 30 s timeouts (SPEC §9.2 timeout, provider latency 5-25 s per call) and run-to-run variance on cases 2 and 4.

## README summary (fill in the numbers after the runs)
> We tested whether the AI actually earns its place. On six weather questions where the right purchase differs (a weekly outlook, an hourly run window, a "is it raining right now" check, a photo shoot, a cheap outlook, and a tight budget), the 0G-powered agent picked the accepted set of data sources in **4 and 5 of 6** cases in two runs, against **3 of 6** for a simple "buy the cheapest source per need" rule. The baseline can't tell a daily forecast from live observations, so it fails exactly the questions that need a different source. Every decision above was made through 0G's private inference tier and carries a request ID. Total inference cost for a run was **about $0.02-0.03**.

## Suggested prompt changes
None yet: I have not seen real model output, so I won't guess. After the first real run, check these likely failure modes before touching prompts:
- Case 3 (is it raining *right now*) and case 2 (a 6–8 am window) depend on the model mapping the question's time scale to a capability (`current-observations`, `hourly-forecast-48h`). If it buys QuickCast there, add one line to `decide.v1`: "Match the question's time scale to a quote's capabilities; a daily forecast cannot answer an hourly or right-now question."
- Case 5 ("keep it cheap") may pull the model toward buying nothing. If so, state in `decide.v1` that buying nothing is only right when no quote fills a need.
- Case 4 expects HourlyPro with an optional QuickCast. If the model buys all three, tighten the "never buy two sources for the same need" rule, or check whether `plan.v1` produced redundant needs.
Any change goes through a follow-up brain prompt (bump `PROMPT_VERSION`).
