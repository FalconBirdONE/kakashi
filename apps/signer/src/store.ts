import { randomBytes } from "node:crypto";
import { seal, unseal, type SignerStatus } from "@kakashi/contracts";
import Database from "better-sqlite3";

export type PermitStore = {
  /**
   * Atomically burns permitId. When `refusal` is null, it also checks the total ceiling and
   * counts amount toward it. Returns the final refusal reason, or null if signing may proceed.
   */
  claim(p: { permitId: string; purchaseId: string; amountAtomic: string; refusal: string | null; maxTotal: bigint; at: string }): string | null;
  markSigned(permitId: string, txId: string, paymentHeader?: string): void;
  status(permitId:string):SignerStatus;
  /** Signing threw: no transaction exists, so the amount stops counting toward the total. */
  markFailed(permitId: string): void;
  totalCommitted(): bigint;
  close(): void;
};

export function openPermitStore(path: string, secretHex = path === ":memory:" ? randomBytes(32).toString("hex") : ""): PermitStore {
  if(!/^[a-f0-9]{64}$/i.test(secretHex))throw new Error("SIGNER_STORAGE_KEY_REQUIRED");
  const db = new Database(path);
  db.pragma("busy_timeout=5000");
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS permits (
    permit_id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL, amount TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('SIGNING', 'SIGNED', 'FAILED', 'REFUSED')),
    reason TEXT, tx_id TEXT, at TEXT NOT NULL)`);

  if(!(db.prepare('PRAGMA table_info(permits)').all() as {name:string}[]).some(c=>c.name==='payload'))db.exec('ALTER TABLE permits ADD COLUMN payload TEXT');
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_signed_purchase ON permits(purchase_id) WHERE status IN ('SIGNING','SIGNED')");
  const exists = db.prepare("SELECT 1 FROM permits WHERE permit_id = ? OR (purchase_id = ? AND status IN ('SIGNING','SIGNED'))");
  const committed = db.prepare("SELECT amount FROM permits WHERE status IN ('SIGNING', 'SIGNED')");
  const insert = db.prepare("INSERT INTO permits (permit_id, purchase_id, amount, status, reason, at) VALUES (?, ?, ?, ?, ?, ?)");
  const signed = db.prepare("UPDATE permits SET status = 'SIGNED', tx_id = ?, payload = ? WHERE permit_id = ?");
  const failed = db.prepare("UPDATE permits SET status = 'FAILED' WHERE permit_id = ?");
  const total = () => (committed.all() as { amount: string }[]).reduce((s, r) => s + BigInt(r.amount), 0n);

  const claim = db.transaction((p: Parameters<PermitStore["claim"]>[0]): string | null => {
    if (exists.get(p.permitId,p.purchaseId)) return "PERMIT_REUSED";
    let refusal = p.refusal;
    if (!refusal && total() + BigInt(p.amountAtomic) > p.maxTotal) refusal = "OVER_TOTAL_CEILING";
    insert.run(p.permitId, p.purchaseId, p.amountAtomic, refusal ? "REFUSED" : "SIGNING", refusal, p.at);
    return refusal;
  });

  return {
    claim: (p) => claim.immediate(p),
    status: id => {
      const r=db.prepare("SELECT status,tx_id,payload FROM permits WHERE permit_id=?").get(id) as {status:string;tx_id:string;payload:string}|undefined;
      if(!r)return {state:"NOT_FOUND"};
      if(r.status!=="SIGNED")return {state:r.status as "SIGNING"|"FAILED"|"REFUSED"};
      if(!r.payload)return {state:"UNAVAILABLE"};
      return {state:"SIGNED",hederaTxId:r.tx_id,paymentHeader:unseal<string>(r.payload,secretHex,"signature:"+id)};
    },
    markSigned: (id, tx, header) => void signed.run(tx, header?seal(header,secretHex,"signature:"+id):null, id),
    markFailed: (id) => void failed.run(id),
    totalCommitted: total,
    close: () => db.close(),
  };
}
