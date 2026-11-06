# Proof of payment

Use this one in the README. It's a USDC payment made through the full rails stack: a quote from the merchants service, a single-use permit, the isolated signer, x402 settlement through the facilitator, then confirmation on the mirror node (e2e check R1 with `ASSET_MODE=usdc`, 2026-11-06).

| Field | Value |
|---|---|
| Transaction ID | `0.0.9185802@1793984794.908601245` |
| HashScan | https://hashscan.io/testnet/transaction/0.0.9185802@1793984794.908601245 |
| Mirror node | https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.9185802-1793984794-908601245 |
| Network | Hedera testnet (`hedera:testnet`), x402 v2, scheme `exact` |
| Asset | USDC `0.0.429274` (6 decimals) |
| Amount | 10000 atomic (0.01 USDC) |
| Payer (AGENT) | `0.0.11341848` |
| Recipient (quickcast `payTo`) | `0.0.11341850` |
| Fee payer (facilitator) | `0.0.9185802` |
| Facilitator | `https://x402.org/facilitator` |
| HCS audit topic | `0.0.11341856` (https://hashscan.io/testnet/topic/0.0.11341856) |

The signer read the transaction ID from its own signed bytes before the payment was sent, and it matched `PAYMENT-RESPONSE.transaction` exactly. The mirror node shows the result `SUCCESS` with one token transfer: AGENT −10000, quickcast +10000.

## Other USDC proofs (same run)

- Pay-once recovery (R4): `0.0.9185802@1793984803.504843327` (https://hashscan.io/testnet/transaction/0.0.9185802@1793984803.504843327). The response was dropped after settlement, the payment was confirmed on the mirror node, and the data was recovered for free. There was one transfer only.
- Audit message (R7): topic `0.0.11341856`, sequence 5.

## Earlier HBAR proofs (`ASSET_MODE=hbar` fallback)

- R1: `0.0.9185802@1793982625.124378476` (https://hashscan.io/testnet/transaction/0.0.9185802@1793982625.124378476), 10000 tinybars.
- R4: `0.0.9185802@1793982628.504652534` (https://hashscan.io/testnet/transaction/0.0.9185802@1793982628.504652534).
- Spike S1, the first settled x402 payment: `0.0.9185802@1793981706.678766160` (https://hashscan.io/testnet/transaction/0.0.9185802@1793981706.678766160).
