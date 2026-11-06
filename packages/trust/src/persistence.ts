import { addD, cmpD } from '@kakashi/contracts';
import type { Persistence, ResourceKind } from '@kakashi/contracts';
import type { Ctx } from './db.js';
import { peekPermit } from "./permit-store.js";
import { purchaseOf, runOf } from './rows.js';

export function createPersistence(ctx: Ctx): Persistence {
  const statements: Record<ResourceKind, string> = {
    mandate: 'SELECT user_id FROM mandates WHERE id = ? ORDER BY version DESC LIMIT 1',
    run: 'SELECT user_id FROM runs WHERE id = ?',
    purchase: 'SELECT r.user_id FROM purchases p JOIN runs r ON r.id=p.run_id WHERE p.id = ?',
    attempt: 'SELECT user_id FROM auth_attempts WHERE id = ?',
  };
  return {
    owner: (kind, id) => (ctx.db.prepare(statements[kind]).get(id) as {user_id: string} | undefined)?.user_id ?? null,
    reserveInference: (runId,key,maxCost,limit) => ctx.db.transaction(()=>{
      const costs=ctx.db.prepare("SELECT total_cost AS amount FROM inference_calls WHERE run_id=? AND billing_state='CONFIRMED' UNION ALL SELECT amount FROM inference_reservations WHERE run_id=?").all(runId,runId) as {amount:string}[];
      const used=costs.reduce((sum,r)=>addD(sum,r.amount),'0');
      if(cmpD(addD(used,maxCost),limit)>0)throw new Error('INFERENCE_BUDGET_EXCEEDED');
      ctx.db.prepare('INSERT INTO inference_reservations VALUES (?,?,?)').run(key,runId,maxCost);
    }).immediate(),
    permit: id => peekPermit(ctx,id),
    evidence: id => {const r=ctx.db.prepare('SELECT payload FROM evidence WHERE purchase_id=?').get(id) as {payload:string}|undefined;return r?JSON.parse(r.payload):undefined;},
    saveEvidence: (id,data) => {
      const payload=JSON.stringify(data);if(!payload||Buffer.byteLength(payload)>1024*1024)throw new Error('EVIDENCE_TOO_LARGE');
      ctx.db.prepare('INSERT INTO evidence VALUES (?,?,?) ON CONFLICT(purchase_id) DO UPDATE SET payload=excluded.payload,created_at=excluded.created_at').run(id,payload,ctx.now().toISOString());
    },
    audit: id => {
      const rows=ctx.db.prepare("SELECT state,topic_id,sequence_number FROM audit_events WHERE json_extract(payload,'$.pur')=? ORDER BY seq DESC").all(id) as {state:string;topic_id:string;sequence_number:number}[];
      if(rows.some(r=>r.state!=='ANCHORED'))return {state:'PENDING'};
      return rows[0]?{state:'ANCHORED',topicId:rows[0].topic_id,sequenceNumber:rows[0].sequence_number}:{state:'UNKNOWN'};
    },
    pendingAttempts: () => (ctx.db.prepare("SELECT id,purpose,target_id,expires_at FROM auth_attempts WHERE result='PENDING'").all() as {id:string;purpose:string;target_id:string;expires_at:string}[]).map(r=>({id:r.id,purpose:r.purpose,targetId:r.target_id,expiresAt:r.expires_at})),
    recoveryPurchases: () => ctx.db.prepare("SELECT * FROM purchases WHERE state IN ('AWAITING_APPROVAL','RESERVED','SIGNED','SUBMITTED','UNKNOWN') OR (state='CONFIRMED' AND delivery='NOT_RECEIVED')").all().map(r=>purchaseOf(r as Record<string,any>)),
    resumeKey: (id,key,complete=false) => ctx.db.transaction(()=>{
      const row=ctx.db.prepare('SELECT resume_key FROM runs WHERE id=?').get(id) as {resume_key:string|null}|undefined;
      if(!row)return false;
      if(complete){ctx.db.prepare('UPDATE runs SET resume_key=? WHERE id=?').run(key,id);return true;}
      if(row.resume_key===key)return false;
      const pending=/^pending:(\d+):/.exec(row.resume_key??'');
      if(pending && ctx.now().getTime()-Number(pending[1])<300000)return false;
      ctx.db.prepare('UPDATE runs SET resume_key=? WHERE id=?').run('pending:'+ctx.now().getTime()+':'+key,id);return true;
    }).immediate(),
    runs: () => ctx.db.prepare('SELECT * FROM runs ORDER BY started_at').all().map(r => runOf(r as Record<string, any>)),
  };
}
