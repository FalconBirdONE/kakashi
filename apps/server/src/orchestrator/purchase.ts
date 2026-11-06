import type { SigningPermit as Permit } from '@kakashi/contracts';
import type { OrchContext } from './context.js';
import { planQuery } from './util.js';

type Signed={paymentHeader:string;hederaTxId:string};
/** Recover the same signature/transaction; never mint a second payment for a purchase. */
export async function executePurchase(ctx:OrchContext,purchaseId:string,permit:Permit,recovered?:Signed):Promise<void>{
 const {rails,trust}=ctx.deps,idx=ctx.purchases.get(purchaseId);
 if(!idx||ctx.inflight.has(purchaseId))return;
 ctx.inflight.add(purchaseId);
 const emit=()=>ctx.bus.emit({runId:idx.runId,kind:'purchase',entityId:purchaseId});
 try{
  const view=trust.getRunView(idx.runId),p=view.purchases.find(p=>p.id===purchaseId),q=view.quotes.find(q=>q.id===p?.quoteId);
  if(!p||!q||!['RESERVED','SIGNED','SUBMITTED','UNKNOWN'].includes(p.state))return;
  rails.restoreRequest?.(q,planQuery(view));
  let signed=recovered;
  if(!signed){
   if(p.state!=='RESERVED')return;
   const status=await rails.signerStatus?.(permit);
   if(status?.state==='SIGNED')signed=status;
   else if(status && !['NOT_FOUND','FAILED','REFUSED'].includes(status.state))return;
   else if(status?.state==='FAILED'||status?.state==='REFUSED'){trust.transition(purchaseId,'FAILED_FINAL');emit();return;}
   else {
    const result=await rails.signPayment(permit,q.rawRequirements);
    if(!result.ok){
     // A network error/refusal can follow a completed signature. Real mode must query durable status.
     if(!rails.signerStatus)trust.transition(purchaseId,'FAILED_FINAL');
     emit();return;
    }
    signed=result;
   }
  }
  if(p.hederaTxId && p.hederaTxId!==signed.hederaTxId)throw new Error('SIGNER_TRANSACTION_CONFLICT');
  if(p.state==='RESERVED')trust.transition(purchaseId,'SIGNED',{hederaTxId:signed.hederaTxId});
  if(p.state==='RESERVED'||p.state==='SIGNED')trust.transition(purchaseId,'SUBMITTED');
  emit();
  let res:Awaited<ReturnType<typeof rails.submitPaidRequest>>;
  try{res=await rails.submitPaidRequest(q,signed.paymentHeader);}catch{res={outcome:'NO_RESPONSE'};}
  if(res.outcome==='SETTLED'&&res.settlement?.transaction===signed.hederaTxId){
   trust.transition(purchaseId,'CONFIRMED',{settlement:res.settlement});
   const v=rails.validateDelivery(q.merchantId,planQuery(view),res.body);
   if(v.valid){trust.persistence?.saveEvidence(purchaseId,res.body);ctx.evidence.set(purchaseId,res.body);}
   trust.setDelivery(purchaseId,v.valid?'RECEIVED_VALID':'RECEIVED_INVALID',v.issues);
  }else if(res.outcome==='SETTLED'||res.outcome==='NO_RESPONSE'){
   const current=trust.getRunView(idx.runId).purchases.find(x=>x.id===purchaseId)!;
   if(current.state==='SUBMITTED')trust.transition(purchaseId,'UNKNOWN');
  }
  emit();
 }catch(e){console.error('[orchestrator] purchase requires recovery:',e instanceof Error?e.message:'unknown error');}
 finally{ctx.inflight.delete(purchaseId);}
}
