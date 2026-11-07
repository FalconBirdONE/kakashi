// Pure analysis of Hedera mirror-node token data. No I/O.

/** Mirror node /api/v1/tokens/{id} fields we read. Keys are objects or null. */
export type MirrorToken = {
  token_id?: string; name?: string; symbol?: string; decimals?: string | number; total_supply?: string | number;
  max_supply?: string | number; supply_type?: string; treasury_account_id?: string; created_timestamp?: string;
  memo?: string; pause_status?: string;
  admin_key?: unknown; freeze_key?: unknown; wipe_key?: unknown; supply_key?: unknown; pause_key?: unknown; kyc_key?: unknown; fee_schedule_key?: unknown;
  custom_fees?: { fixed_fees?: unknown[]; fractional_fees?: unknown[]; royalty_fees?: unknown[] } | null;
};

export type TokenSummary = {
  name: string; symbol: string; decimals: number; totalSupply: string; maxSupply: string; supplyType: string;
  treasury: string; createdAt: string; memo: string; pauseStatus: string;
  keys: { admin: boolean; freeze: boolean; wipe: boolean; supply: boolean; pause: boolean; kyc: boolean; feeSchedule: boolean };
  customFees: { fixed: number; fractional: number; royalty: number };
};

export function tokenSummary(t: MirrorToken): TokenSummary {
  return {
    name: t.name ?? "", symbol: t.symbol ?? "", decimals: Number(t.decimals ?? 0),
    totalSupply: String(t.total_supply ?? "0"), maxSupply: String(t.max_supply ?? "0"), supplyType: t.supply_type ?? "",
    treasury: t.treasury_account_id ?? "", createdAt: t.created_timestamp ?? "", memo: t.memo ?? "", pauseStatus: t.pause_status ?? "",
    keys: {
      admin: !!t.admin_key, freeze: !!t.freeze_key, wipe: !!t.wipe_key, supply: !!t.supply_key,
      pause: !!t.pause_key, kyc: !!t.kyc_key, feeSchedule: !!t.fee_schedule_key,
    },
    customFees: {
      fixed: t.custom_fees?.fixed_fees?.length ?? 0,
      fractional: t.custom_fees?.fractional_fees?.length ?? 0,
      royalty: t.custom_fees?.royalty_fees?.length ?? 0,
    },
  };
}

export function keyFlags(token: TokenSummary): string[] {
  const k = token.keys, f = token.customFees;
  const out: string[] = [];
  if (k.admin) out.push("ADMIN_KEY: issuer can change the token's keys");
  if (k.freeze) out.push("FREEZE_KEY: issuer can freeze any holder's balance");
  if (k.wipe) out.push("WIPE_KEY: issuer can wipe any holder's balance");
  if (k.pause) out.push("PAUSE_KEY: issuer can pause all transfers");
  if (k.supply) out.push(`SUPPLY_KEY: issuer can mint more (supply type ${token.supplyType}, max ${token.maxSupply})`);
  if (k.kyc) out.push("KYC_KEY: transfers need issuer KYC");
  if (k.feeSchedule) out.push("FEE_SCHEDULE_KEY: issuer can add transfer fees later");
  if (f.fixed + f.fractional + f.royalty > 0) out.push(`CUSTOM_FEES: ${f.fixed} fixed, ${f.fractional} fractional, ${f.royalty} royalty fees on transfer`);
  return out.length ? out : ["NO_ADMIN_KEYS: configuration is immutable"];
}

export type Holders = {
  thresholdPct: 1; whales: { account: string; balance: string; pct: number }[];
  whaleCount: number; whaleSharePct: number; treasurySharePct: number;
};

// Two-decimal percentage in BigInt, so supplies above 2^53 lose no precision. Rounds to nearest, not down,
// so a floored quarter of an odd supply still reads 25.
const pctOf = (part: bigint, supply: bigint): number => (supply > 0n ? Number((part * 20000n + supply) / (2n * supply)) / 100 : 0);

export function holderStats(totalSupply: string, treasury: string, balances: { account: string; balance: number | string }[]): Holders {
  const supply = BigInt(totalSupply);
  const threshold = supply / 100n;
  const rows = balances.map((b) => ({ account: b.account, bal: BigInt(b.balance) }))
    .filter((b) => b.bal > threshold)
    .sort((a, b) => (a.bal === b.bal ? 0 : a.bal > b.bal ? -1 : 1));
  const whales = rows.map((r) => ({ account: r.account, balance: r.bal.toString(), pct: pctOf(r.bal, supply) }));
  const treasuryBal = rows.find((r) => r.account === treasury)?.bal ?? 0n;
  return {
    thresholdPct: 1, whales, whaleCount: whales.length,
    whaleSharePct: pctOf(rows.reduce((s, r) => s + r.bal, 0n), supply),
    treasurySharePct: pctOf(treasuryBal, supply),
  };
}

export function holderFlags(h: Holders): string[] {
  const out: string[] = [];
  if (h.whaleCount > 0) out.push(`WHALES: ${h.whaleCount} wallets each hold over 1% (${h.whaleSharePct}% together)`);
  if (h.treasurySharePct > 0) out.push(`TREASURY_HOLDS: treasury holds ${h.treasurySharePct}% of supply`);
  return out;
}

export type MirrorTx = {
  consensus_timestamp: string; name: string;
  token_transfers?: { token_id: string; account: string; amount: number | string }[];
};
export type Treasury = {
  account: string; sampled: number;
  mints: { timestamp: string; amount: string }[];
  outflows: { timestamp: string; amount: string; to: string }[];
  outflowTotal: string;
};

export function treasuryStats(tokenId: string, treasury: string, transactions: MirrorTx[]): Treasury {
  const mints: Treasury["mints"] = [];
  const outflows: Treasury["outflows"] = [];
  let total = 0n;
  for (const tx of transactions) {
    const moves = (tx.token_transfers ?? []).filter((t) => t.token_id === tokenId).map((t) => ({ account: t.account, amount: BigInt(t.amount) }));
    if (moves.length === 0) continue;
    const own = moves.filter((m) => m.account === treasury);
    if (tx.name === "TOKENMINT") {
      const minted = own.reduce((s, m) => s + (m.amount > 0n ? m.amount : 0n), 0n);
      mints.push({ timestamp: tx.consensus_timestamp, amount: minted.toString() });
      continue;
    }
    if (tx.name === "TOKENBURN") continue;
    for (const m of own) {
      if (m.amount >= 0n) continue;
      const out = -m.amount;
      const to = moves.find((x) => x.account !== treasury && x.amount === out)?.account ?? "";
      outflows.push({ timestamp: tx.consensus_timestamp, amount: out.toString(), to });
      total += out;
    }
  }
  return { account: treasury, sampled: transactions.length, mints, outflows, outflowTotal: total.toString() };
}

export function treasuryFlags(t: Treasury): string[] {
  const out: string[] = [];
  if (t.outflows.length) out.push(`TREASURY_SELLING: ${t.outflows.length} outflows in the last ${t.sampled} transactions`);
  if (t.mints.length) out.push(`RECENT_MINTS: ${t.mints.length} mints in the last ${t.sampled} transactions`);
  return out;
}
