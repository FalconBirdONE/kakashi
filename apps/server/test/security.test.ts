import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrust, createCtx } from '@tollbooth/trust';
import { createApp } from '../src/app.js';
import { createDeps } from '../src/wiring.js';
import { AuthStore } from '../src/auth/store.js';
import { loadConfig } from '../src/config.js';
import { cookieFor, draftBody } from './helpers.js';

const cleanup: (()=>void)[]=[];
afterEach(()=>{for(const fn of cleanup.splice(0))fn();});

describe('persistent invite-only accounts and sessions',()=>{
  it('requires invites, persists sessions, expires and revokes them',()=>{
    const dir=mkdtempSync(join(tmpdir(),'tb-auth-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}));
    let now=1000;let store=new AuthStore(join(dir,'auth.sqlite'),()=>now);
    expect(()=>store.account('issuer','a','a@example.test',true)).toThrow('INVITE_REQUIRED');
    store.invite('a@example.test');
    expect(()=>store.account('issuer','a','a@example.test',false)).toThrow('INVITE_REQUIRED');
    const user=store.account('issuer','a','a@example.test',true),s=store.issue(user,100);
    expect(()=>store.account('issuer','b','a@example.test',true)).toThrow('INVITE_REQUIRED');
    store.close();store=new AuthStore(join(dir,'auth.sqlite'),()=>now);cleanup.push(()=>store.close());
    expect(store.session(s.token)?.userId).toBe(user);now=1100;expect(store.session(s.token)).toBeNull();
    const next=store.issue(user);store.revoke(next.token);expect(store.session(next.token)).toBeNull();
    store.login('state','verifier','nonce');expect(store.consumeLogin('state')?.nonce).toBe('nonce');expect(store.consumeLogin('state')).toBeUndefined();
    expect(store.limit('key',1)).toBe(true);expect(store.limit('key',1)).toBe(false);
  });
  it('requires a stable production secret',()=>{
    expect(()=>loadConfig({NODE_ENV:'production'})).toThrow('SESSION_SECRET');
  });
  it('isolates two actual sessions and database-owned resources, including after application restart',async()=>{
    const store=new AuthStore(':memory:');cleanup.push(()=>store.close());
    for(const email of ['a@example.test','b@example.test'])store.invite(email);
    const a=store.issue(store.account('issuer','a','a@example.test',true));
    const b=store.issue(store.account('issuer','b','b@example.test',true));
    const deps=await createDeps([],{},()=>{});
    const ctx=createCtx({DB_PATH:':memory:',AGENT_ACCOUNT_ID:'0.0.2000',PERMIT_SECRET:'ab'.repeat(32)});cleanup.push(()=>ctx.db.close());
    deps.trust=createTrust(ctx.env,{ctx});deps.modes.trust='real';
    const cfg={demoMode:false,merchantsUrl:'http://127.0.0.1:4200',sessionSecret:'test-secret',secureCookie:false};
    let app=createApp(deps,cfg,{authStore:store}).app;
    const as=(who:typeof a)=>({Cookie:cookieFor(who.token),'X-CSRF-Token':who.csrf});
    await request(app).post('/api/session').expect(404);
    await request(app).get('/api/session').set(as(a)).expect(200);
    await request(app).post('/api/mandates').set('Cookie',cookieFor(a.token)).send(draftBody()).expect(403);
    const m=(await request(app).post('/api/mandates').set(as(a)).send(draftBody()).expect(201)).body;
    ctx.db.prepare("UPDATE mandates SET state='ACTIVE' WHERE id=?").run(m.id);
    const run=deps.trust.createRun(a.userId,'weather?');
    const fq=await deps.rails.fetchQuote('quickcast',{});if(!fq.ok)throw new Error('quote');
    const q=deps.trust.recordQuote(run.id,fq.quote);
    const p=deps.trust.proposePurchase(q.id,{action:'BUY',needId:'n',reasonCode:'FILLS_NEED',expectedUsefulness:1,rationale:'test'});
    ctx.db.prepare("INSERT INTO auth_attempts(id,user_id,purpose,target_hash,started_at,expires_at,result,device_code_ref,verification_uri,user_code,target_id) VALUES ('attempt',?,'ACTIVATE_MANDATE','hash',?,?,'PENDING','dc','https://example.test','code',?)").run(a.userId,new Date().toISOString(),new Date(Date.now()+60000).toISOString(),m.id);
    app=createApp(deps,cfg,{authStore:store}).app;
    await request(app).get(`/api/runs/${run.id}`).set(as(a)).expect(200);
    await request(app).get(`/api/runs/${run.id}`).set(as(b)).expect(404);
    await request(app).post(`/api/runs/${run.id}/rerun`).set(as(b)).expect(404);
    await request(app).post(`/api/mandates/${m.id}/revoke`).set(as(b)).expect(404);
    await request(app).post(`/api/mandates/${m.id}/activate`).set(as(b)).expect(404);
    await request(app).get('/api/auth-attempts/attempt').set(as(b)).expect(404);
    await request(app).post(`/api/purchases/${p.id}/approve`).set(as(b)).expect(404);
    expect((await request(app).get('/api/purchases').set(as(b))).body.purchases).toEqual([]);
    await request(app).post('/api/logout').set(as(a)).expect(200);
    await request(app).get('/api/ledger').set(as(a)).expect(401);
    await request(app).get('/api/auth/login').expect(503);
  });
});
