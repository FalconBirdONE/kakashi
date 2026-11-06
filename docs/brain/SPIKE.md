# Spike S2 — private, TEE-verified 0G call

**Status: run against the live Router on 2026-11-07. Passed after the parser fix in `src/client.ts` (reasoning before `</think>`).**

## Run

```
# ZG_API_KEY (and optionally ZG_BASE_URL) in the repo-root .env, or exported
cd packages/brain && npx tsx --env-file-if-exists=../../.env scripts/spike.ts
```
Exit 0 only if some TeeML model returned a `request_id`, `tee_verified: true` and parseable JSON. Exit 2 = no key. Exit 1 = no model passed.
The key is never printed.

## Results (fill in from the run)

| Model | Latency (ms) | request_id | provider | billing.total_cost | tee_verified | ZG-Res-Key | JSON parsed |
|---|---|---|---|---|---|---|---|
| 0gm-1.0-35b-a3b | 8107 | b0aba7c8-f7f9-4542-ad10-8e6d3fae1e9d | 0xf4FB8d2bD856e672b5f9848b0eD235A20079B250 | 131 (micro-USD) | null | 3a9c17be-3d33-4e8e-8376-f9342670d715 | yes |
| 0gm-1.0-35b-a3b-sia | 4952 | c5a8cd3f-7cce-4aaf-8e26-ccb2fc508730 | 0x15aDd680050Ecd0B25eb7d480e7BB1f48594Eabe | 751 (micro-USD) | **true** | 9828769d-37ce-4475-85b0-f52578321435 | yes (after `</think>`) |
| laya | - | - | - | - | - | - | 404 model_not_found |
| glm-5.3 (probe) | 7620 | f29fd213-409b-4b56-8c37-688a7d55bf27 | - | 338 (micro-USD) | null | - | yes |

**Chosen `ZG_MODEL`:** `0gm-1.0-35b-a3b-sia` — rule: fastest model with `tee_verified === true`, a `request_id`, and valid JSON.
A `503 no_provider_for_trust_mode` is printed explicitly; the Router never downgrades, so if every TeeML model 503s the fallback is `ZG_TRUST_MODE=verified`, set by hand and labelled in the UI (SPEC §9.2).

## Passing extra body fields and headers (openai 7.52.0, read from the installed types/source)

- **Extra body field (`verify_tee`)**: put it in the first argument. `chat.completions.create` sends `{ body, ...options }` as the request, and the body object is serialised whole, so unknown keys pass through. Cast to satisfy types:
  ```ts
  client.chat.completions.create(
    { model, messages, temperature: 0.2, verify_tee: true } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    { headers: { "X-0G-Provider-Trust-Mode": "private" } },
  )
  ```
  Do **not** use `options.body`: it comes after `body` in the spread and would replace the whole request body.
- **Per-request headers**: `options.headers` (plain object, `Headers`, or tuples). Can also be a client-wide `defaultHeaders`.
- **Raw headers**: `.withResponse()` on the returned `APIPromise` gives `{ data, response, request_id }`; use `response.headers.get("ZG-Res-Key")`. (`request_id` there is the SDK's `x-request-id`, not 0G's; the 0G ID is `data.x_0g_trace.request_id`.)
- **Trace**: `x_0g_trace` is not in the SDK types; read it with a cast.
- `maxRetries: 0` in the spike so a 503 is seen once; production code does its own two retries with 2 s backoff (SPEC §9.2).


**Billing note (2026-11-07):** `billing.total_cost` is reported in micro-USD and equals `total_cost_usd_micro`; the client converts it.
