// Test-only stack. No environment secrets are read. Unknown external requests fail closed.
import express from 'express';
import cookieParser from 'cookie-parser';
import { createRequire } from 'node:module';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportJWK,generateKeyPair,SignJWT } from 'jose';
import { createCtx,createTrust } from '@kakashi/trust';
import { MERCHANT_REGISTRY } from '@kakashi/contracts';
import { createFunctions } from '../../../packages/brain/dist/functions.js';
import { createWorldClient } from '../../../packages/trust/dist/world/client.js';
import { createRails,toMirrorTxId } from '@kakashi/rails';
import { createApp } from '../dist/app.js';
import { AuthStore } from '../dist/auth/store.js';
import { issueCookie } from '../dist/session.js';
import { startWorkers } from '../dist/workers/index.js';
import { createSigner,hederaPaymentBuilder } from '../../signer/dist/sign.js';
import { openPermitStore } from '../../signer/dist/store.js';
const signerRequire=createRequire(new URL('../../signer/package.json',import.meta.url));
const {PrivateKey,inspectHederaTransaction}=await import(signerRequire.resolve('@x402/hedera'));
const {encodePaymentRequiredHeader,encodePaymentResponseHeader,decodePaymentSignatureHeader}=await import(signerRequire.resolve('@x402/core/http'));

