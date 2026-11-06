# Spike S2 — private, TEE-verified 0G call

**Status: script written and typechecked; NOT yet run against the live Router (no `ZG_API_KEY` in this environment).**
The results table and chosen model below are to be filled by running the script.

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
| _pending_ | | | | | | | |

**Chosen `ZG_MODEL`:** _pending_ — rule: fastest model with `tee_verified === true`, a `request_id`, and valid JSON.
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
