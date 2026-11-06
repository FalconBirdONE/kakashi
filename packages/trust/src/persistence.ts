import { addD, cmpD } from '@tollbooth/contracts';
import type { Persistence, ResourceKind } from '@tollbooth/contracts';
import type { Ctx } from './db.js';
import { runOf } from './rows.js';

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
    runs: () => ctx.db.prepare('SELECT * FROM runs ORDER BY started_at').all().map(r => runOf(r as Record<string, any>)),
  };
}
