# Hedera testnet setup

Two scripts in `scripts/hedera` prepare every Hedera resource Tollbooth needs (SPEC §8.1). Both are safe to re-run.

## 1. Operator account (once, by hand)

1. Create a testnet account at https://portal.hedera.com. Choose **ECDSA**.
2. Fund it with HBAR from the portal faucet. Setup spends about 5 HBAR on account balances plus small fees.
3. Put the credentials in the repo-root `.env` (never commit it, never paste it into chat):

   ```
   HEDERA_OPERATOR_ID=0.0.xxxxx
   HEDERA_OPERATOR_KEY=<DER "302..." or hex "0x..." ECDSA key>
   ```

## 2. Run setup

```sh
pnpm --filter @tollbooth/hedera-scripts setup
```

It does the following, skipping anything that already exists:

- Creates ECDSA accounts `AGENT` and the four merchants (`QUICKCAST`, `HOURLYPRO`, `GROUNDTRUTH`, `GOUGER`), each with 1 HBAR and automatic token associations enabled.
- Associates each new account with USDC (`USDC_TOKEN_ID`, default `0.0.429274`).
- Creates the HCS audit topic. Only the operator key can submit to it.
- Reads `${FACILITATOR_URL}/supported` and prints the Hedera entries. It warns if the facilitator's fee payer differs from `FACILITATOR_FEEPAYER`.

Outputs:

| File | Contents |
|---|---|
| `.env.generated` (repo root) | Public IDs: `AGENT_ACCOUNT_ID`, `MERCHANT_*_PAYTO`, `HCS_TOPIC_ID`, observed `FACILITATOR_FEEPAYER` |
| `apps/signer/.env.local` | `AGENT_ACCOUNT_ID` and `AGENT_PRIVATE_KEY`. **The only place the agent key exists.** |

Both files are gitignored. Re-running setup reads them and reuses every ID. To replace an account, delete its line from `.env` and `.env.generated` and run setup again.

Merchant private keys are discarded after association, because merchants only receive payments.

## 3. Copy the IDs into `.env`

Copy the values from `.env.generated` into `.env`. Never copy `AGENT_PRIVATE_KEY` into `.env`: the server process must not see it.

## 4. Fund the agent with USDC

1. Open https://faucet.circle.com.
2. Choose network **Hedera Testnet**.
3. Paste the agent's **`0.0.x` account ID**, not an EVM address.

## 5. Check

```sh
pnpm --filter @tollbooth/hedera-scripts check
```

The check prints HBAR and USDC balances and USDC association for the operator, agent and merchants. It also prints the topic info and confirms the signer key matches the agent account. It exits 1 if anything required is missing. A zero agent USDC balance is only a warning. The mirror node lags by a few seconds, so re-run if setup just finished.

With `ASSET_MODE=hbar`, USDC association is not required.
