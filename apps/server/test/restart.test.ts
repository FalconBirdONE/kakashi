import { afterEach,describe,expect,it,vi } from 'vitest';
import { createTrust,createCtx } from '@kakashi/trust';
import { createContext } from '../src/orchestrator/context.js';
import { createReconciler } from '../src/workers/reconciler.js';
import { createDeps } from '../src/wiring.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draftBody } from './helpers.js';

const cleanup:(()=>void)[]=[];afterEach(()=>{for(const f of cleanup.splice(0))f();});
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'tb-restart-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));
 const env={DB_PATH:join(dir,'trust.sqlite'),AGENT_ACCOUNT_ID:'0.0.2000',PERMIT_SECRET:'ab'.repeat(32),MERCHANT_QUICKCAST_PAYTO:'0.0.3001'};
 let db=createCtx(env);cleanup.push(()=>{try{db.db.close();}catch{}});
 const deps=await createDeps([],{},()=>{});deps.trust=createTrust(env,{ctx:db});deps.modes.trust='real';
 const m=deps.trust.createMandateDraft('owner',draftBody() as any);db.db.prepare("UPDATE mandates SET state='ACTIVE' WHERE id=?").run(m.id);
 const run=deps.trust.createRun('owner','weather?');
 const fq=await deps.rails.fetchQuote('quickcast',{});if(!fq.ok)throw new Error('quote');
 const q=deps.trust.recordQuote(run.id,{...fq.quote,payTo:'0.0.3001'}),p=deps.trust.proposePurchase(q.id,{action:'BUY',needId:'n',reasonCode:'FILLS_NEED',expectedUsefulness:1,rationale:'test'});
 const auth=deps.trust.authorize(p.id);if(auth.kind!=='PERMIT')throw new Error(JSON.stringify(auth));
 deps.trust.updateRun(run.id,{plan:{needs:[{needId:'n',description:'forecast',priority:1}],query:{lat:19,lon:72,startDate:'2026-11-06',endDate:'2026-11-07'}},state:'PARTIAL',answer:{answer:'Waiting for evidence',confidence:'low',citations:[],gaps:['pending'],disagreements:[],suspiciousContent:[]}});
 const restart=()=>{db.db.close();db=createCtx(env);deps.trust=createTrust(env,{ctx:db});return createContext(deps);};
 return {deps,run,q,p,permit:auth.permit,restart,get db(){return db;}};
}
describe('payment stage restart recovery',()=>{
 it.each(['RESERVED','SIGNED','SUBMITTED','UNKNOWN'] as const)('recovers %s using the existing transaction and resumes the answer once',async(stage)=>{
  const s=await setup(),tx=`0.0.2000@${Math.floor(Date.now()/1000)}.000000001`;
  if(stage!=='RESERVED')s.deps.trust.transition(s.p.id,'SIGNED',{hederaTxId:tx});
  if(stage==='SUBMITTED'||stage==='UNKNOWN')s.deps.trust.transition(s.p.id,'SUBMITTED');
  if(stage==='UNKNOWN')s.deps.trust.transition(s.p.id,'UNKNOWN');
  s.db.db.prepare("UPDATE purchases SET updated_at=? WHERE id=?").run(new Date(Date.now()-25000).toISOString(),s.p.id);
  s.deps.rails.signerStatus=async()=>({state:'SIGNED',hederaTxId:tx,paymentHeader:'original'});
  const sign=vi.spyOn(s.deps.rails,'signPayment');
  const check=vi.spyOn(s.deps.rails,'checkSettlement').mockResolvedValue('SUCCESS');
  vi.spyOn(s.deps.rails,'recoverDelivery').mockResolvedValue({ok:true,body:{verified:'evidence'}});
  vi.spyOn(s.deps.rails,'validateDelivery').mockReturnValue({valid:true,issues:[]});
  const synth=vi.spyOn(s.deps.brain,'synthesize');
  let ctx=s.restart();
  expect(s.deps.trust.persistence!.permit(s.p.id)?.permitId).toBe(s.permit.permitId);
  await createReconciler(ctx,{autoStart:false}).tick();
  const view=s.deps.trust.getRunView(s.run.id);
  expect(view.purchases[0]?.state).toBe('CONFIRMED');expect(view.purchases[0]?.delivery).toBe('RECOVERED');
  expect(view.run.answer?.citations).toContain(s.p.id);expect(sign).not.toHaveBeenCalled();expect(check).toHaveBeenCalled();
  expect(s.deps.trust.getLedgerView('owner').spentAtomic).toBe('10000');
  ctx=s.restart();await createReconciler(ctx,{autoStart:false}).tick();expect(synth).toHaveBeenCalledTimes(1);expect(s.deps.trust.persistence!.evidence(s.p.id)).toEqual({verified:'evidence'});
 });
 it('retries delivery after confirmation and leaves ambiguous signer outcomes reserved',async()=>{
  const s=await setup();s.deps.rails.signerStatus=async()=>({state:'SIGNING'});
  let ctx=s.restart();await createReconciler(ctx,{autoStart:false}).tick();expect(s.deps.trust.getRunView(s.run.id).purchases[0]?.state).toBe('RESERVED');
  const tx=`0.0.2000@${Math.floor(Date.now()/1000)}.000000001`;
  s.deps.trust.transition(s.p.id,'SIGNED',{hederaTxId:tx});s.deps.trust.transition(s.p.id,'SUBMITTED');s.deps.trust.transition(s.p.id,'CONFIRMED');
  const recover=vi.spyOn(s.deps.rails,'recoverDelivery').mockResolvedValueOnce({ok:false}).mockResolvedValue({ok:true,body:{data:'recovered'}});
  vi.spyOn(s.deps.rails,'validateDelivery').mockReturnValue({valid:true,issues:[]});
  ctx=s.restart();const worker=createReconciler(ctx,{autoStart:false});await worker.tick();expect(s.deps.trust.getRunView(s.run.id).purchases[0]?.delivery).toBe('NOT_RECEIVED');await worker.tick();expect(recover).toHaveBeenCalledTimes(2);expect(s.deps.trust.getRunView(s.run.id).purchases[0]?.delivery).toBe('RECOVERED');
 });
 it('releases a never-signed expired permit only after signer confirms NOT_FOUND',async()=>{
  const s=await setup();s.deps.rails.signerStatus=async()=>({state:'NOT_FOUND'});
  await createReconciler(s.restart(),{autoStart:false,now:()=>Date.parse(s.permit.expiresAt)+1}).tick();
  expect(s.deps.trust.getRunView(s.run.id).purchases[0]?.state).toBe('FAILED_FINAL');expect(s.deps.trust.getLedgerView('owner').reservedAtomic).toBe('0');
 });
});
