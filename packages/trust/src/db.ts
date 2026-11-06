import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { MERCHANT_REGISTRY } from "@tollbooth/contracts";

export type Db = Database.Database;

/** Shared by every trust module. `now` is injectable so expiry can be tested. */
export type Ctx = {
  db: Db;
  env: Record<string, string | undefined>;
  now: () => Date;
  /** EXHAUSTED when available budget < this (cheapest registry price). */
  minPriceAtomic: string;
};

/** Numbered, append-only. Later prompts add migrations; never edit an applied one. Money columns are TEXT atomic strings. */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE world_identities (
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  iss TEXT NOT NULL, sub TEXT NOT NULL, linked_at TEXT NOT NULL,
  UNIQUE (iss, sub)
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  wallet_account_id TEXT NOT NULL, created_at TEXT NOT NULL
);

-- One row per (mandate id, version). An edit inserts version+1 in state DRAFT.
CREATE TABLE mandates (
  id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id), agent_id TEXT NOT NULL REFERENCES agents(id),
  wallet_account_id TEXT NOT NULL, network TEXT NOT NULL, asset_id TEXT NOT NULL, asset_decimals INTEGER NOT NULL,
  total_budget TEXT NOT NULL, per_payment_cap TEXT NOT NULL, auto_approve_cap TEXT NOT NULL,
  allowed_merchant_ids TEXT NOT NULL, max_purchases_per_run INTEGER NOT NULL, max_run_duration_seconds INTEGER NOT NULL,
  valid_from TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT,
  spent TEXT NOT NULL DEFAULT '0', reserved TEXT NOT NULL DEFAULT '0',
  mandate_hash TEXT NOT NULL, activation_approval_id TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);
-- SPEC §9.3: one ACTIVE mandate per user.
CREATE UNIQUE INDEX one_active_mandate_per_user ON mandates(user_id) WHERE state = 'ACTIVE';
CREATE INDEX mandates_user ON mandates(user_id, created_at);

CREATE TABLE user_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id), text TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE auth_attempts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), purpose TEXT NOT NULL, target_hash TEXT NOT NULL,
  started_at TEXT NOT NULL, expires_at TEXT NOT NULL, result TEXT NOT NULL,
  device_code_ref TEXT NOT NULL, verification_uri TEXT NOT NULL, user_code TEXT NOT NULL,
  iss TEXT, sub TEXT, auth_time TEXT, acr TEXT, amr TEXT
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE REFERENCES auth_attempts(id),
  purpose TEXT NOT NULL, target_hash TEXT NOT NULL, decision TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  mandate_id TEXT NOT NULL, mandate_version INTEGER NOT NULL,
  question TEXT NOT NULL, state TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  answer TEXT, failure_reason TEXT, plan TEXT,
  FOREIGN KEY (mandate_id, mandate_version) REFERENCES mandates(id, version)
);
CREATE INDEX runs_user ON runs(user_id, started_at);

CREATE TABLE quotes (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), merchant_id TEXT NOT NULL, method TEXT NOT NULL,
  origin TEXT NOT NULL, path TEXT NOT NULL, request_hash TEXT NOT NULL,
  network TEXT NOT NULL, asset_id TEXT NOT NULL, amount TEXT NOT NULL, pay_to TEXT NOT NULL,
  facilitator_url TEXT NOT NULL, fee_payer TEXT NOT NULL, max_timeout_seconds INTEGER NOT NULL,
  raw_requirements TEXT NOT NULL, received_at TEXT NOT NULL, local_expires_at TEXT NOT NULL,
  quote_hash TEXT NOT NULL, policy_result TEXT
);
CREATE INDEX quotes_run ON quotes(run_id);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), quote_id TEXT NOT NULL REFERENCES quotes(id),
  quote_hash TEXT NOT NULL, mandate_id TEXT NOT NULL, mandate_version INTEGER NOT NULL,
  state TEXT NOT NULL, delivery TEXT NOT NULL,
  policy_result TEXT, decision TEXT, approval_id TEXT, permit_id TEXT, purchase_hash TEXT NOT NULL,
  hedera_tx_id TEXT, settlement TEXT, delivery_issues TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (run_id, quote_id),
  FOREIGN KEY (mandate_id, mandate_version) REFERENCES mandates(id, version)
);
CREATE INDEX purchases_state ON purchases(state);

CREATE TABLE inference_calls (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL,
  model TEXT NOT NULL, trust_tier TEXT NOT NULL, zg_request_id TEXT NOT NULL, provider TEXT NOT NULL,
  tee_verified INTEGER, total_cost TEXT NOT NULL, latency_ms INTEGER NOT NULL,
  input_hash TEXT NOT NULL, output_hash TEXT NOT NULL, ok INTEGER NOT NULL, error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX inference_run ON inference_calls(run_id);

-- Append-only audit outbox (SPEC §8.6); the worker functions arrive in a later prompt.
CREATE TABLE audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, payload TEXT NOT NULL,
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'PENDING',
  topic_id TEXT, sequence_number INTEGER, consensus_timestamp TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT
);
CREATE INDEX audit_pending ON audit_events(state, seq);
`,
  },
  {
    // Pin the amount at proposal: budget effects must release exactly what was reserved, even if the quote row changes.
    version: 2,
    sql: "ALTER TABLE purchases ADD COLUMN amount TEXT;",
  },
  {
    // World attempts: what they target (AuthAttemptPublic.targetId) and server-side poll pacing (interval, slow_down).
    version: 3,
    sql: `
ALTER TABLE auth_attempts ADD COLUMN target_id TEXT;
ALTER TABLE auth_attempts ADD COLUMN interval_seconds INTEGER;
ALTER TABLE auth_attempts ADD COLUMN next_poll_at TEXT;
CREATE INDEX auth_attempts_target ON auth_attempts(purpose, target_id, result);
`,
  },
];

export function migrate(db: Db): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set((db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(m.version, new Date().toISOString());
    })();
  }
}

/** Opens (creating directories as needed), sets WAL + foreign keys, runs migrations. ":memory:" is allowed. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function createCtx(
  env: Record<string, string | undefined> = process.env,
  opts: { now?: () => Date; db?: Db } = {},
): Ctx {
  const prices = MERCHANT_REGISTRY.map((m) => BigInt(m.priceAtomic));
  const min = prices.reduce((a, b) => (a < b ? a : b));
  return {
    db: opts.db ?? openDb(env.DB_PATH ?? "./data/tollbooth.sqlite"),
    env, now: opts.now ?? (() => new Date()), minPriceAtomic: min.toString(),
  };
}