export async function controlledStack(){
 const dir=await mkdtemp(join(tmpdir(),'tb-controlled-')),secret='ab'.repeat(32),sessionSecret='controlled-session-secret-32-characters';
 const env={DB_PATH:join(dir,'trust.sqlite'),AGENT_ACCOUNT_ID:'0.0.2000',PERMIT_SECRET:secret,
  MERCHANT_QUICKCAST_PAYTO:'0.0.3001',MERCHANT_HOURLYPRO_PAYTO:'0.0.3002',MERCHANT_GROUNDTRUTH_PAYTO:'0.0.3003',MERCHANT_GOUGER_PAYTO:'0.0.3004',
  HEDERA_OPERATOR_ID:'0.0.2001',HEDERA_OPERATOR_KEY:'01'.repeat(32),HCS_TOPIC_ID:'0.0.4000',
  MERCHANTS_URL:'https://merchant.controlled.invalid',SIGNER_URL:'https://signer.controlled.invalid',MIRROR_NODE_URL:'https://mirror.controlled.invalid',
  WORLD_ISSUER:'https://world.controlled.invalid',WORLD_CLIENT_ID:'controlled',WORLD_CLIENT_SECRET:'controlled',
  ZG_API_KEY:'controlled',ZG_MODEL:'controlled',ZG_BASE_URL:'https://zg.controlled.invalid/v1',INFERENCE_LIMIT:'0.1',INFERENCE_MAX_REQUEST_COST:'0.01'};
 const keys=await generateKeyPair('RS256'),jwk=await exportJWK(keys.publicKey);jwk.kid='controlled';
 const settled=new Map(),anchors=new Map();let sequence=0,requests=0,signatures=0,payments=0,dropNext=false,denyNext=false,deliveryFailures=0;
 const stats=()=>({requests,signatures,payments,anchored:anchors.size});
 const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
 const validData=()=>({merchant:'quickcast',source:'fixture',tokenId:'0.0.731861',generatedAt:new Date().toISOString(),flags:['ADMIN_KEY: issuer can change token settings','SUPPLY_KEY: issuer can mint more supply'],token:{name:'SAUCE',symbol:'SAUCE',decimals:6,totalSupply:'1000000000000000',maxSupply:'1000000000000000',supplyType:'FINITE',treasury:'0.0.1077627',createdAt:'2022-03-01T00:00:00.000Z',memo:'',pauseStatus:'NOT_APPLICABLE',keys:{admin:true,freeze:false,wipe:false,supply:true,pause:false,kyc:false,feeSchedule:false},customFees:{fixed:0,fractional:0,royalty:0}}});
 let db,auth,store,sign,server,ctx,stopWorkers;
 const originalBuild=hederaPaymentBuilder(env.AGENT_ACCOUNT_ID,PrivateKey.generateECDSA(),'hedera:testnet');
 const transport=async(input,init={})=>{
  const url=new URL(String(input)),headers=new Headers(init.headers);
  if(url.host==='world.controlled.invalid'){
   if(url.pathname.includes('openid-configuration'))return json({issuer:env.WORLD_ISSUER,device_authorization_endpoint:env.WORLD_ISSUER+'/device',token_endpoint:env.WORLD_ISSUER+'/token',jwks_uri:env.WORLD_ISSUER+'/jwks'});
   if(url.pathname==='/jwks')return json({keys:[jwk]});
   if(url.pathname==='/device')return json({device_code:denyNext?'deny':'approve',user_code:'CONTROLLED',verification_uri:'https://world.controlled.invalid/approve',expires_in:600,interval:1});
   if(url.pathname==='/token'){
    if(new URLSearchParams(init.body).get('device_code')==='deny'){denyNext=false;return json({error:'access_denied'},400);}
    const token=await new SignJWT({auth_time:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(env.WORLD_ISSUER).setAudience(env.WORLD_CLIENT_ID).setSubject('controlled-human').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    return json({id_token:token});
   }
  }
  if(url.host==='signer.controlled.invalid'){
   const body=JSON.parse(init.body);
   if(url.pathname==='/status')return json(sign.status(body.permit));
   if(url.pathname==='/sign'){const r=await sign(body.permit,body.requirementsB64);return r.ok?json(r):json(r,403);}
  }
  if(url.host==='mirror.controlled.invalid'){
   const item=[...settled.entries()].find(([tx])=>url.pathname.endsWith(toMirrorTxId(tx)));
   return item?json({transactions:[{result:'SUCCESS',token_transfers:[{token_id:'0.0.429274',account:'0.0.3001',amount:10000}]}]}):json({},404);
  }
  if(url.host==='merchant.controlled.invalid'){
   if(url.pathname==='/catalog')return json(MERCHANT_REGISTRY.map(({payToEnv,...m})=>m));
   if(url.pathname==='/recover'){
    if(deliveryFailures-->0)return json({},503);
    return settled.has(url.searchParams.get('tx'))?json(settled.get(url.searchParams.get('tx'))):json({},404);
   }
   const signature=headers.get('PAYMENT-SIGNATURE');
   if(!signature)return json({},402,{'PAYMENT-REQUIRED':encodePaymentRequiredHeader({x402Version:2,resource:{url:url.href},accepts:[{scheme:'exact',network:'hedera:testnet',asset:'0.0.429274',amount:'10000',payTo:'0.0.3001',maxTimeoutSeconds:60,extra:{feePayer:'0.0.9185802'}}]})});
   const payload=decodePaymentSignatureHeader(signature),tx=inspectHederaTransaction(String(payload.payload.transaction)).transactionId;
   if(!settled.has(tx)){payments++;settled.set(tx,validData());}
   if(dropNext){dropNext=false;throw new TypeError('controlled response loss after settlement');}
   return json(settled.get(tx),200,{'PAYMENT-RESPONSE':encodePaymentResponseHeader({success:true,transaction:tx,network:'hedera:testnet',payer:'0.0.2000'})});
  }
  if(url.host==='zg.controlled.invalid'){
   requests++;const body=JSON.parse(init.body),system=body.messages[0].content,user=body.messages[1].content;let value;
   if(system.includes('TASK: planning'))value={needs:[{needId:'n1',description:'Admin keys and fees',priority:1}],query:{tokenId:'0.0.731861',tradeUsd:20}};
   else if(system.includes('TASK: decide')){const input=JSON.parse(user);value={decisions:input.quotes.map(q=>({quoteId:q.quoteId,action:q.merchantId==='quickcast'?'BUY':'SKIP',needId:'n1',reasonCode:'FILLS_NEED',expectedUsefulness:1,rationale:'controlled decision'})),stop:true};}
   else value={answer:'Controlled check: CAUTION, issuer holds admin and supply keys.',confidence:'high',citations:[...user.matchAll(/purchaseId: ([^\n]+)/g)].map(m=>m[1]),gaps:[],disagreements:[],suspiciousContent:[]};
   return json({choices:[{message:{content:JSON.stringify(value)}}],x_0g_trace:{request_id:'controlled-'+requests,provider:'controlled',tee_verified:true,billing:{total_cost:'0.00000001'}}});
  }
  throw new Error('External transport forbidden in controlled stack');
 };
 async function boot(port=0){
  db=createCtx(env);auth=new AuthStore(join(dir,'auth.sqlite'));
  auth.invite('invited@controlled.invalid');const user=auth.account('controlled-login','invited','invited@controlled.invalid',true);
  store=openPermitStore(join(dir,'signer.sqlite'),secret);
  sign=createSigner({permitSecret:secret,agentAccountId:env.AGENT_ACCOUNT_ID,network:'hedera:testnet',maxPerTx:100000n,maxTotal:200000n,store,build:async(...args)=>{signatures++;return originalBuild(...args);}});
  const deps={trust:createTrust(env,{ctx:db,world:createWorldClient(env,{fetch:transport,logger:()=>{}})}),brain:createFunctions(env,{fetch:transport}),rails:createRails(env,{fetch:transport,log:()=>{},submitAudit:async message=>{
   const event=JSON.parse(message);if(!anchors.has(event.id))anchors.set(event.id,{topicId:'0.0.4000',sequenceNumber:++sequence,consensusTimestamp:`${Math.floor(Date.now()/1000)}.000000001`});return anchors.get(event.id);
  }}),fakes:{},modes:{rails:'real',brain:'real',trust:'real'}};
  const real=createApp(deps,{demoMode:false,merchantsUrl:env.MERCHANTS_URL,sessionSecret,secureCookie:false},{authStore:auth,paymentsEnabled:true,staticDir:fileURLToPath(new URL('../../web/dist',import.meta.url))});ctx=real.ctx;
  const outer=express();outer.use(cookieParser(sessionSecret));
  outer.get('/controlled/session',(_req,res)=>{const s=auth.issue(user);issueCookie(res,s.token,false);res.redirect('/');});
  outer.get('/controlled/stats',(_req,res)=>res.json(stats()));
  outer.post('/controlled/drop',(_req,res)=>{dropNext=true;deliveryFailures=1;res.json({ok:true});});
  outer.post('/controlled/deny',(_req,res)=>{denyNext=true;res.json({ok:true});});
  outer.use(real.app);
  server=await new Promise(resolve=>{const s=outer.listen(port,'127.0.0.1',()=>resolve(s));});
  stopWorkers=startWorkers(ctx);
  return server.address().port;
 }
 async function stop(){ctx.stop();stopWorkers();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));auth.close();store.close();db.db.close();}
 const port=await boot();
 return {url:`http://127.0.0.1:${port}`,stats,restart:async()=>{await stop();await boot(port);},close:async()=>{await stop();await rm(dir,{recursive:true,force:true});}};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const stack=await controlledStack();console.log(stack.url);process.on('SIGTERM',()=>stack.close().then(()=>process.exit()));process.on('SIGINT',()=>stack.close().then(()=>process.exit()));
}
