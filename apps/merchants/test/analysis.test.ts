import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { holderStats, keyFlags, tokenSummary, treasuryStats, type MirrorTx } from "../src/analysis.js";

const fixture = (f: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures", f), "utf8"));
const SAUCE = tokenSummary(fixture("token.json"));
const has = (flags: string[], key: string) => flags.some((f) => f.startsWith(`${key}:`));

test("SAUCE has admin and supply keys, no wipe or freeze", () => {
  const f = keyFlags(SAUCE);
  expect(has(f, "ADMIN_KEY") && has(f, "SUPPLY_KEY")).toBe(true);
  expect(has(f, "WIPE_KEY") || has(f, "FREEZE_KEY")).toBe(false);
  expect(f).toContain("SUPPLY_KEY: issuer can mint more (supply type FINITE, max 1000000000000000)");
});

test("a USDC-like token gets FREEZE_KEY", () => {
  const f = keyFlags(tokenSummary({ admin_key: {}, freeze_key: {}, supply_key: {}, supply_type: "INFINITE", max_supply: "0" }));
  expect(has(f, "FREEZE_KEY")).toBe(true);
});

test("no keys gives only NO_ADMIN_KEYS", () => {
  expect(keyFlags(tokenSummary({}))).toEqual(["NO_ADMIN_KEYS: configuration is immutable"]);
});

test("a fractional fee gives CUSTOM_FEES", () => {
  expect(keyFlags(tokenSummary({ custom_fees: { fixed_fees: [], fractional_fees: [{}] } })))
    .toEqual(["CUSTOM_FEES: 0 fixed, 1 fractional, 0 royalty fees on transfer"]);
});

test("holderStats keeps precision above 2^53 (DOVU supply)", () => {
  const supply = "15924365595423638"; // 8 decimals, > 2^53
  const quarter = (BigInt(supply) / 4n).toString();
  const h = holderStats(supply, "0.0.9", [{ account: "0.0.9", balance: quarter }, { account: "0.0.8", balance: "1" }]);
  expect(h.whales).toEqual([{ account: "0.0.9", balance: quarter, pct: 25 }]);
  expect(h.whaleCount).toBe(1);
  expect(h.treasurySharePct).toBe(25);
  expect(h.whaleSharePct).toBe(25);
});

test("holderStats sorts whales largest first on the SAUCE fixture", () => {
  const h = holderStats(SAUCE.totalSupply, SAUCE.treasury, fixture("holders.json").balances);
  expect(h.whaleCount).toBe(9);
  const bals = h.whales.map((w) => BigInt(w.balance));
  expect(bals.every((b, i) => i === 0 || bals[i - 1]! >= b)).toBe(true);
});

test("treasuryStats counts mints and treasury outflows of this token only", () => {
  const T = "0.0.1077627", TOK = "0.0.731861";
  const txs: MirrorTx[] = [
    { consensus_timestamp: "1", name: "TOKENMINT", token_transfers: [{ token_id: TOK, account: T, amount: 500 }] },
    { consensus_timestamp: "2", name: "CRYPTOTRANSFER", token_transfers: [{ token_id: TOK, account: T, amount: -70 }, { token_id: TOK, account: "0.0.7", amount: 70 }] },
    { consensus_timestamp: "3", name: "CRYPTOTRANSFER", token_transfers: [{ token_id: "0.0.999", account: T, amount: -40 }, { token_id: "0.0.999", account: "0.0.7", amount: 40 }] },
    { consensus_timestamp: "4", name: "TOKENBURN", token_transfers: [{ token_id: TOK, account: T, amount: -10 }] },
    { consensus_timestamp: "5", name: "CRYPTOTRANSFER", token_transfers: [{ token_id: TOK, account: T, amount: 30 }, { token_id: TOK, account: "0.0.7", amount: -30 }] },
  ];
  expect(treasuryStats(TOK, T, txs)).toEqual({
    account: T, sampled: 5, mints: [{ timestamp: "1", amount: "500" }],
    outflows: [{ timestamp: "2", amount: "70", to: "0.0.7" }], outflowTotal: "70",
  });
});
