# Brain evals: does 0G beat a dumb rule?

**Status: live scores for the token cases are pending re-run (prompts plan.v3, decide.v2).**

## Run it (twice) and paste the output into the tables below
```
# ZG_API_KEY, ZG_MODEL (chosen by packages/brain/scripts/spike.ts) in the repo-root .env
npx --prefix packages/brain tsx --env-file-if-exists=.env evals/run.ts
```
`EVAL_DRY=1 npx --prefix packages/brain tsx evals/run.ts` runs the same harness on the fake brain. It only proves the harness works; its scores mean nothing.

## What is measured
Six token cases (`evals/cases.ts`). For each: `brain.plan` then `brain.decide` on the real Router, with quotes built from the contracts registry, **InsiderAlpha excluded** (policy rejects it before the AI sees it) and the demo budget of 0.20 USDC (case 6: 0.02, which fits only KeyScan). A case passes when the set of BUY merchants equals an accepted set.

| # | Question | Budget (atomic) | Accepted BUY sets |
|---|---|---|---|
| 1 | Should I put 20 USDC into SAUCE (0.0.731861)? | 200000 | KeyScan |
| 2 | I'm about to put 2,000 USDC into 0.0.731861. Is it safe? | 200000 | KeyScan + HolderMap + TreasuryWatch |
| 3 | Is the supply of DOVU (0.0.624505) concentrated in a few wallets? Planning 300 USD. | 200000 | HolderMap, or HolderMap + KeyScan |
| 4 | Is the team dumping GRELF (0.0.1159074)? I hold 1,000 USD of it. | 200000 | TreasuryWatch, or TreasuryWatch + KeyScan |
| 5 | Quick sanity check before a 5 USD trade of 0.0.4696266, keep it cheap | 200000 | KeyScan |
| 6 | I'm about to put 5,000 USDC into 0.0.731861. | 20000 | KeyScan (the budget only fits it; the final answer should note the gap, which is synthesis, so it isn't scored here) |

**Baseline ("cheapest first until each need is covered").** It takes the number of needs from the *same* plan output, then buys the cheapest affordable quotes, one per need. It has no idea which merchant covers which need, which is the point: it represents a rule that only looks at price. With one need it always buys KeyScan, so it can only pass cases 1, 5 and 6. `evals/cases.test.ts` asserts this offline: the fake brain's cheapest-first rule passes at most 3 of 6.

Scoring is exact set match on the BUY merchants after the brain's `postCheckDecisions`, so it matches what the orchestrator would see. Rationales are not scored.

## Token-case scores
Pending re-run. A live run on 2026-11-07 on `branch-3` gave no usable score: all six plan calls ended `SCHEMA_INVALID`, so no decide call ran. This is expected until branch 1 merges, because `planOutputSchema` in `packages/contracts` still requires lat/lon while `plan.v3` returns `tokenId` and `tradeUsd`. That run used `ZG_MODEL=glm-5.3` from `.env`, cost 0.047761 as reported, and its 0/6 says nothing about the model. Re-run twice after branch 1 merges, and record the model used.

## Earlier scores (v1 weather cases, plan.v2 and decide.v1; not comparable)
These runs used a different case set and merchant names. They are kept as a record of what the Router did, on 2026-11-07 with `ZG_MODEL=0gm-1.0-35b-a3b-sia`, `ZG_TRUST_MODE=private`, `ZG_VERIFY_TEE=true`. Every scored call returned `tee_verified: true`.

### Run 1
| # | 0G buys | 0G | Baseline buys | Baseline |
|---|---|---|---|---|
| 1 | quickcast | PASS | quickcast | PASS |
| 2 | quickcast | FAIL | quickcast | FAIL |
| 3 | groundtruth | PASS | quickcast | FAIL |
| 4 | hourlypro | PASS | quickcast | FAIL |
| 5 | decide failed: TIMEOUT (30 s) | FAIL | quickcast | PASS |
| 6 | quickcast | PASS | quickcast | PASS |

Totals: 0G 4/6, baseline 3/6. 0G cost: $0.021588. Request ids: 1 plan `b8032c34-58ec-41db-a985-ba73789f95e5`, 1 decide `f6e3f666-74ed-4c79-9db1-56f322f3d90a`, 2 plan `0bddd74d-e77b-4ba9-8e58-1f11b086dd4d`, 2 decide `f52f92f4-f22b-41b9-a27f-226681f64c35`, 3 plan `53a3758a-c459-4287-bdfe-dec734012aba`, 3 decide `b2f90f21-42d3-4ee1-9061-49ae9acadfda`, 4 plan `c3b188b5-f9d0-4a8c-8a39-570beb6731ae`, 4 decide `ab14ddb5-7864-4a26-b786-419cd557ccf4`, 5 plan `7c4c5580-b57d-4e59-97c2-44aeda8b15bf`, 6 plan `d8f1b042-6079-40ec-8d86-abd1526a18b6`, 6 decide `71f4aff9-07d1-427c-bcc0-a7aabae84fe9`.

### Run 2
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

## README summary
Fill in after the token-case runs. Until then the README says the live scores are pending and cites only the offline baseline test.
