import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { addD, cmpD, decimal, canonicalJson, sha256Hex } from '@kakashi/contracts';
import type { BrainError, InferenceKind, InferenceTrace, InferenceAttempt, InferenceAccounting, Traced } from '@kakashi/contracts';

export type CallOpts<T>={kind:InferenceKind;system:string;user:string;schema:z.ZodType<T>;maxTokens?:number};
export type ClientDeps={env?:Record<string,string|undefined>;fetch?:typeof fetch;sleep?:(ms:number)=>Promise<void>;timeoutMs?:number;accounting?:InferenceAccounting};
type Msg={role:'system'|'user'|'assistant';content:string};
type Raw={content:string;trace:InferenceAttempt};
type Fail={error:BrainError;trace?:InferenceTrace};

export async function callStructured<T>(o:CallOpts<T>,deps:ClientDeps={}):Promise<Traced<T>> {
  const env=deps.env??process.env,model=env.ZG_MODEL,apiKey=env.ZG_API_KEY,mode=env.ZG_TRUST_MODE??'private';
  const verify=(env.ZG_VERIFY_TEE??'true')!=='false';
  const attempts:InferenceAttempt[]=[];
  const fail=(f:Fail):Traced<T>=>({ok:false,...f,attempts});
  if(!apiKey||!model||!['private','verified','standard'].includes(mode))return fail({error:'ZG_UNAVAILABLE'});
  const tier=mode as InferenceTrace['trustTier'];
  const limit=decimal(env.INFERENCE_LIMIT??'0.1'),maxCost=decimal(env.INFERENCE_MAX_REQUEST_COST??'0.01');
  if(cmpD(maxCost,'0')<=0 || cmpD(maxCost,limit)>0)return fail({error:'BUDGET_EXCEEDED'});
  const client=new OpenAI({apiKey,baseURL:env.ZG_BASE_URL??'https://router-api.0g.ai/v1',maxRetries:0,timeout:deps.timeoutMs??30_000,fetch:deps.fetch,defaultHeaders:{'X-0G-Provider-Trust-Mode':mode}});
  const sleep=deps.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
  let held='0';
  const record=(trace:InferenceAttempt)=>{ attempts.push(trace);deps.accounting?.record(trace); };
  const summary=(last:InferenceAttempt):InferenceTrace=>({...last,totalCost:attempts.filter(t=>t.billingState==='CONFIRMED').reduce((s,t)=>addD(s,t.totalCost),'0'),latencyMs:attempts.reduce((s,t)=>s+t.latencyMs,0),inputHash:sha256Hex(canonicalJson({system:o.system,user:o.user}))});
  const call=async(messages:Msg[]):Promise<Raw|Fail>=>{
    for(let retry=0;;retry++){
      const requestKey=randomUUID();
      try {
        if(cmpD(addD(held,maxCost),limit)>0)return {error:'BUDGET_EXCEEDED'};
        deps.accounting?.reserve(requestKey);held=addD(held,maxCost);
      } catch {return {error:'BUDGET_EXCEEDED'};}
      const start=Date.now();
      let data:unknown,error:unknown;
      try {
        ({data}=await client.chat.completions.create({model,temperature:0.2,messages,max_tokens:o.maxTokens,verify_tee:verify,...(env.ZG_JSON_MODE==='true'?{response_format:{type:'json_object'}}:{})} as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming).withResponse());
      } catch(e) {error=e;}
      const body=data as {choices?:{message?:{content?:string}}[];x_0g_trace?:{request_id?:string;provider?:string;tee_verified?:boolean;billing?:{total_cost?:unknown;total_cost_usd_micro?:unknown}}}|undefined;
      const t=body?.x_0g_trace,content=body?.choices?.[0]?.message?.content??'';
      let cost:string|undefined;
      // The live Router reports total_cost in micro-USD (equal to total_cost_usd_micro); prefer the explicitly-unit field.
      const micro=t?.billing?.total_cost_usd_micro;
      try { if((typeof micro==='string'||typeof micro==='number')&&/^\d+$/.test(String(micro)))cost=decimal(`${micro}e-6`); else if(typeof t?.billing?.total_cost==='string'||typeof t?.billing?.total_cost==='number')cost=decimal(String(t.billing.total_cost)); } catch { /* Unknown billing keeps its admission reservation. */ }
      const trace:InferenceAttempt={requestKey,model,trustTier:tier,zgRequestId:typeof t?.request_id==='string'?t.request_id:'',provider:t?.provider??'unknown',teeVerified:t?.tee_verified??null,totalCost:cost??'0',billingState:cost===undefined?'UNKNOWN':'CONFIRMED',latencyMs:Date.now()-start,inputHash:sha256Hex(canonicalJson({messages})),outputHash:sha256Hex(content),ok:!error&&!!t?.request_id};
      if(error)trace.error=error instanceof OpenAI.APIConnectionTimeoutError?'TIMEOUT':'ZG_UNAVAILABLE';
      record(trace);
      // Local admission accounting includes actual charges and unknown reservations, across all retries/repairs.
      held=attempts.reduce((s,a)=>addD(s,a.billingState==='CONFIRMED'?a.totalCost:maxCost),'0');
      if(error){
        if(error instanceof OpenAI.APIConnectionTimeoutError)return {error:'TIMEOUT'};
        if(error instanceof OpenAI.APIError&&error.status===503&&JSON.stringify(error.error??error.message).includes('no_provider_for_trust_mode')){
          if(retry>=2)return {error:'NO_PROVIDER_FOR_TRUST_MODE'};
          await sleep(2000);continue;
        }
        return {error:'ZG_UNAVAILABLE'};
      }
      if(!t?.request_id)return {error:'ZG_UNAVAILABLE'};
      if(trace.teeVerified===false||(verify&&trace.teeVerified!==true))return {error:'TEE_NOT_VERIFIED',trace:summary(trace)};
      if(cost===undefined || cmpD(held,limit)>0)return {error:'BUDGET_EXCEEDED',trace:summary(trace)};
      return {content,trace};
    }
  };
  const parse=(content:string):{ok:true;value:T}|{ok:false;why:string}=>{
    let json:unknown;
    // TEE-verified 0gm-*-sia models emit "<reasoning></think>" before the JSON answer; parse only what follows.
    const text=content.split('</think>').pop()!.trim().replace(/^```(?:json)?\s*|\s*```$/g,''),end=text.lastIndexOf('}');
    try {json=JSON.parse(text);}catch{
      // Reasoning sometimes arrives without the closing tag: take the JSON object that ends the reply. Schema still validates it.
      for(let i=text.indexOf('{');i>=0&&i<end&&json===undefined;i=text.indexOf('{',i+1))try{json=JSON.parse(text.slice(i,end+1));}catch{/* keep scanning */}
      if(json===undefined)return {ok:false,why:'output was not valid JSON'};
    }
    const result=o.schema.safeParse(json);
    return result.success?{ok:true,value:result.data}:{ok:false,why:result.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')};
  };
  const messages:Msg[]=[{role:'system',content:o.system},{role:'user',content:o.user}];
  const a=await call(messages);
  if('error'in a)return fail(a);
  const p=parse(a.content);
  if(p.ok)return {ok:true,value:p.value,trace:summary(a.trace),attempts};
  const b=await call([...messages,{role:'assistant',content:a.content},{role:'user',content:`Your previous output was rejected: ${p.why}. Reply again with only the corrected JSON.`}]);
  if('error'in b)return fail({...b,trace:b.trace??summary(a.trace)});
  const p2=parse(b.content),trace=summary(b.trace);
  return p2.ok?{ok:true,value:p2.value,trace,attempts}:fail({error:'SCHEMA_INVALID',trace});
}
