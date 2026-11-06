import { describe,it,expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MIGRATIONS,createCtx,type Ctx } from '../src/db.js';
import { createMandateDraft } from '../src/mandates.js';
import { createRun } from '../src/runs.js';
import { recordQuote,proposePurchase,transition } from '../src/purchases.js';
import { quoteInput,decision } from './helpers.js';

describe('additive migration and backup rollback',()=>{
 it('preserves a v3 reservation, migrates idempotently, and restores a readable pre-migration backup',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tb-migrate-')),path=join(dir,'trust.sqlite'),backup=join(dir,'backup.sqlite');
  let db=new Database(path);
  try{
   db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
   for(const m of MIGRATIONS.filter(m=>m.version<=3)){db.exec(m.sql);db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.version,'2030-01-01');}
   const env={DB_PATH:path,AGENT_ACCOUNT_ID:'0.0.2000',PERMIT_SECRET:'ab'.repeat(32)},now=()=>new Date('2030-01-01T00:00:00Z');
   const ctx:Ctx={db,env,now,minPriceAtomic:'10000'};
   const m=createMandateDraft(ctx,'owner',{totalBudgetAtomic:'200000',perPaymentCapAtomic:'100000',autoApproveCapAtomic:'20000',allowedMerchantIds:['quickcast'],expiresAt:'2030-01-01T01:00:00Z'});
   db.prepare("UPDATE mandates SET state='ACTIVE' WHERE id=?").run(m.id);
   const run=createRun(ctx,'owner','weather'),q=recordQuote(ctx,run.id,quoteInput()),p=proposePurchase(ctx,q.id,decision());transition(ctx,p.id,'RESERVED');
   await db.backup(backup);db.close();
   const current=createCtx(env,{now});db=current.db;
   expect(db.prepare('SELECT reserved,spent FROM mandates WHERE id=?').get(m.id)).toEqual({reserved:'10000',spent:'0'});
   expect(db.prepare('SELECT state,amount FROM purchases WHERE id=?').get(p.id)).toEqual({state:'RESERVED',amount:'10000'});
   expect(db.pragma('integrity_check',{simple:true})).toBe('ok');db.close();
   db=createCtx(env,{now}).db;expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({n:MIGRATIONS.length});db.close();
   db=new Database(backup,{readonly:true});expect(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get()).toEqual({v:3});expect(db.prepare('SELECT reserved FROM mandates WHERE id=?').get(m.id)).toEqual({reserved:'10000'});expect(db.pragma('integrity_check',{simple:true})).toBe('ok');
  }finally{try{db.close();}catch{}rmSync(dir,{recursive:true,force:true});}
 });
});
