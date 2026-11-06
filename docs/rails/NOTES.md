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

## Tooling

- pnpm is run as `npx -y pnpm@12.18.0 ...` when it isn't installed globally. Corepack is not bundled with Node 26.
