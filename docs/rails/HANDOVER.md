# Rails handover (for the app branch)

What `apps/server` needs to know to run with `USE_REAL=rails`. Details: [RUN.md](RUN.md), [NOTES.md](NOTES.md), [COMPAT.md](COMPAT.md). README proof: [PROOF.md](PROOF.md).

## Processes and start order

| Order | Process | Address | Owner |
|---|---|---|---|
| 1 | signer | `http://127.0.0.1:4100` (localhost only, refuses anything else) | rails |
| 2 | merchants | `http://127.0.0.1:4200` | rails |
| 3 | server | `:4000` | app |

All three run on one host. On the demo VM, keep 4100 and 4200 closed to the outside.

## Server environment for real rails

`createRails(process.env)` parses contracts `railsEnv`, so the server needs:

- From `.env.generated` (copy into the root `.env`): `AGENT_ACCOUNT_ID`, `MERCHANT_QUICKCAST_PAYTO`, `MERCHANT_HOURLYPRO_PAYTO`, `MERCHANT_GROUNDTRUTH_PAYTO`, `MERCHANT_GOUGER_PAYTO`, `HCS_TOPIC_ID`, `FACILITATOR_FEEPAYER`.
- Already in `.env`: `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` (they pay HCS fees).
- Defaults that usually stay as they are: `MERCHANTS_URL`, `SIGNER_URL`, `MIRROR_NODE_URL`, `FACILITATOR_URL`, `HEDERA_NETWORK`.
- `ASSET_MODE`: `usdc` (the default; AGENT is funded and the USDC e2e passed). `hbar` still works as a fallback. It must be the same in the server, merchants and trust.
- `PERMIT_SECRET`: the same value in the root `.env` (trust mints permits) and in `apps/signer/.env.local`.
- **Never** `AGENT_PRIVATE_KEY`. It lives only in `apps/signer/.env.local`.

## Asset mode and amounts

- Registry prices (`priceAtomic`) are used as-is in both modes: USDC units with `usdc`, tinybars with `hbar`. Policy and mandate numbers stay identical. Only the display decimals change: USDC 6, HBAR 8.
- In HBAR mode the mandate should use `assetId: "0.0.0"` and `assetDecimals: 8`. The demo mandate's "0.20" (200000 atomic) then means 200000 tinybars, or 0.002 HBAR.
- AGENT holds 19.98 testnet USDC after the e2e run. Each quickcast payment costs 0.01 USDC. The faucet allows one request every 2 hours.

## Calling rails

- `fetchQuote(merchantId, {lat, lon, startDate, endDate})` returns quote fields. Pass `quote.rawRequirements` to `signPayment` unchanged.
- Trust's permit must copy `network`, `assetId`, `amountAtomic`, `payTo` and `feePayer` from the quote **exactly**, or the signer refuses. Permit lifetime is at most 60 s.
- `submitPaidRequest(quote, paymentHeader)` works only for quotes fetched by **the same rails instance**, because rails keeps the query in memory by `requestHash`. After a server restart, an old quote comes back `REJECTED` without being sent, so the signed transaction never lands. Quotes expire in 60 s anyway.
- `checkSettlement` **throws `Error("MIRROR_UNAVAILABLE")`** when the mirror node is down. It never reports `NOT_FOUND` for an outage. The current reconciler already catches and retries.
- The mirror node lags consensus by about 3 to 6 s, so a just-settled transaction can read `NOT_FOUND` briefly.
- `recoverDelivery` is free and works from the merchant cache, or from a mirror-node confirmation if the cache is gone.

## Delivered data shape

```json
{ "merchant": "quickcast", "source": "open-meteo",
  "location": { "lat": 19.076, "lon": 72.878, "name": "19.076,72.878" },
  "window": { "start": "2026-11-07", "end": "2026-11-07" },
  "generatedAt": "2026-11-06T16:20:27.398Z", "units": "metric", "fieldUnits": { },
  "daily": { } }
```

`hourlypro` carries `hourly`, `groundtruth` carries `current`, and `gouger` carries `daily`. With the `INJECT_TEXT` fault there's also a `note` field. The contracts fake uses `window.startDate/endDate`, so don't build UI against the fake's field names. `source: "fixture"` means Open-Meteo failed or `FIXTURE_MODE=true`.

## Demo fault API

`POST {MERCHANTS_URL}/admin/fault` with JSON `{ "merchantId": "quickcast" | "hourlypro" | "groundtruth" | "gouger", "fault": "NONE" | "DROP_AFTER_SETTLE" | "SWAP_PAYTO" | "STALE_DATA" | "INJECT_TEXT" }`.

- It returns `404` unless the merchants service runs with `DEMO_MODE=true`.
- Faults are in memory, per merchant, and are lost on restart. Reset with `NONE`.
- `SWAP_PAYTO` advertises `HEDERA_OPERATOR_ID` as the recipient. Policy should reject it with `RECIPIENT_MISMATCH`.
- `DROP_AFTER_SETTLE` settles, stores, then closes the socket. Rails returns `NO_RESPONSE`, and the reconciler sees `SUCCESS` on the mirror node and recovers the data.
- `STALE_DATA` sets `generatedAt` to 2 days old, so `validateDelivery` reports `stale data: ...`.

## Known limitations

- **"Run again" within 10 minutes:** the merchant's idempotency serves a cached result to the same payer for the same `requestHash` (same merchant and same query) within 10 minutes, without settling again. The new purchase gets `outcome: "SETTLED"`, but `settlement.transaction` is the **earlier** transaction, not the new `hederaTxId`. The new signed transaction is never submitted and can't land. The current orchestrator handles this safely: the mismatch moves the purchase to `UNKNOWN`, and the reconciler finds `NOT_FOUND` and moves it to `FAILED_FINAL` after the validity window, releasing the reservation. Nothing is paid twice, but the cached data is dropped, so that run's answer shows a gap and the purchase shows "pending reconciliation" for about 90 s. In the demo, avoid rerunning an identical question within 10 minutes, or vary the query.
- The facilitator's verify step looks up the payer key on the mirror node, and a mirror 503 makes it answer `invalid_exact_hedera_payload_signature_invalid`. That surfaces as `REJECTED`. It's transient, and a fresh attempt works.
- `SIGNER_MAX_TOTAL_ATOMIC` is a lifetime total stored in `apps/signer/data/signer.sqlite`. Delete the file (signer stopped) to reset it between demo rehearsals.
- The operator holds the agent key (custodial demo). Spending limits are enforced by trust and the signer, not onchain.
- Both USDC and HBAR are proven end to end on testnet (see [PROOF.md](PROOF.md)).
