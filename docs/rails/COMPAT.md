# Compatibility contract (SPEC §4.2)

Observed in spike S1 on 2026-11-06 against Hedera testnet (HBAR), then confirmed with USDC in the rails e2e run the same day after AGENT was funded from the Circle faucet. Evidence: the settled payments in [PROOF.md](PROOF.md).

| Item | Planned value | Observed | Confirmed |
|---|---|---|---|
| x402 version | 2 | `x402Version: 2` in `PAYMENT-REQUIRED` and in the facilitator's `/supported` | ☑ |
| Network | `hedera:testnet` | `hedera:testnet` | ☑ |
| Asset | USDC `0.0.429274`, 6 decimals (fallback HBAR `0.0.0`, 8 decimals) | **Both settled.** HBAR `0.0.0` in spike S1. USDC `0.0.429274` in the e2e run (`0.0.9185802@1793984794.908601245`): the mirror node shows a token transfer of 10000 (0.01 USDC) from AGENT to quickcast and no HBAR moved between them. Before the faucet step, USDC had failed only at preflight with `insufficient_balance: payer holds 0 of 0.0.429274, needs 10000`. Default mode: `ASSET_MODE=usdc`. | ☑ HBAR / ☑ USDC |
| Facilitator | `https://x402.org/facilitator` | Same. It verified and settled the payment. | ☑ |
| Fee payer | `0.0.9185802`, cross-checked with `/supported` | `/supported` lists `extra.feePayer: 0.0.9185802` for `hedera:testnet`. The settled transaction's ID account is `0.0.9185802`, and it paid the 290413 tinybar network fee. | ☑ |
| Key type | ECDSA secp256k1 | All project accounts use ECDSA secp256k1 keys (`scripts/hedera/setup.ts`). The facilitator verified the payer signature against the onchain key. | ☑ |
| `@x402/core` version | exact pin | `2.30.0` | ☑ |
| `@x402/hedera` version | exact pin | `2.30.0` (depends on `@hiero-ledger/sdk` `2.90.1` and `@hiero-ledger/proto` `2.32.0`) | ☑ |
| `@hiero-ledger/sdk` version | exact pin | `2.90.1`. The workspace has a single install, shared with `@x402/hedera`. | ☑ |
| Settlement fields returned in `PAYMENT-RESPONSE` | record the real JSON | `{"success": true, "payer": "0.0.11341848", "transaction": "0.0.9185802@1793981706.678766160", "network": "hedera:testnet"}`. The optional `amount`, `extra` and `extensions` fields were not returned. | ☑ |
| Transaction ID readable from the signed bytes before submission | yes / no | **Yes.** `inspectHederaTransaction(payload.payload.transaction)` from `@x402/hedera` returns `transactionId` before the retry is sent. It equalled `PAYMENT-RESPONSE.transaction` exactly. The ID's account is the facilitator fee payer, not the agent. | ☑ |

## Wire details

- Header names (v2): `PAYMENT-REQUIRED` (on the 402), `PAYMENT-SIGNATURE` (client retry), `PAYMENT-RESPONSE` (on the 200). Each is base64 JSON. The SDK also knows the v1 names `X-PAYMENT` / `X-PAYMENT-RESPONSE`, which we don't use.
- The 402 body is ignored. Everything is in `PAYMENT-REQUIRED`.
- Decoded `PAYMENT-REQUIRED` from the spike:

```json
{
  "x402Version": 2,
  "resource": { "url": "http://127.0.0.1:4200/m/quickcast/forecast", "mimeType": "application/json" },
  "accepts": [{
    "scheme": "exact", "network": "hedera:testnet", "amount": "10000", "asset": "0.0.0",
    "payTo": "0.0.11341850", "maxTimeoutSeconds": 60, "extra": { "feePayer": "0.0.9185802" }
  }]
}
```

- The signed payload (`PAYMENT-SIGNATURE` → `payload.transaction`) is a base64 `TransferTransaction` with exactly two transfers: payer `-amount`, payTo `+amount`. Its transaction ID is `<feePayer>@<seconds>.<nanos>`.
- Mirror-node transaction ID form: `0.0.9185802-1793981706-678766160`.

## Facilitator failure reasons seen

| Reason (in verify response) | Cause |
|---|---|
| `invalid_exact_hedera_payload_preflight_failed` | Payer balance too low (`insufficient_balance: payer holds 0 of 0.0.429274, needs 10000`) |
| `invalid_exact_hedera_payload_signature_invalid` | Seen once with message `Mirror Node request failed with status 503`. The facilitator looks up the payer key on the mirror node, and that lookup failed. The same payment shape verified fine seconds later, so this is a **transient** facilitator-side error, not a bad signature. |
