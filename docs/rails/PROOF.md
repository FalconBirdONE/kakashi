# Proof of payment

First settled x402 payment on Hedera testnet (spike S1, 2026-11-06).

| Field | Value |
|---|---|
| Transaction ID | `0.0.9185802@1793981706.678766160` |
| HashScan | https://hashscan.io/testnet/transaction/0.0.9185802@1793981706.678766160 |
| Mirror node | https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.9185802-1793981706-678766160 |
| Result | `SUCCESS` (`CRYPTOTRANSFER`), consensus timestamp `1793981715.838132104` |
| Asset | HBAR (`0.0.0`), the `ASSET_MODE=hbar` fallback |
| Amount | 10000 tinybars (0.0001 HBAR) |
| Payer (AGENT) | `0.0.11341848` |
| Recipient (quickcast `payTo`) | `0.0.11341850` |
| Fee payer (facilitator) | `0.0.9185802`, which paid the 290413 tinybar network fee |
| Facilitator | `https://x402.org/facilitator` |

The transaction ID was read from the signed bytes before submission, and it matched the `PAYMENT-RESPONSE` exactly.

Replace this with a USDC payment once AGENT is funded from the Circle faucet.
