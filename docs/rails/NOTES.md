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
