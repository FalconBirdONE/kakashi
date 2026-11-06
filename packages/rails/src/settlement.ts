import type { Atomic } from "@tollbooth/contracts";

/** 0.0.x@seconds.nanos to the mirror node form 0.0.x-seconds-nanos. */
export function toMirrorTxId(tx: string): string {
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(tx);
  if (!m) throw new Error(`not a Hedera transaction id: ${tx}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

type MirrorTx = {
  result: string;
  nonce?: number;
  transfers?: { account: string; amount: number }[];
  token_transfers?: { token_id: string; account: string; amount: number }[];
};

export type SettlementCheck = "SUCCESS" | "FAILED" | "NOT_FOUND" | "MISMATCH";

/**
 * SUCCESS only when the transaction succeeded and credited exactly amount of asset to payTo.
 * Throws Error("MIRROR_UNAVAILABLE") when the mirror can't answer, so callers retry instead of
 * mistaking an outage for NOT_FOUND.
 */
export async function checkSettlement(
  fetchFn: typeof fetch, mirrorUrl: string, txId: string,
  expect: { payTo: string; assetId: string; amountAtomic: Atomic },
): Promise<SettlementCheck> {
  let res: Response;
  try {
    res = await fetchFn(`${mirrorUrl}/api/v1/transactions/${toMirrorTxId(txId)}`, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error("MIRROR_UNAVAILABLE");
  }
  if (res.status === 404) return "NOT_FOUND";
  if (!res.ok) throw new Error("MIRROR_UNAVAILABLE");
  const list = ((await res.json()) as { transactions?: MirrorTx[] }).transactions ?? [];
  const tx = list.find((t) => (t.nonce ?? 0) === 0);
  if (!tx) return "NOT_FOUND";
  if (tx.result !== "SUCCESS") return "FAILED";

  const credited = (expect.assetId === "0.0.0"
    ? (tx.transfers ?? [])
    : (tx.token_transfers ?? []).filter((t) => t.token_id === expect.assetId))
    .filter((t) => t.account === expect.payTo)
    .reduce((sum, t) => sum + BigInt(t.amount), 0n);
  return credited === BigInt(expect.amountAtomic) ? "SUCCESS" : "MISMATCH";
}
