# Running the rails services locally

Two processes come from the rails branch: the **signer** (127.0.0.1:4100) and the **merchants** service (127.0.0.1:4200). Start the signer first. The server only calls it when a purchase is authorized, but a run with real rails needs both.

## Prerequisites

1. `pnpm install` at the repo root.
2. Hedera accounts exist: see [SETUP.md](SETUP.md) (`setup` then `check`).
3. Build contracts once: `cd packages/contracts && npm run build`. Other packages import its `dist`.

## Environment

| Process | Reads | Needs |
|---|---|---|
| signer | `apps/signer/.env.local`, then the process env. **Never the root `.env`.** | `AGENT_ACCOUNT_ID`, `AGENT_PRIVATE_KEY` (written by setup), `PERMIT_SECRET`, `SIGNER_MAX_PER_TX_ATOMIC`, `SIGNER_MAX_TOTAL_ATOMIC`. Optional: `SIGNER_PORT` (4100), `SIGNER_DB_PATH`. |
| merchants | root `.env`, then `.env.generated`, then the process env | `MERCHANT_*_PAYTO` (from setup). Optional: `ASSET_MODE` (`usdc`), `USDC_TOKEN_ID`, `FACILITATOR_URL`, `MIRROR_NODE_URL`, `DEMO_MODE`, `FIXTURE_MODE`, `HEDERA_OPERATOR_ID` (only for the `SWAP_PAYTO` fault), `MERCHANTS_PORT` (4200), `MERCHANTS_DB_PATH`. |

`PERMIT_SECRET` must be identical in the signer and in trust (the server). Generate it once:

```sh
node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
```

Put that value in both the root `.env` (`PERMIT_SECRET=`) and `apps/signer/.env.local`. Add the signer ceilings to `apps/signer/.env.local` too, for example:

```
PERMIT_SECRET=<same value as root .env>
SIGNER_MAX_PER_TX_ATOMIC=100000
SIGNER_MAX_TOTAL_ATOMIC=1000000
```

`SIGNER_MAX_TOTAL_ATOMIC` is a lifetime total recorded in `apps/signer/data/signer.sqlite`. To reset it, delete that file while the signer is stopped.

**Asset mode:** AGENT holds no USDC yet, so run both processes with `ASSET_MODE=hbar` until the faucet step is done. Merchants, rails and trust must all use the same mode.

## Start

```sh
# terminal 1: signer
pnpm --filter @tollbooth/signer dev

# terminal 2: merchants (demo faults on)
DEMO_MODE=true ASSET_MODE=hbar pnpm --filter @tollbooth/merchants dev
```

Without pnpm on PATH, run `npm run dev` inside each package folder instead.

Expected first lines:

```
signer for 0.0.11341848 on http://127.0.0.1:4100
merchants on http://127.0.0.1:4200 asset 0.0.0 DEMO_MODE
```

## Check it works

```sh
curl -s http://127.0.0.1:4200/catalog | head -c 200
curl -si "http://127.0.0.1:4200/m/quickcast/forecast?lat=19.076&lon=72.878" | head -5   # expect 402 + PAYMENT-REQUIRED
```

Real end-to-end payment, recovery and audit (spends about 20000 tinybars and one HCS message):

```sh
cd scripts/hedera
PERMIT_SECRET=<signer's secret> ASSET_MODE=hbar ./node_modules/.bin/tsx e2e.ts
```

## Stop

Ctrl-C each terminal. If a background process is left over, find it with `lsof -nP -iTCP:4100 -iTCP:4200 -sTCP:LISTEN` and kill that PID.
