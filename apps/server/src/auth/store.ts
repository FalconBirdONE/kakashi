import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newId } from '@kakashi/contracts';

const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export type Session = { userId: string; csrf: string; expiresAt: number };
export class AuthStore {
  readonly db: Database.Database;
  constructor(path: string, private now = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
    this.db = new Database(path);
    this.db.pragma('journal_mode=WAL');
    this.db.pragma('busy_timeout=5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, issuer TEXT NOT NULL, subject TEXT NOT NULL, email TEXT NOT NULL, UNIQUE(issuer,subject));
      CREATE TABLE IF NOT EXISTS invites (email TEXT PRIMARY KEY, consumed_by TEXT);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_attempts (hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    `);
  }
  invite(email: string) { this.db.prepare('INSERT OR IGNORE INTO invites(email) VALUES (?)').run(email.trim().toLowerCase()); }
  account(issuer: string, subject: string, email: string, verified: boolean): string {
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT id FROM accounts WHERE issuer=? AND subject=?').get(issuer,subject) as {id:string}|undefined;
      if (existing) return existing.id;
      const normalized = email.trim().toLowerCase();
      const invite = this.db.prepare('SELECT consumed_by FROM invites WHERE email=?').get(normalized) as {consumed_by:string|null}|undefined;
      if (!verified || !invite || invite.consumed_by) throw new Error('INVITE_REQUIRED');
      const id = newId('usr_');
      this.db.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run(id,issuer,subject,normalized);
      this.db.prepare('UPDATE invites SET consumed_by=? WHERE email=? AND consumed_by IS NULL').run(id,normalized);
      return id;
    }).immediate();
  }
  issue(userId: string, lifetimeMs = 8*3600_000) {
    const token = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(token),userId,csrf,this.now()+lifetimeMs);
    return {token,csrf,userId};
  }
  session(token: string): Session|null {
    const r=this.db.prepare('SELECT user_id,csrf,expires_at FROM sessions WHERE hash=? AND expires_at>?').get(digest(token),this.now()) as {user_id:string;csrf:string;expires_at:number}|undefined;
    return r ? {userId:r.user_id,csrf:r.csrf,expiresAt:r.expires_at} : null;
  }
  revoke(token: string) { this.db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(token)); }
  login(state: string, verifier: string, nonce: string) { this.db.prepare('INSERT INTO login_attempts VALUES (?,?,?,?)').run(digest(state),verifier,nonce,this.now()+600_000); }
  consumeLogin(state: string) {
    return this.db.transaction(() => {
      const r=this.db.prepare('SELECT verifier,nonce FROM login_attempts WHERE hash=? AND expires_at>?').get(digest(state),this.now()) as {verifier:string;nonce:string}|undefined;
      this.db.prepare('DELETE FROM login_attempts WHERE hash=?').run(digest(state));
      return r;
    }).immediate();
  }
  limit(key: string, max: number, windowMs = 60_000): boolean {
    return this.db.transaction(() => {
      const now=this.now();
      this.db.prepare('INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END').run(key,now+windowMs,now,now);
      return (this.db.prepare('SELECT count FROM rate_limits WHERE key=?').get(key) as {count:number}).count<=max;
    }).immediate();
  }
  close() { this.db.close(); }
}
