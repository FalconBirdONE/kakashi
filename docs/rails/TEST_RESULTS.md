# Rails test results

Run on 2026-11-06 at commit `a3e20e9` plus the prompt 1.6 hardening changes, Hedera testnet, `ASSET_MODE=hbar` (AGENT has no USDC yet).

## Summary (SPEC §13)

| ID | Test | Where | Result |
|---|---|---|---|
| R1 🌐 | Paid request to quickcast; `PAYMENT-RESPONSE` tx equals the signer's `hederaTxId` | `scripts/hedera/e2e.ts` | **PASS** [`0.0.9185802@1793982625.124378476`](https://hashscan.io/testnet/transaction/0.0.9185802@1793982625.124378476) |
| R2 | Signer refuses wrong MAC, expired, reused, and mismatched amount, payTo, asset, network, feePayer | `apps/signer/test/signer.test.ts` | **PASS** (unit) |
| R3 | Signer per-transaction and total ceilings | `apps/signer/test/signer.test.ts` | **PASS** (unit, including 10 concurrent permits against a ceiling that fits 3) |
| R4 🌐 | `DROP_AFTER_SETTLE`: exactly one settlement; recovery returns the body without a new 402 | `scripts/hedera/e2e.ts` | **PASS** [`0.0.9185802@1793982628.504652534`](https://hashscan.io/testnet/transaction/0.0.9185802@1793982628.504652534). The mirror node shows 1 credit to quickcast. |
| R5 | `fetchQuote` with a redirect or an unregistered merchant | `packages/rails/test/rails.test.ts` | **PASS** (unit: no request for unknown merchants, redirects not followed, query can't change host or path) |
| R6 | Stale, wrong-location, wrong-units, wrong-window and schema-invalid data | `packages/rails/test/rails.test.ts` | **PASS** (unit, a specific issue string for each) |
| R7 🌐 | Audit publish; message visible on the topic, sequence number recorded | `scripts/hedera/e2e.ts` | **PASS** topic [`0.0.11341856`](https://hashscan.io/testnet/topic/0.0.11341856), sequence 4. The mirror message equals the published JSON. |

## Other real-testnet checks

| Check | Transaction |
|---|---|
| Signer `REAL_HEDERA=1` test pays the merchants service | [`0.0.9185802@1793982639.262434051`](https://hashscan.io/testnet/transaction/0.0.9185802@1793982639.262434051) |
| Merchants: paid HourlyPro request with live Open-Meteo data (prompt 1.3) | [`0.0.9185802@1793982021.177130660`](https://hashscan.io/testnet/transaction/0.0.9185802@1793982021.177130660). Replaying it was served from cache with no second transfer. |
| Spike S1: first settled payment | [`0.0.9185802@1793981706.678766160`](https://hashscan.io/testnet/transaction/0.0.9185802@1793981706.678766160) |

Balance cross-check after all runs: AGENT `0.0.11341848` went from 1.0 to 0.9986 HBAR. That's −140000 tinybars, which is exactly 9 quickcast payments (10000 each) plus 1 hourlypro payment (50000). This matches the 10 settlements in the merchant logs, so nothing was paid twice.

## Unit and build gate

Every workspace package passed `build` then `test` (the `pnpm -r build && pnpm -r test` merge gate, run per package):

| Package | Build | Tests |
|---|---|---|
| `packages/contracts` | ok | 20 passed |
| `packages/rails` | ok | 33 passed |
| `apps/merchants` | ok | 20 passed |
| `apps/signer` | ok | 20 passed, 1 skipped (the `REAL_HEDERA` test, run separately above) |
| `scripts/hedera` | typecheck ok | 2 passed |
| `packages/brain`, `packages/trust`, `apps/server`, `evals` | ok | no tests on this branch |
| `apps/web` | ok | 1 passed |

## USDC e2e (after the Circle faucet)

AGENT `0.0.11341848` received 20 USDC from the Circle faucet (Hedera Testnet), and `check` confirmed the balance and the `0.0.429274` association. Then `e2e.ts` ran with `ASSET_MODE=usdc` against fresh signer and merchants databases:

| ID | Result |
|---|---|
| R1 🌐 | **PASS** [`0.0.9185802@1793984794.908601245`](https://hashscan.io/testnet/transaction/0.0.9185802@1793984794.908601245) |
| R4 🌐 | **PASS** [`0.0.9185802@1793984803.504843327`](https://hashscan.io/testnet/transaction/0.0.9185802@1793984803.504843327), 1 credit on the mirror node |
| R7 🌐 | **PASS** topic [`0.0.11341856`](https://hashscan.io/testnet/topic/0.0.11341856), sequence 5 |

The mirror node shows both payments as USDC token transfers of 10000 from AGENT to quickcast. AGENT went from 20.00 to 19.98 USDC, and quickcast went from 0 to 0.02 USDC: two payments, nothing paid twice.
