import Database from "better-sqlite3";

export type PermitStore = {
  /**
   * Atomically burns permitId. When `refusal` is null, it also checks the total ceiling and
   * counts amount toward it. Returns the final refusal reason, or null if signing may proceed.
   */
  claim(p: { permitId: string; purchaseId: string; amountAtomic: string; refusal: string | null; maxTotal: bigint; at: string }): string | null;
  markSigned(permitId: string, txId: string): void;
  /** Signing threw: no transaction exists, so the amount stops counting toward the total. */
  markFailed(permitId: string): void;
  totalCommitted(): bigint;
  close(): void;
};

export function openPermitStore(path: string): PermitStore {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS permits (
    permit_id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL, amount TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SIGNING', 'SIGNED', 'FAILED', 'REFUSED')),
    reason TEXT, tx_id TEXT, at TEXT NOT NULL)`);

  const exists = db.prepare("SELECT 1 FROM permits WHERE permit_id = ?");
  const committed = db.prepare("SELECT amount FROM permits WHERE status IN ('SIGNING', 'SIGNED')");
  const insert = db.prepare("INSERT INTO permits (permit_id, purchase_id, amount, status, reason, at) VALUES (?, ?, ?, ?, ?, ?)");
  const signed = db.prepare("UPDATE permits SET status = 'SIGNED', tx_id = ? WHERE permit_id = ?");
  const failed = db.prepare("UPDATE permits SET status = 'FAILED' WHERE permit_id = ?");
  const total = () => (committed.all() as { amount: string }[]).reduce((s, r) => s + BigInt(r.amount), 0n);

  const claim = db.transaction((p: Parameters<PermitStore["claim"]>[0]): string | null => {
    if (exists.get(p.permitId)) return "PERMIT_REUSED";
    let refusal = p.refusal;
    if (!refusal && total() + BigInt(p.amountAtomic) > p.maxTotal) refusal = "OVER_TOTAL_CEILING";
    insert.run(p.permitId, p.purchaseId, p.amountAtomic, refusal ? "REFUSED" : "SIGNING", refusal, p.at);
    return refusal;
  });

  return {
    claim: (p) => claim(p),
    markSigned: (id, tx) => void signed.run(tx, id),
    markFailed: (id) => void failed.run(id),
    totalCommitted: total,
    close: () => db.close(),
  };
}
