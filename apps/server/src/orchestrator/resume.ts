import { canonicalJson,sha256Hex } from '@kakashi/contracts';
import type { OrchContext } from './context.js';
const active=new WeakMap<OrchContext,Set<string>>();
/** Revision key prevents repeated synthesis after restart. Evidence and progress are durable. */
export async function resumeSynthesis(ctx:OrchContext,runId:string):Promise<void>{
 const {trust,brain}=ctx.deps,persistence=trust.persistence;
 if(!persistence)return;
 let busy=active.get(ctx);if(!busy)active.set(ctx,(busy=new Set()));if(busy.has(runId))return;
 const v=trust.getRunView(runId);
 if(!v.run.plan||!['PARTIAL','DONE','FAILED'].includes(v.run.state))return;
 if(v.purchases.some(p=>['PROPOSED','AWAITING_APPROVAL','RESERVED','SIGNED','SUBMITTED','UNKNOWN'].includes(p.state)))return;
 const evidence=v.purchases.filter(p=>p.state==='CONFIRMED'&&['RECEIVED_VALID','RECOVERED'].includes(p.delivery)).flatMap(p=>{
  const data=persistence.evidence(p.id);return data===undefined?[]:[{purchaseId:p.id,merchantId:v.quotes.find(q=>q.id===p.quoteId)!.merchantId,valid:true,issues:p.deliveryIssues??[],data}];
 });
 if(!evidence.length)return;
 const key=sha256Hex(canonicalJson(evidence));
 // A first normal answer already includes exactly these citations; no extra paid inference required.
 if(v.run.answer&&evidence.every(e=>v.run.answer!.citations.includes(e.purchaseId)))return;
 busy.add(runId);
 try{
  if(!persistence.resumeKey(runId,key))return;
  const gaps=v.run.plan.needs.filter(n=>!v.purchases.some(p=>p.decision?.needId===n.needId&&evidence.some(e=>e.purchaseId===p.id))).map(n=>`no valid evidence for: ${n.description}`);
  const r=await brain.synthesize({question:v.run.question,preferences:trust.getPreferences(v.run.userId)?.text,evidence,gaps,accounting:{
   reserve:k=>persistence.reserveInference(runId,k,process.env.INFERENCE_MAX_REQUEST_COST??'0.01',process.env.INFERENCE_LIMIT??'0.1'),
   record:t=>{trust.recordInference({...t,runId,kind:'SYNTHESIZE'});},
  }});
  if(r.ok){trust.updateRun(runId,{answer:r.value,failureReason:undefined,state:gaps.length?'PARTIAL':'DONE',finishedAt:new Date().toISOString()});persistence.resumeKey(runId,key,true);ctx.bus.emit({runId,kind:'answer',entityId:runId});}
  else persistence.resumeKey(runId,'retry:'+key,true);
 }catch{persistence.resumeKey(runId,'retry:'+key,true);}finally{busy.delete(runId);}
}
