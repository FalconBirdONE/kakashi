import { afterEach,describe,expect,it } from 'vitest';
import { createTrust } from '../src/index.js';
import { createMandateVersion } from '../src/mandates.js';
import { recordInference } from '../src/purchases.js';
import { authorize,issuePermitAfterApproval } from '../src/authorize.js';
import { cleanup,makeFx,setup,propose,budget,inferenceInput,iso } from './helpers.js';
afterEach(cleanup);
const env={PERMIT_SECRET:'ab'.repeat(32),MERCHANT_QUICKCAST_PAYTO:'0.0.3001'};
describe('production money and deadlines',()=>{
 it('pins permits to the remaining quote lifetime',()=>{
   const fx=makeFx(env),{run}=setup(fx),{purchase,quote}=propose(fx,run.id);
   fx.advance(55000);const r=authorize(fx.ctx,purchase.id);
   expect(r.kind).toBe('PERMIT');if(r.kind==='PERMIT')expect(r.permit.expiresAt).toBe(quote.localExpiresAt);
 });
 it('denies late approval and releases exactly the pinned reservation',()=>{
   const fx=makeFx(env),{run,mandate}=setup(fx),{purchase}=propose(fx,run.id,'25000');
   expect(authorize(fx.ctx,purchase.id).kind).toBe('NEEDS_APPROVAL');fx.advance(61000);
   fx.ctx.db.prepare("INSERT INTO auth_attempts(id,user_id,purpose,target_hash,started_at,expires_at,result,device_code_ref,verification_uri,user_code) VALUES ('a','usr_test','APPROVE_PURCHASE',?,?,?,'VERIFIED','d','https://controlled.invalid','c')").run(purchase.purchaseHash,iso(fx.clock.t),iso(fx.clock.t+60000));
   fx.ctx.db.prepare("INSERT INTO approvals(id,attempt_id,purpose,target_hash,decision,created_at,expires_at) VALUES ('b','a','APPROVE_PURCHASE',?,'APPROVED',?,?)").run(purchase.purchaseHash,iso(fx.clock.t),iso(fx.clock.t+60000));
   expect(issuePermitAfterApproval(fx.ctx,purchase.id,'b')).toEqual({kind:'DENIED',reason:'QUOTE_EXPIRED'});expect(budget(fx,mandate).reserved).toBe('0');
 });
 it('blocks mandate edits until unresolved purchases terminate and rejects SQLite overflow',()=>{
   const fx=makeFx(env),{run,mandate}=setup(fx);propose(fx,run.id);
   expect(()=>createMandateVersion(fx.ctx,mandate.id,{})).toThrow('UNRESOLVED_PURCHASES');
   const t=createTrust(fx.ctx.env,{ctx:fx.ctx});expect(()=>t.createMandateDraft('new',{totalBudgetAtomic:'9223372036854775808',perPaymentCapAtomic:'1',autoApproveCapAtomic:'1',allowedMerchantIds:['quickcast'],expiresAt:iso(fx.clock.t+60000)})).toThrow('INVALID_MANDATE');
 });
 it('persists exact charges once and holds unknown request reservations across calls',()=>{
   const fx=makeFx(),{run}=setup(fx),p=createTrust(fx.ctx.env,{ctx:fx.ctx}).persistence!;
   p.reserveInference(run.id,'r1','0.01','0.02');
   const c=inferenceInput(run.id,{requestKey:'r1',totalCost:'0.00000001',billingState:'CONFIRMED'});
   const a=recordInference(fx.ctx,c),b=recordInference(fx.ctx,c);expect(a.id).toBe(b.id);
   p.reserveInference(run.id,'r2','0.01','0.02');recordInference(fx.ctx,inferenceInput(run.id,{requestKey:'r2',zgRequestId:'',billingState:'UNKNOWN',totalCost:'0'}));
   expect(()=>p.reserveInference(run.id,'r3','0.01','0.02')).toThrow('INFERENCE_BUDGET_EXCEEDED');
 });
});
