import { afterEach,describe,expect,it } from 'vitest';
import request from 'supertest';
import { validateComponents } from '../src/readiness.js';
import { createApp } from '../src/app.js';
import { createDeps } from '../src/wiring.js';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore } from '../src/auth/store.js';
import { cookieFor,SECRET } from './helpers.js';

const cleanup:(()=>void)[]=[];
afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn();});

describe('production gates',()=>{
 it('fails on missing real component configuration without exposing values',()=>{
  expect(()=>validateComponents(['brain'],{})).toThrow('ZG_API_KEY');
  expect(()=>validateComponents(['trust'],{})).toThrow('PERMIT_SECRET');
  expect(()=>validateComponents([],{NODE_ENV:'production',DEMO_MODE:'true'})).toThrow('DEMO_MODE');
  expect(()=>validateComponents([],{NODE_ENV:'production',DEMO_MODE:'false',LIVE_DEMO:'true'})).toThrow('LIVE_DEMO');
  expect(()=>validateComponents([],{NODE_ENV:'production',DEMO_MODE:'false',DB_PATH:'/data/trust.sqlite',AUTH_DB_PATH:'/data/auth.sqlite',PAYMENTS_ENABLED:'true'})).toThrow('all real');
 });
 it('demo mode refuses real trust/rails unless LIVE_DEMO',async()=>{
  const deps=await createDeps([],{},()=>{});deps.modes.trust='real';
  const cfg={demoMode:true,merchantsUrl:'http://127.0.0.1:4200',sessionSecret:'secret',secureCookie:false};
  expect(()=>createApp(deps,cfg)).toThrow('demo authority');
  const {app,ctx}=createApp(deps,{...cfg,liveDemo:true});cleanup.push(()=>ctx.stop());
  await request(app).post('/api/session').expect(200);
 });
 it('defaults public payment actions to disabled',async()=>{
  const deps=await createDeps([],{},()=>{}),{app}=createApp(deps,{demoMode:false,merchantsUrl:'http://127.0.0.1:4200',sessionSecret:'secret',secureCookie:false});
  await request(app).post('/api/runs').send({question:'q'}).expect(503);
  await request(app).post('/api/purchases/p/approve').expect(503);
  await request(app).post('/api/mandates/m/activate').expect(503);
 });
 it('defaults payment actions to disabled for a valid persistent session with CSRF',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tb-payment-gate-'));
  cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));
  const store=new AuthStore(join(dir,'auth.sqlite'));cleanup.push(()=>store.close());
  store.invite('payment-gate@example.test');
  const session=store.issue(store.account('issuer','payment-gate','payment-gate@example.test',true));
  const deps=await createDeps([],{},()=>{});
  // Intentionally omit paymentsEnabled so the default gate is exercised.
  const {app,ctx}=createApp(deps,{demoMode:false,merchantsUrl:'http://127.0.0.1:4200',sessionSecret:SECRET,secureCookie:false},{authStore:store});
  cleanup.push(()=>ctx.stop());
  const headers={Cookie:cookieFor(session.token),'X-CSRF-Token':session.csrf};
  const authenticated=await request(app).get('/api/session').set(headers).expect(200);
  expect(authenticated.body).toMatchObject({userId:session.userId,csrf:session.csrf});
  for(const path of ['/api/runs','/api/runs/r/rerun','/api/mandates/m/activate','/api/purchases/p/approve']){
   for(const variant of [path,path.toUpperCase(),path+'/',path.toUpperCase()+'/']){
    const response=await request(app).post(variant).set(headers).send({question:'local gate regression'}).expect(503);
    expect(response.body.error).toBe('PAYMENTS_DISABLED');
   }
  }
 });
});
