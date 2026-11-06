import Database from "better-sqlite3";

export type SettlementRow = {
  tx: string;
  merchantId: string;
  payer: string;
  requestHash: string;
  body: unknown;
  settleResponse: Record<string, unknown>;
  createdAt: string;
};

export type Store = {
  saveSettlement(r: SettlementRow): void;
  byTx(tx: string): SettlementRow | undefined;
  recentFor(merchantId: string, payer: string, requestHash: string, sinceIso: string): SettlementRow | undefined;
  /** Remembers the query behind each requestHash, so a lost response can be regenerated later. */
  saveQuote(requestHash: string, merchantId: string, query: Record<string, string>, at: string): void;
  quoteFor(requestHash: string): { merchantId: string; query: Record<string, string> } | undefined;
  close(): void;
};

export function openStore(path: string): Store {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settlements (
      tx TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, payer TEXT NOT NULL, request_hash TEXT NOT NULL,
      body TEXT NOT NULL, settle_response TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS settlements_by_payer ON settlements (merchant_id, payer, request_hash, created_at);
    CREATE TABLE IF NOT EXISTS quotes (
      request_hash TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, query TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  type Raw = { tx: string; merchant_id: string; payer: string; request_hash: string; body: string; settle_response: string; created_at: string };
  const toRow = (r: Raw | undefined): SettlementRow | undefined =>
    r && {
      tx: r.tx, merchantId: r.merchant_id, payer: r.payer, requestHash: r.request_hash,
      body: JSON.parse(r.body), settleResponse: JSON.parse(r.settle_response), createdAt: r.created_at,
    };

  const insertSettlement = db.prepare(
    "INSERT OR IGNORE INTO settlements VALUES (@tx, @merchantId, @payer, @requestHash, @body, @settleResponse, @createdAt)",
  );
  const byTx = db.prepare("SELECT * FROM settlements WHERE tx = ?");
  const recent = db.prepare(
    "SELECT * FROM settlements WHERE merchant_id = ? AND payer = ? AND request_hash = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1",
  );
  const upsertQuote = db.prepare("INSERT OR REPLACE INTO quotes VALUES (?, ?, ?, ?)");
  const quote = db.prepare("SELECT merchant_id, query FROM quotes WHERE request_hash = ?");

  return {
    saveSettlement(r: SettlementRow): void {
      insertSettlement.run({ ...r, body: JSON.stringify(r.body), settleResponse: JSON.stringify(r.settleResponse) });
    },
    byTx: (tx: string) => toRow(byTx.get(tx) as Raw | undefined),
    recentFor: (merchantId: string, payer: string, requestHash: string, sinceIso: string) =>
      toRow(recent.get(merchantId, payer, requestHash, sinceIso) as Raw | undefined),
    saveQuote(requestHash: string, merchantId: string, query: Record<string, string>, at: string): void {
      upsertQuote.run(requestHash, merchantId, JSON.stringify(query), at);
    },
    quoteFor(requestHash: string): { merchantId: string; query: Record<string, string> } | undefined {
      const r = quote.get(requestHash) as { merchant_id: string; query: string } | undefined;
      return r && { merchantId: r.merchant_id, query: JSON.parse(r.query) };
    },
    close: () => db.close(),
  };
}
