# Trust -> app handover: World ID flows

How the server (app branch) drives World ID Agent Pass through `@tollbooth/trust`. Everything World-related happens server-side: the browser never sees the client secret, the `device_code`, any token or `sub`. Trust validates the ID token (JWKS signature, `iss`, `aud`, `exp`, fresh `auth_time`, optional `acr`/`amr`, `(iss, sub)` binding) before anything is approved. SPEC §8.2, §8.4, §11.3.

```ts
import { createTrust } from "@tollbooth/trust";
const trust = createTrust(process.env); // tests: createTrust(env, { world: fakeWorldClient })
```

All three World functions are on the `Trust` interface (`packages/contracts/src/interfaces.ts`):
`startAuth(userId, purpose, targetId)`, `pollAuth(attemptId)`, `getPermitForPurchase(purchaseId)`. Each returns or carries an `AuthAttemptPublic` (`id, purpose, targetId, startedAt, expiresAt, result, verificationUri, userCode`), which is safe to send to the browser as is.

## 1. Mandate activation (SPEC §8.2)

1. User submits the mandate form -> `trust.createMandateDraft(userId, draft)`. Show the summary card (wallet, budget, caps, merchants, expiry, short code = first 6 hex chars of `mandateHash`).
2. `POST /api/mandates/:id/activate` -> `trust.startAuth(userId, "ACTIVATE_MANDATE", mandateId)`. Return the attempt; the UI shows `verificationUri` and `userCode` ("open this link, enter this code, approve in World"). `verificationUri` is World's `verification_uri_complete` when World sends one, so the link may already contain the code. The mandate is now `PENDING_APPROVAL`. Starting a new attempt for the same target marks the older pending one `SUPERSEDED`.
   `startAuth` throws `AUTH_TARGET_INVALID: ...` for a bad target (unknown, another user's, wrong state, expired): answer 4xx. It also throws if World cannot start the device flow (including missing `WORLD_CLIENT_ID` / `WORLD_CLIENT_SECRET`): answer 502/503 and show "World is unavailable, try again".
3. The browser polls `GET /api/auth-attempts/:id` every 1-2 s. The handler calls `trust.pollAuth(id)` and returns the attempt. Trust paces the real World token-endpoint calls itself (it honours World's `interval` and `slow_down`), so calling `pollAuth` every 1-2 s is safe: between paced polls it just returns the stored attempt.
4. `result === "VERIFIED"`: the mandate is already `ACTIVE` (approval recorded and consumed, audit event queued, all in one transaction). Refetch with `trust.getActiveMandate(userId)` and show it.
5. Any other terminal result: the mandate goes back to `DRAFT` (non-active, no run can spend) and the user can retry activation. Show the failure copy below.
6. Keep polling until the result leaves `PENDING`. Expiry is detected inside `pollAuth`, so an attempt nobody polls stays `PENDING` in the DB.

## 2. Purchase step-up approval (SPEC §8.4 step 3)

1. `trust.authorize(purchaseId)` returns `NEEDS_APPROVAL` when the amount is above `autoApproveCap`. The purchase is `AWAITING_APPROVAL` and its amount is reserved.
2. Show the purchase card (merchant, amount, recipient, short code from `purchaseHash`). "Approve with World ID" -> `trust.startAuth(userId, "APPROVE_PURCHASE", purchaseId)`.
3. Poll exactly as in activation (`GET /api/auth-attempts/:id` -> `trust.pollAuth`).
4. When `pollAuth` returns `VERIFIED`, call `trust.getPermitForPurchase(purchaseId)` **exactly once**. It returns the permit the first time and `null` after that. The permit expires 60 s after issue, so pass it straight to `rails.signPayment(permit, quote.rawRequirements)`, then continue §8.4 step 5 (`transition(SIGNED, { hederaTxId })` before submitting).
5. `null` right after `VERIFIED` means trust refused to issue the permit even though World verified the human (for example the quote changed, the approval expired, or the mandate is no longer active). Refetch the purchase (`trust.getRunView(runId)`): it is `APPROVAL_DENIED` and the reservation is released. Show it as not approved; never retry signing.
6. Any non-`VERIFIED` terminal result: the purchase becomes `APPROVAL_DENIED`, the reservation is released, no payment is signed. The approval attempt expires after at most 5 minutes; as with activation, that only takes effect on the next `pollAuth`, so keep polling (or have the worker poll) until it is terminal.

Notes:
- **Held permits live in memory** in the trust instance and are lost on restart. After a restart a `RESERVED` purchase whose permit was never collected cannot be signed; treat it as failed. Use one long-lived `createTrust` instance per server process.
- The quote's 60 s `localExpiresAt` is checked by `authorize`, not after approval; the human has the 5 minute approval window.
- `issuePermitAfterApproval` (exported from `src/authorize.ts`) is **internal**: trust calls it from `pollAuth`. The app must not call it.

## 3. Results and what the UI shows

| `result` | Meaning | UI copy (suggested) |
|---|---|---|
| `PENDING` | Waiting for the human in World | "Waiting for approval in World..." with link and code |
| `VERIFIED` | Token validated, approval recorded | Activation: "Mandate active." Purchase: "Approved. Paying..." |
| `DENIED` | Human declined in World | "Approval declined in World. Nothing was activated / paid." |
| `CANCELLED` | Human cancelled (only if World reports a distinct cancel code; may never appear, see SPIKE.md) | "Approval cancelled. Nothing was activated / paid." |
| `EXPIRED` | Code expired before approval | "The code expired. Start again." |
| `IDENTITY_MISMATCH` | A different World identity than the one linked to this user | "This is not the World ID linked to this account. Nothing was activated / paid." |
| `ERROR` | Token invalid (signature, issuer, audience, stale `auth_time`, `acr`/`amr` not met), World/network error, or the target changed while the human was approving | "World verification failed. Nothing was activated / paid." |
| `SUPERSEDED` | A newer attempt for the same target replaced this one | Switch to the newer attempt |

Every failure state must say that the protected action did **not** happen (that is World's required failure path, SPEC §2.2). Show the failure path in the video.

**Claim wording (SPEC §8.2, §11.3).** Say: *"World authenticates the human. Tollbooth records that human's approval of one specific mandate version"* (or "of one specific purchase"). Also say: "World proofs are mocked for this event." **Never** say the user signed, or cryptographically signed, the payment: the agent's key signs; World only authenticates the approving human.

## 4. Environment variables

Trust reads these from the `env` object passed to `createTrust(env)` (normally `process.env`). Nothing is validated at boot: each variable is read when the code that needs it first runs.

| Variable | Required? | Secret? | Read by / behaviour when missing |
|---|---|---|---|
| `PERMIT_SECRET` | **Required** to authorize | **Yes** (shared with the signer only) | 32 random bytes as 64 hex chars. `authorize` and post-approval permit issue throw `PERMIT_SECRET not set` if it is missing or malformed |
| `AGENT_ACCOUNT_ID` | **Required** to create a mandate | No | Agent wallet `0.0.x`. `createMandateDraft` throws `AGENT_ACCOUNT_ID not set` |
| `MERCHANT_QUICKCAST_PAYTO`, `MERCHANT_HOURLYPRO_PAYTO`, `MERCHANT_GROUNDTRUTH_PAYTO`, `MERCHANT_GOUGER_PAYTO` | **Required** per merchant you want to buy from | No | Exact payTo match (policy rule 3). Missing or empty fails closed: every quote from that merchant gets `RECIPIENT_MISMATCH` |
| `WORLD_CLIENT_ID` | **Required** for World | Server-side only | From `auth.world.org/portal`. Read on first World use, so trust boots without it; `startAuth` then throws |
| `WORLD_CLIENT_SECRET` | **Required** for World | **Yes** | As above. Never sent to the browser or logged |
| `WORLD_ISSUER` | Defaulted | No | Default `https://auth.world.org`. Unset or empty (as in `.env.example`, `WORLD_ISSUER=`) both use the default |
| `WORLD_REQUIRED_ACR` | Optional | No | Full URI, e.g. `https://world.org/oidc/acr/orb`. Empty means no check |
| `WORLD_REQUIRED_AMR` | Optional, **new** | No | Comma list; every listed method must be in the token's `amr`. Not yet in `.env.example`: add it there on merge |
| `DB_PATH` | Defaulted | No | Default `./data/tollbooth.sqlite` (see Database) |
| `FACILITATOR_FEEPAYER` | Defaulted | No | Default `0.0.9185802`. Policy rule: quote `feePayer` must equal it |
| `USDC_TOKEN_ID` | Defaulted | No | Default `0.0.429274`. Mandate asset and policy asset in `usdc` mode |
| `ASSET_MODE` | Defaulted | No | `usdc` (default) or `hbar` (asset `0.0.0`, 8 decimals) |
| `HEDERA_NETWORK` | Defaulted | No | Default `hedera:testnet`. Mandate network and policy network |

Except `WORLD_ISSUER`, defaulted variables use `??`, so only an unset variable gets the default; an empty string is taken literally. The values `.env.example` ships for `DB_PATH`, `FACILITATOR_FEEPAYER`, `USDC_TOKEN_ID`, `ASSET_MODE` and `HEDERA_NETWORK` are non-empty, so this is fine.

## 5. Database

- **Location:** `DB_PATH`, default `./data/tollbooth.sqlite`, **relative to the server process's working directory** (not to this package). Missing parent directories are created. Run the server from the same directory every time or set an absolute `DB_PATH`.
- **Files:** SQLite runs in WAL mode, so next to the main file you will see `tollbooth.sqlite-wal` and `tollbooth.sqlite-shm`. All three belong together. Foreign keys are on; `busy_timeout` is 5 s.
- **Migrations:** numbered, append-only, applied automatically when the DB is opened (`schema_migrations` records what ran). Never edit an applied migration; add a new one.
  1. Base schema: `users`, `world_identities` (one `(iss, sub)` per user), `agents`, `mandates` (one row per `(id, version)`, money as TEXT atomic strings, `spent`/`reserved` counters, unique index for one `ACTIVE` mandate per user), `user_preferences`, `auth_attempts`, `approvals`, `runs` (pinned to a mandate version), `quotes`, `purchases` (unique per `(run, quote)`), `inference_calls`, `audit_events` (the outbox).
  2. `purchases.amount`: the amount pinned at proposal, so budget releases match what was reserved.
  3. `auth_attempts.target_id`, `interval_seconds`, `next_poll_at`: what an attempt targets and server-side World poll pacing.
- **Personal data lives only here:** question text (`runs`), preferences (`user_preferences`) and the World `sub` (`world_identities`, `auth_attempts`). None of it goes into audit events.

## 6. Reset the demo DB

1. Stop the server (and anything else holding the DB open).
2. Delete the SQLite file **and** its `-wal` and `-shm` files, e.g. from the server's working directory: `rm -f data/tollbooth.sqlite data/tollbooth.sqlite-wal data/tollbooth.sqlite-shm`.
3. Restart. The schema is recreated by the migrations on open.

Never delete the files while the server is running: the open connection keeps writing to the old (unlinked) files and the WAL, and you end up with a half-reset or corrupt DB. A reset also drops the World identity link, so the next activation links whichever World ID approves first.

## 7. Audit outbox (SPEC §8.6)

**Writing.** `appendAuditEvent` is internal and runs **inside the same transaction** as the state change it describes (it throws if called outside one), so an event exists if and only if its change committed. Events and where they are emitted:

| Event | Emitted by | Payload fields |
|---|---|---|
| `MANDATE_ACTIVATED` | `pollAuth`, `VERIFIED` activation | `mandateHash` |
| `MANDATE_REVOKED` | `revokeMandate` (only if something was actually revoked) | `mandateHash` |
| `PURCHASE_DECIDED` | `authorize`, for every outcome (permit, needs approval, rejected) | `run, pur, mandateHash, quoteHash, decisionHash, zg?` |
| `APPROVAL_GRANTED` | `pollAuth`, `VERIFIED` purchase approval that issued a permit | `run, pur, mandateHash, quoteHash` |
| `APPROVAL_DENIED` | `pollAuth`, failed purchase approval, or verified but refused (quote changed, approval expired, mandate inactive) | `run, pur, mandateHash, quoteHash` |
| `PURCHASE_CONFIRMED` | `transition(..., "CONFIRMED")` | `run, pur, mandateHash, quoteHash, tx, zg?` |
| `PURCHASE_FAILED` | `transition(..., "FAILED_FINAL")` | `run, pur, mandateHash, quoteHash, tx?` |
| `DELIVERY_RESULT` | `setDelivery` (one event per call) | `run, pur, tx?` |
| `RUN_COMPLETED` | `updateRun` when `state` first becomes `DONE`, `PARTIAL` or `FAILED` | `run` |

Every payload also has `v: 1`, `type`, `id` (`evt_...`), `prev` (previous event's hash) and `ts`. `DELIVERY_RESULT` carries **no delivery-state field**, because the contracts' `AuditPayload` has none; the delivery state itself is in the DB (`getRunView`).

**Payload rules.** Only the fields above are accepted, each checked against a strict format (`run_`/`pur_` ids, 64-hex hashes, `tx` as `0.0.x@seconds.nanos`, `zg` as 1-128 chars of `[A-Za-z0-9._:-]`). Anything else (question, preferences, `sub`, `iss`, tokens) is refused with `AUDIT_PAYLOAD_REJECTED`, as is a canonical payload over **1 KB**. Because a rejected event would roll back the payment state change, `tx` and `zg` are validated where they are first stored: `transition` throws `INVALID_TX_ID` and `recordInference` throws `INVALID_ZG_REQUEST_ID` before writing anything.

**Hash chain.** `hash = sha256Hex(canonicalJson({ prevHash, type, payload, id }))`; the first event's `prevHash` is 64 zeros. `prevHash` is stored as a column and repeated in `payload.prev`. `verifyAuditChain(ctx)` (exported from `@tollbooth/trust`, not on the `Trust` interface) recomputes every hash in `seq` order and checks both links; it returns `{ ok: true, count }` or `{ ok: false, brokenAtSeq }`.

**Worker (app runs it, rails publishes).** Every 2 s:
1. `trust.listPendingAudit(10)`: due `PENDING`/`RETRYING` events in `seq` (chain) order. `limit` is clamped to 1..100. An event in backoff is not due.
2. For each: `rails.publishAudit({ id: e.id, json: canonicalJson(e.payload) })`.
3. Success: `trust.markAnchored(e.id, { topicId, sequenceNumber, consensusTimestamp })`. Idempotent for the same receipt; a different receipt for an already anchored event throws `AUDIT_ALREADY_ANCHORED`.
4. Failure: `trust.markAuditRetry(e.id)`. Backoff after the n-th failure is `min(60, 2^(n-1))` seconds (1, 2, 4, ... capped at 60). No-op on an anchored event.

Show payment status and audit status separately ("Payment confirmed · Audit anchoring pending").

## 8. Manual check against real World

`cd packages/trust && npx tsx --env-file-if-exists=../../.env scripts/world-manual.ts` runs activation then one purchase approval end to end on a scratch DB. Results go in `docs/trust/NOTES.md`.

## 9. Known limitations

- **Held permits are in memory.** A permit issued after a World approval waits in the trust instance until `getPermitForPurchase` collects it and is lost on restart. `listUnresolved` only returns `SIGNED`, `SUBMITTED` and `UNKNOWN`, so a `RESERVED` purchase whose permit was lost (or expired unsigned) is not picked up by reconciliation: the app must sweep stale `RESERVED` purchases to `FAILED_FINAL` itself (that transition releases the reservation).
- **Approval expiry is only detected when `pollAuth` runs.** An attempt nobody polls stays `PENDING`, and its purchase stays `AWAITING_APPROVAL` with the amount reserved. The app must keep polling until the attempt is terminal, or sweep (`pollAuth` on open attempts, or `transition(id, "APPROVAL_DENIED")` for purchases whose approval was never started).
- **Mandate re-versioning.** Activating a new version copies the old version's `spent`/`reserved` and retires the old row (state `REVOKED`, with a `MANDATE_REVOKED` event per retired row). Purchases already in flight stay pinned to the old row, so their later spend or release lands on the retired row, not on the new active one.
- **No dedicated reason code for a changed quote.** `PolicyReason` has no `QUOTE_CHANGED`; `authorize` reports a quote whose hash changed as `QUOTE_EXPIRED`. (After an approval the internal denial reason is `QUOTE_CHANGED`, but it only appears in logs.)
- **Precheck results are not stored.** `precheck` has no side effects, so `quotes.policyResult` stays empty; `authorize` stores its own result on the purchase.
- **Precheck after propose flags itself.** `precheck` counts every live purchase with the same request hash, including the one just proposed for this quote, so calling it after `proposePurchase` returns `DUPLICATE_REQUEST`. Call it before proposing (as §8.3 does).
- **World behaviour not yet confirmed live.** Whether World distinguishes deny from cancel (`DENIED` vs `CANCELLED`) and which `acr`/`amr` values real tokens carry are unverified; the manual World run is pending credentials (see `NOTES.md`, `SPIKE.md`).
- **Concurrency test tooling.** The T5 concurrent-authorize test runs real worker threads with `--import tsx`; it depends on `tsx` being installed and resolvable from the workers.
- **HCS order can differ from chain order.** With retry backoff, a later event can anchor before an earlier failed one, so HCS sequence numbers need not follow `seq`. The `prev` hashes in each payload still let anyone rebuild and verify the chain.
