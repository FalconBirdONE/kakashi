# Rails notes

Differences between SPEC/prompts and the installed SDKs, plus decisions made on the rails branch.

## `@hiero-ledger/sdk` 2.90.1

- `AccountCreateTransaction.setKey` is deprecated. Setup uses `setKeyWithoutAlias` (no EVM alias). `setECDSAKeyWithAlias` exists if an alias is ever needed.
- Token balances on `AccountBalanceQuery` are deprecated in favour of the mirror node. `check.ts` reads balances, associations, account keys and topic info from the mirror node REST API (`/api/v1/accounts/{id}`, `/api/v1/accounts/{id}/tokens`, `/api/v1/topics/{id}`).
- `PrivateKey.fromString` cannot tell raw-hex ECDSA from ED25519. Scripts parse keys with `fromStringDer` for DER (`302...`) and `fromStringECDSA` otherwise. ECDSA is assumed per SPEC §4.2.

## Setup decisions

- The operator pays all setup fees. The agent and merchant keys only co-sign their own `TokenAssociateTransaction`.
- The HCS topic has a submit key (the operator public key) and no admin key, so it can't be deleted or written by others.
- Merchant private keys are not stored. Merchants only receive, so the keys aren't needed after association.

## `@x402/core` / `@x402/hedera` 2.30.0 (spike S1)

- Names match SPEC §4.1: `x402Client` and `x402HTTPClient` (`@x402/core/client`), `x402ResourceServer` and `HTTPFacilitatorClient` (`@x402/core/server`), `createClientHederaSigner` (`@x402/hedera`), and `ExactHederaScheme` (`@x402/hedera/exact/client` and `/exact/server`).
- Header helpers live in `@x402/core/http`: `encodePaymentRequiredHeader`, `decodePaymentRequiredHeader`, `decodePaymentSignatureHeader`, `encodePaymentResponseHeader`, `decodePaymentResponseHeader`.
- Manual merchant flow: `buildPaymentRequirements({ scheme, network, payTo, price: { asset, amount }, maxTimeoutSeconds })`, then `createPaymentRequiredResponse(reqs, resource)` for the 402. After that: `findMatchingRequirements`, `verifyPayment`, `settlePayment`. Pass `price` as an atomic `{ asset, amount }`, so no money parser or default asset is involved.
- `x402ResourceServer.initialize()` must run before building requirements. It fetches `/supported`, which injects `extra.feePayer`.
- **Client spend controls:** by default `x402Client` only pays default assets (USDC on Hedera) up to `$1`. HBAR must be opted in with `spendControls.allowedAssets: [{ network: "hedera:testnet", asset: "0.0.0", maxAmountPerPayment: "<tinybars>" }]`.
- **Transaction ID before submission:** `inspectHederaTransaction(payload.payload.transaction)` decodes the signed bytes. There's no need to call `Transaction.fromBytes` directly. The ID's account is the facilitator fee payer.
- `@x402/hedera` re-exports SDK primitives (`PrivateKey`, `Client`, `TransferTransaction`, and others) to avoid duplicate SDK installs. This workspace resolves a single `@hiero-ledger/sdk@2.90.1`, so importing either works. Keep the pins aligned.
- The facilitator's verify step looks up the payer key on the mirror node. A mirror 503 surfaces as `invalid_exact_hedera_payload_signature_invalid`, which is transient. Rails must not treat that reason as proof of a bad signature.

## Tooling

- Run package binaries directly, for example `./node_modules/.bin/tsx setup.ts` in `scripts/hedera`. Running `npx pnpm@12.18.0 --filter ...` made pnpm self-install globally and edit `~/.zshrc`, so avoid it.

## Merchants service (prompt 1.3)

