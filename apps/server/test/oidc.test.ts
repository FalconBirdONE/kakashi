import { describe,expect,it } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { generateKeyPair,exportJWK,SignJWT } from 'jose';
import { AuthStore } from '../src/auth/store.js';
import { authRoutes,security } from '../src/auth/routes.js';
import { errorHandler } from '../src/errors.js';

describe('OIDC authorization code sign-in with controlled responses',()=>{
 it('binds PKCE, nonce and browser state; admits an invited identity and rejects state replay',async()=>{
  const store=new AuthStore(':memory:');store.invite('invited@example.test');
  const keys=await generateKeyPair('RS256'),jwk=await exportJWK(keys.publicKey);jwk.kid='test';
  const cfg={issuer:'https://idp.controlled.invalid',clientId:'client',clientSecret:'test',redirectUri:'https://app.controlled.invalid/api/auth/callback'};
  let nonce='',challenge='';
  const transport:typeof fetch=async(input,init)=>{
   const u=new URL(String(input));
   if(u.pathname.includes('openid-configuration'))return Response.json({issuer:cfg.issuer,authorization_endpoint:cfg.issuer+'/authorize',token_endpoint:cfg.issuer+'/token',jwks_uri:cfg.issuer+'/jwks'});
   if(u.pathname==='/jwks')return Response.json({keys:[jwk]});
   if(u.pathname==='/token'){
    const body=new URLSearchParams(String(init?.body));
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge);
    const token=await new SignJWT({nonce,email:'invited@example.test',email_verified:true}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('subject').setIssuer(cfg.issuer).setAudience(cfg.clientId).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    return Response.json({id_token:token});
   }
   throw new Error('external request forbidden');
  };
  const app=express();app.use(cookieParser('stable-test-secret'));app.use(security(store,false));app.use(authRoutes(store,cfg,false,transport));app.use(errorHandler);
  const agent=request.agent(app);
  try{
   const start=await agent.get('/auth/login').expect(302),url=new URL(start.headers.location);
   nonce=url.searchParams.get('nonce')!;challenge=url.searchParams.get('code_challenge')!;
   expect(url.searchParams.get('code_challenge_method')).toBe('S256');
   const state=url.searchParams.get('state')!;
   await request(app).get('/auth/callback').query({state,code:'code'}).expect(403);
   await agent.get('/auth/callback').query({state,code:'code'}).expect(302);
   const session=(await agent.get('/session').expect(200)).body;expect(session.userId).toMatch(/^usr_/);expect(session.csrf).toBeTruthy();
   await agent.get('/auth/callback').query({state,code:'code'}).expect(403);
   await agent.post('/logout').expect(403);await agent.post('/logout').set('X-CSRF-Token',session.csrf).expect(200);await agent.get('/session').expect(401);
  }finally{store.close();}
 });
});
