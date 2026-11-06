import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS, createCtx } from "../src/db";
import { createMandateDraft } from "../src/mandates";
import { activate, cleanup, draft, makeFx, propose, setup } from "./helpers";

afterEach(cleanup);

describe("db", () => {
  it("migrations are idempotent across reopen", () => {
    const fx = makeFx();
    fx.ctx.db.close();
    for (let i = 0; i < 2; i++) {
      const c = createCtx({ DB_PATH: fx.path, AGENT_ACCOUNT_ID: "0.0.2000" });
      c.db.close();
    }
    const c = createCtx({ DB_PATH: fx.path });
    const rows = c.db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
    c.db.close();
    expect(rows).toEqual(MIGRATIONS.map((m) => ({ version: m.version })));
  });

  it("sets foreign_keys=1 and journal_mode=wal on a file db", () => {
    const fx = makeFx();
    expect(fx.ctx.db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(fx.ctx.db.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  const user = (fx: ReturnType<typeof makeFx>, id: string) =>
    fx.ctx.db.prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, 'x', 't')").run(id);

  it("UNIQUE (iss, sub)", () => {
    const fx = makeFx();
    user(fx, "u1"); user(fx, "u2");
    const ins = fx.ctx.db.prepare("INSERT INTO world_identities (user_id, iss, sub, linked_at) VALUES (?, ?, ?, 't')");
    ins.run("u1", "iss", "sub");
    expect(() => ins.run("u2", "iss", "sub")).toThrow(/UNIQUE/);
  });

  it("one world_identity per user", () => {
    const fx = makeFx();
    user(fx, "u1");
    const ins = fx.ctx.db.prepare("INSERT INTO world_identities (user_id, iss, sub, linked_at) VALUES (?, ?, ?, 't')");
    ins.run("u1", "iss", "sub1");
    expect(() => ins.run("u1", "iss", "sub2")).toThrow(/UNIQUE/);
  });

  it("approvals.attempt_id is unique", () => {
    const fx = makeFx();
    user(fx, "u1");
    fx.ctx.db.prepare(
      "INSERT INTO auth_attempts (id, user_id, purpose, target_hash, started_at, expires_at, result, device_code_ref, verification_uri, user_code) VALUES ('att_1','u1','ACTIVATE_MANDATE','h','t','t','PENDING','d','u','c')",
    ).run();
    const ins = fx.ctx.db.prepare("INSERT INTO approvals (id, attempt_id, purpose, target_hash, decision, created_at, expires_at) VALUES (?, 'att_1', 'ACTIVATE_MANDATE', 'h', 'APPROVED', 't', 't')");
    ins.run("apv_1");
    expect(() => ins.run("apv_2")).toThrow(/UNIQUE/);
  });

  it("purchases(run_id, quote_id) is unique", () => {
    const fx = makeFx();
    const { run } = setup(fx);
    const { purchase } = propose(fx, run.id);
    expect(() => fx.ctx.db.prepare(
      `INSERT INTO purchases (id, run_id, quote_id, quote_hash, mandate_id, mandate_version, state, delivery, purchase_hash, created_at, updated_at)
       SELECT 'pur_dup', run_id, quote_id, quote_hash, mandate_id, mandate_version, state, delivery, purchase_hash, created_at, updated_at FROM purchases WHERE id = ?`,
    ).run(purchase.id)).toThrow(/UNIQUE/);
  });

  it("partial unique index: one ACTIVE mandate per user, many DRAFT/REVOKED", () => {
    const fx = makeFx();
    const a = createMandateDraft(fx.ctx, "usr_a", draft(fx));
    const b = createMandateDraft(fx.ctx, "usr_a", draft(fx));
    expect(a.id).not.toBe(b.id);
    activate(fx, a);
    expect(() => activate(fx, b)).toThrow(/UNIQUE/);
    const set = fx.ctx.db.prepare("UPDATE mandates SET state = ? WHERE id = ?");
    set.run("REVOKED", a.id);
    set.run("REVOKED", b.id);
    set.run("DRAFT", a.id);
    set.run("DRAFT", b.id);
    // another user may have their own ACTIVE one
    const c = createMandateDraft(fx.ctx, "usr_b", draft(fx));
    activate(fx, c);
    expect(fx.ctx.db.prepare("SELECT COUNT(*) AS n FROM mandates WHERE state='ACTIVE'").get()).toEqual({ n: 1 });
  });
});