- Paths come from the frozen registry: `/m/quickcast/forecast`, `/m/hourlypro/forecast`, `/m/groundtruth/observations`, `/m/gouger/premium`. Prompt 1.3 says `/m/hourlypro/hourly`, but the registry wins.
- Query: `lat`, `lon` (required), and `startDate`, `endDate` (`YYYY-MM-DD`, optional). Anything else returns 400 before a quote is issued. `requestHash` uses the contracts `requestHash("GET", path, query)` over the exact query string values.
- Prices are the registry `priceAtomic` in the active asset: USDC units with `ASSET_MODE=usdc`, tinybars with `ASSET_MODE=hbar`.
- Body shape: `{ merchant, source: "open-meteo" | "fixture", location: { lat, lon, name }, window: { start, end }, generatedAt, units: "metric", fieldUnits, daily | hourly | current, note? }`. The contracts fake rails uses `window: { startDate, endDate }` instead. `validateDelivery` (prompt 1.5) checks the real shape.
- Idempotency: a paid retry is verified with the facilitator first, which authenticates the payer. If the same payer and `requestHash` settled within 10 minutes, the cached body and the original `PAYMENT-RESPONSE` are returned and the new signed transaction is never submitted. Verified live: the replay of `0.0.9185802@1793982021.177130660` left one transfer on the mirror node.
- Every 402 records `requestHash -> query` in `merchants.sqlite`. That lets `/recover` regenerate a body from a mirror-node confirmation when the settlement row is missing.
- `GET /recover?tx=&requestHash=[&merchant=]` returns the body JSON directly (200) or 404.
- `/admin/fault` returns 404 unless `DEMO_MODE=true`. `SWAP_PAYTO` advertises `HEDERA_OPERATOR_ID`.
- Fixtures in `apps/merchants/fixtures` are real Open-Meteo responses for Mumbai, recorded 2026-11-06. They're used with `FIXTURE_MODE=true` or when Open-Meteo fails or takes longer than 5 s.

## Signer (prompt 1.4)

- `apps/signer` reads `apps/signer/.env.local`, then the process env. It never reads the root `.env`. Required: `AGENT_ACCOUNT_ID`, `AGENT_PRIVATE_KEY` (written by setup), `PERMIT_SECRET` (the same value trust uses), `SIGNER_MAX_PER_TX_ATOMIC` and `SIGNER_MAX_TOTAL_ATOMIC`. Add the last three to `.env.local` by hand.
- It binds `127.0.0.1:4100` (`SIGNER_PORT`). Any other `SIGNER_HOST` makes it refuse to start.
- `POST /sign {permit, requirementsB64}` returns `200 {paymentHeader, hederaTxId}`, or `403 {error: "SIGNER_REFUSED", reason}`. `paymentHeader` is the value for the `PAYMENT-SIGNATURE` request header. Malformed bodies return `400`, bodies over 32 KB return `413` (both `reason: "BAD_REQUEST"`), and every other route returns `404`.
- Refusal reasons: `BAD_MAC`, `EXPIRED`, `NOT_YET_VALID`, `PERMIT_REUSED`, `BAD_REQUIREMENTS`, `NETWORK_MISMATCH`, `ASSET_MISMATCH`, `AMOUNT_MISMATCH`, `PAYTO_MISMATCH`, `FEEPAYER_MISMATCH`, `OVER_PER_TX_CEILING`, `OVER_TOTAL_CEILING`, `SIGNED_TX_MISMATCH`, `SIGNING_FAILED`, `BAD_REQUEST`.
- Single use: any permit with a valid MAC is burned in `signer.sqlite` on first presentation, even if it's refused. Permits with a bad MAC are not recorded, so nobody can burn another party's permit.
- The total ceiling counts permits in `SIGNING` and `SIGNED` state. A signing exception moves the permit to `FAILED` and releases its amount. The check and insert run in one synchronous SQLite transaction (tested with 10 concurrent permits against a ceiling that fits 3).
- After signing, the signer decodes its own bytes and requires exactly two transfers in the permit asset (agent `-amount`, payTo `+amount`), no other assets, no other operations, and the fee payer as the transaction ID account. Otherwise it refuses with `SIGNED_TX_MISMATCH`.
- The x402 client's own spend controls are turned off inside the signer (`spendControls: false`), because the permit match and the ceilings replace them.
- Logs carry only permitId, purchaseId, decision, reason and tx ID.
- Live check (`REAL_HEDERA=1`): `0.0.9185802@1793982220.036767062` paid quickcast 10000 tinybars. The mirror node shows `SUCCESS`.
