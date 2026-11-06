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

## 4. Environment trust reads

| Variable | Notes |
|---|---|
| `WORLD_ISSUER` | Defaults to `https://auth.world.org` |
| `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET` | From `auth.world.org/portal`. Server-side only. Read on first World use, so trust boots without them |
| `WORLD_REQUIRED_ACR` | Optional. Full URI, e.g. `https://world.org/oidc/acr/orb` |
| `WORLD_REQUIRED_AMR` | Optional, **new**, comma list. Not yet in `.env.example`: add it there on merge |
| `PERMIT_SECRET` | 32 random bytes hex, shared with the signer |
| `DB_PATH` | Default `./data/tollbooth.sqlite` |
| `AGENT_ACCOUNT_ID` | Agent wallet, `0.0.x` |
| `MERCHANT_QUICKCAST_PAYTO`, `MERCHANT_HOURLYPRO_PAYTO`, `MERCHANT_GROUNDTRUTH_PAYTO`, `MERCHANT_GOUGER_PAYTO` | Exact payTo match (policy rule 3) |
| `FACILITATOR_FEEPAYER` | Default `0.0.9185802` |
| `USDC_TOKEN_ID` | Default `0.0.429274` |
| `ASSET_MODE` | `usdc` (default) or `hbar` |
| `HEDERA_NETWORK` | Default `hedera:testnet` |

## 5. Manual check against real World

`cd packages/trust && npx tsx --env-file-if-exists=../../.env scripts/world-manual.ts` runs activation then one purchase approval end to end on a scratch DB. Results go in `docs/trust/NOTES.md`.
