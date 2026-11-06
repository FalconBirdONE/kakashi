# Brain notes

## Prompt versions
`plan.v1`, `decide.v1`, `synthesize.v1` (see `packages/brain/src/prompts/`). Bump `PROMPT_VERSION` on any text change.

## Design
- `createBrain(env)` -> `createFunctions` -> `callStructured` (fail-closed client, see `src/client.ts`).
- decide's schema is built per call from the given quote IDs, so an unknown quoteId fails validation (B4).
- `postCheckDecisions` (defence in depth; trust enforces the real limits): drops unknown/duplicate quoteIds; if BUYs exceed the remaining budget or `purchasesRemaining`, keeps BUYs by `expectedUsefulness / price` and turns the rest into `SKIP` with `TOO_EXPENSIVE_FOR_VALUE` (kept, not deleted, so the UI can show them). Usefulness is compared at 1e-6 resolution.
- decide with zero quotes returns `SCHEMA_INVALID` without calling 0G; the orchestrator should not call it.
- synthesize sends no tools; evidence is wrapped in `<untrusted_data>` with wrapper tags neutralised inside the data; citations not in the evidence are filtered out.
- Prompts are built by explicit field picking, so stray fields on an input (e.g. merchant bodies) never reach the decide prompt.

## Live run (plan -> decide -> synthesize on the real Router)
**NOT DONE: no `ZG_API_KEY` / `ZG_MODEL` in the environment.** Run:

```
cd packages/brain && npx tsx --env-file-if-exists=../../.env scripts/manual.ts
```
It prints the three request IDs on success. Record them here:

| Step | zgRequestId | tee_verified |
|---|---|---|
| plan | _pending_ | |
| decide | _pending_ | |
| synthesize | _pending_ | |

`ZG_JSON_MODE=true` turns on `response_format: json_object`; it is off until the spike shows the chosen model supports it.
