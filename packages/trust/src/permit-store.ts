import { seal,unseal,type SigningPermit } from '@tollbooth/contracts';
import type { Ctx } from './db.js';
export function savePermit(ctx:Ctx,permit:SigningPermit):void {
  ctx.db.prepare('INSERT INTO signing_permits(purchase_id,permit_id,payload) VALUES (?,?,?)').run(permit.purchaseId,permit.permitId,seal(permit,ctx.env.PERMIT_SECRET!,'permit:'+permit.purchaseId));
}
export function peekPermit(ctx:Ctx,purchaseId:string):SigningPermit|null {
  const row=ctx.db.prepare('SELECT payload FROM signing_permits WHERE purchase_id=?').get(purchaseId) as {payload:string}|undefined;
  return row?unseal<SigningPermit>(row.payload,ctx.env.PERMIT_SECRET!,'permit:'+purchaseId):null;
}
export function collectPermit(ctx:Ctx,purchaseId:string):SigningPermit|null {
  return ctx.db.transaction(()=>{
    const row=ctx.db.prepare('SELECT collected_at FROM signing_permits WHERE purchase_id=?').get(purchaseId) as {collected_at:string|null}|undefined;
    if(!row||row.collected_at)return null;
    const permit=peekPermit(ctx,purchaseId);
    ctx.db.prepare('UPDATE signing_permits SET collected_at=? WHERE purchase_id=?').run(ctx.now().toISOString(),purchaseId);
    return permit;
  }).immediate();
}
