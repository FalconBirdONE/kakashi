# Proof of payment

Use this one in the README. It's a payment made through the full rails stack: a quote from the merchants service, a single-use permit, the isolated signer, x402 settlement through the facilitator, then confirmation on the mirror node (e2e check R1, 2026-11-06).

| Field | Value |
|---|---|
| Transaction ID | `0.0.9185802@1793982625.124378476` |
| HashScan | https://hashscan.io/testnet/transaction/0.0.9185802@1793982625.124378476 |
| Mirror node | https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.9185802-1793982625-124378476 |
| Network | Hedera testnet (`hedera:testnet`), x402 v2, scheme `exact` |
| Asset | HBAR (`0.0.0`), the `ASSET_MODE=hbar` fallback |
| Amount | 10000 tinybars (0.0001 HBAR) |
| Payer (AGENT) | `0.0.11341848` |
| Recipient (quickcast `payTo`) | `0.0.11341850` |
| Fee payer (facilitator) | `0.0.9185802` |
| Facilitator | `https://x402.org/facilitator` |
| HCS audit topic | `0.0.11341856` (https://hashscan.io/testnet/topic/0.0.11341856) |

The signer read the transaction ID from its own signed bytes before the payment was sent, and it matched `PAYMENT-RESPONSE.transaction` exactly.

## Earlier proofs

- Spike S1, the first settled x402 payment: `0.0.9185802@1793981706.678766160` (https://hashscan.io/testnet/transaction/0.0.9185802@1793981706.678766160).
- Pay-once recovery (R4): `0.0.9185802@1793982628.504652534`. The response was dropped after settlement, the payment was confirmed on the mirror node, and the data was recovered for free. There was one transfer only.

Replace the main proof with a USDC payment once AGENT is funded from the Circle faucet.
