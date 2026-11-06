import { describe,expect,it } from 'vitest';
import { z } from 'zod';
import { callStructured } from '../src/client.js';
import { addD,decimal } from '@tollbooth/contracts';

const env={ZG_API_KEY:'test',ZG_MODEL:'test',ZG_BASE_URL:'https://controlled.invalid/v1'};
const response=(cost:unknown,content='{"a":1}')=>new Response(JSON.stringify({choices:[{message:{content}}],x_0g_trace:{request_id:'req',tee_verified:true,billing:{total_cost:cost}}}),{status:200,headers:{'content-type':'application/json'}});
const opts={kind:'PLAN' as const,system:'test',user:'test',schema:z.object({a:z.number()})};
describe('request accounting',()=>{
 it('normalizes tiny/exponent costs and uses exact addition',async()=>{
   const r=await callStructured(opts,{env,fetch:async()=>response('0.00000001')});
   expect(r.trace?.totalCost).toBe('0.00000001');expect(decimal('1e-8')).toBe('0.00000001');expect(addD('0.1','0.2')).toBe('0.3');
 });
 it('retains the billed original request when repair fails and records unknown billing explicitly',async()=>{
   let n=0;const recorded:unknown[]=[];
   const r=await callStructured(opts,{env,fetch:async()=>++n===1?response('0.003','invalid'):new Response('error',{status:500}),accounting:{reserve:()=>{},record:t=>recorded.push(t)}});
   expect(r.ok).toBe(false);expect(r.trace?.totalCost).toBe('0.003');expect(recorded).toHaveLength(2);
   expect(r.attempts?.map(t=>t.billingState)).toEqual(['CONFIRMED','UNKNOWN']);expect(r.attempts?.[0]?.requestKey).not.toBe(r.attempts?.[1]?.requestKey);
 });
 it('admits each retry separately, stopping when unknown billing holds the budget',async()=>{
   let calls=0;
   const r=await callStructured(opts,{env:{...env,INFERENCE_LIMIT:'0.01',INFERENCE_MAX_REQUEST_COST:'0.01'},sleep:async()=>{},fetch:async()=>{calls++;return new Response(JSON.stringify({error:{code:'no_provider_for_trust_mode'}}),{status:503,headers:{'content-type':'application/json'}});}});
   expect(calls).toBe(1);expect(!r.ok&&r.error).toBe('BUDGET_EXCEEDED');expect(r.attempts?.[0]?.billingState).toBe('UNKNOWN');
 });
});
