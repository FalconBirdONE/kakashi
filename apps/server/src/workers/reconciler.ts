import type { Purchase } from '@kakashi/contracts';
import type { OrchContext } from '../orchestrator/context.js';
import { planQuery } from '../orchestrator/util.js';
import { executePurchase } from '../orchestrator/purchase.js';
import { resumeSynthesis } from '../orchestrator/resume.js';
export type Reconciler={tick():Promise<void>;stop():void};
export function createReconciler(ctx:OrchContext,opts:{intervalMs?:number;now?:()=>number;autoStart?:boolean;allowSpending?:boolean}={}):Reconciler{
 const {trust,rails}=ctx.deps,now=opts.now??Date.now,busy=new Set<string>();
 async function handle(listed:Purchase){
  const view=trust.getRunView(listed.runId);let p=view.purchases.find(p=>p.id===listed.id)!;
  const q=view.quotes.find(q=>q.id===p.quoteId);if(!q)return;
  const emit=()=>ctx.bus.emit({runId:p.runId,kind:'purchase',entityId:p.id});
  if(p.state==='AWAITING_APPROVAL'){
   const m=trust.getLedgerView(view.run.userId).mandate;
   const deadline=Math.min(Date.parse(q.localExpiresAt),Date.parse(view.run.startedAt)+(m?.maxRunDurationSeconds??0)*1000,Date.parse(m?.expiresAt??''));
   if(!Number.isFinite(deadline)||now()>=deadline){trust.transition(p.id,'APPROVAL_DENIED');emit();}
   return;
  }
  const permit=trust.persistence?.permit(p.id);
  if(p.state==='RESERVED'){
   if(!permit || !rails.signerStatus)return; // legacy/uncertain: operator reconciliation required; never release blindly
   const status=await rails.signerStatus(permit);
   if(status.state==='SIGNED'){
    trust.transition(p.id,'SIGNED',{hederaTxId:status.hederaTxId});
    p=trust.getRunView(p.runId).purchases.find(x=>x.id===p.id)!;
   }else if(status.state==='FAILED'||status.state==='REFUSED'||(status.state==='NOT_FOUND'&&now()>=Date.parse(permit.expiresAt))){
    trust.transition(p.id,'FAILED_FINAL');emit();return;
   }else if(status.state==='NOT_FOUND'&&opts.allowSpending!==false){
    await executePurchase(ctx,p.id,permit);return;
   }else return;
  }
  if(p.state==='CONFIRMED'){
   const recovered=await rails.recoverDelivery(q.merchantId,p.hederaTxId!,q.requestHash);
   if(recovered.ok){
    const v=rails.validateDelivery(q.merchantId,planQuery(view),recovered.body);
    if(v.valid){trust.persistence?.saveEvidence(p.id,recovered.body);ctx.evidence.set(p.id,recovered.body);}
    trust.setDelivery(p.id,v.valid?'RECOVERED':'RECEIVED_INVALID',v.issues);emit();
   }
   return;
  }
  if(!p.hederaTxId||!['SIGNED','SUBMITTED','UNKNOWN'].includes(p.state))return;
  const age=now()-Date.parse(p.updatedAt);
  if(p.state!=='UNKNOWN'&&age<20_000&&listed.state!=='RESERVED')return;
  const outcome=await rails.checkSettlement(p.hederaTxId,{payTo:q.payTo,assetId:q.assetId,amountAtomic:q.amountAtomic});
  if(outcome==='SUCCESS'){
   if(p.state==='SIGNED')trust.transition(p.id,'SUBMITTED');
   trust.transition(p.id,'CONFIRMED');emit();
   await handle(trust.getRunView(p.runId).purchases.find(x=>x.id===p.id)!);
  }else if(outcome==='FAILED'||outcome==='MISMATCH'){
   trust.transition(p.id,'FAILED_FINAL');emit();
  }else{
   // Use the immutable transaction valid-start, not a restart/transition timestamp.
   const match=/@(\d+)\.(\d+)$/.exec(p.hederaTxId);
   const validStart=match?Number(match[1])*1000+Number(('0.'+match[2]))*1000:Date.parse(p.updatedAt);
   if(now()>validStart+(q.maxTimeoutSeconds+30)*1000){trust.transition(p.id,'FAILED_FINAL');emit();}
   else if(permit&&rails.signerStatus&&opts.allowSpending!==false){
    const signed=await rails.signerStatus(permit);
    if(signed.state==='SIGNED'&&signed.hederaTxId===p.hederaTxId)await executePurchase(ctx,p.id,permit,signed);
   }
  }
 }
 let running=false;
 async function tick(){
  if(running)return;running=true;
  try{
   for(const id of ctx.interruptedRuns){
    const v=trust.getRunView(id);trust.updateRun(id,{state:v.purchases.length?'PARTIAL':'FAILED',failureReason:'PROCESS_RESTART',finishedAt:new Date(now()).toISOString()});ctx.interruptedRuns.delete(id);
   }
   for(const a of trust.persistence?.pendingAttempts()??[]){
    try{await trust.pollAuth(a.id);}catch{/* retry with durable attempt next tick */}
   }
   const todo=trust.persistence?.recoveryPurchases()??trust.listUnresolved();
   for(const p of todo){
    if(busy.has(p.id)||ctx.inflight.has(p.id))continue;
    busy.add(p.id);
    try{await handle(p);}catch(e){console.error('[reconciler]',e instanceof Error?e.message:'recovery pending');}finally{busy.delete(p.id);}
   }
   if(trust.persistence&&opts.allowSpending!==false)for(const run of trust.persistence.runs())await resumeSynthesis(ctx,run.id);
  }finally{running=false;}
 }
 let timer:NodeJS.Timeout|undefined;
 if(opts.autoStart!==false){void tick();timer=setInterval(()=>void tick(),opts.intervalMs??3000);timer.unref();}
 return {tick,stop:()=>{if(timer)clearInterval(timer);}};
}
