import { Router, type RequestHandler } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { customFetch, createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError } from '../errors.js';
import { COOKIE, issueCookie } from '../session.js';
import { AuthStore } from './store.js';

export type LoginConfig = { issuer: string; clientId: string; clientSecret: string; redirectUri: string };
export function security(store: AuthStore, demoMode: boolean): RequestHandler {
  const limits = Router();
  const limit = (category: 'session' | 'run' | 'approval'): RequestHandler => (req,res,next) => {
    if (!store.limit(`${category}:${res.locals.userId??req.ip}`,category==='run'?10:20)) throw new HttpError(429,'RATE_LIMITED','try again later');
    next();
  };
  limits.all('/session', limit('session'));
  limits.use('/auth', limit('session'));
  limits.post(['/runs', '/runs/:id/rerun'], limit('run'));
  limits.post(['/mandates/:id/activate', '/purchases/:id/approve'], limit('approval'));
  return (req,res,next) => {
    const token = req.signedCookies?.[COOKIE];
    if (typeof token === 'string') {
      const session = store.session(token);
      if (session) { res.locals.userId=session.userId; res.locals.csrf=session.csrf; }
      else if (!demoMode) delete res.locals.userId;
    }
    if (!demoMode && !['GET','HEAD','OPTIONS'].includes(req.method) && res.locals.userId) {
      const supplied = Buffer.from(req.get('X-CSRF-Token')??''), expected = Buffer.from(res.locals.csrf??'');
      if (!expected.length || supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw new HttpError(403,'CSRF','invalid CSRF token');
    }
    limits(req,res,next);
  };
}
export function authRoutes(store: AuthStore, cfg: LoginConfig|undefined, secure: boolean, transport: typeof fetch = fetch): Router {
  const r=Router();
  r.get('/session',(_req,res) => {
    if (!res.locals.userId || !res.locals.csrf) throw new HttpError(401,'UNAUTHENTICATED','sign in required');
    res.json({userId:res.locals.userId,csrf:res.locals.csrf});
  });
  r.post('/logout',(req,res)=>{ const token=req.signedCookies?.[COOKIE]; if(typeof token==='string')store.revoke(token); res.clearCookie(COOKIE,{httpOnly:true,sameSite:'lax',secure});res.json({ok:true}); });
  async function discovery() {
    if (!cfg) throw new HttpError(503,'SIGN_IN_UNCONFIGURED','sign-in provider is not configured');
    const d=await transport(cfg.issuer.replace(/\/$/,'')+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw new Error('discovery failed');return r.json();});
    if(d.issuer!==cfg.issuer)throw new Error('issuer mismatch');
    for (const key of ['authorization_endpoint','token_endpoint','jwks_uri']) if(new URL(d[key]).protocol!=='https:')throw new Error('HTTPS issuer endpoints required');
    return d;
  }
  r.get('/auth/login',async(_req,res)=>{
    const d=await discovery();
    const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    store.login(state,verifier,nonce);
    res.cookie('tb_login',state,{signed:true,httpOnly:true,sameSite:'lax',secure,maxAge:600_000});
    const url=new URL(d.authorization_endpoint);
    for(const [k,v]of Object.entries({client_id:cfg!.clientId,redirect_uri:cfg!.redirectUri,response_type:'code',scope:'openid email',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,v);
    res.redirect(url.href);
  });
  r.get('/auth/callback',async(req,res)=>{
    const state=String(req.query.state??'');
    if(!state || req.signedCookies?.tb_login!==state)throw new HttpError(403,'LOGIN_STATE','invalid login state');
    const attempt=store.consumeLogin(state);
    if(!attempt)throw new HttpError(403,'LOGIN_STATE','expired login state');
    const d=await discovery();
    const response=await transport(d.token_endpoint,{method:'POST',signal:AbortSignal.timeout(5000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:String(req.query.code??''),redirect_uri:cfg!.redirectUri,client_id:cfg!.clientId,client_secret:cfg!.clientSecret,code_verifier:attempt.verifier})});
    if(!response.ok)throw new HttpError(403,'LOGIN_FAILED','provider rejected login');
    const {id_token}=await response.json();
    const {payload}=await jwtVerify(id_token,createRemoteJWKSet(new URL(d.jwks_uri),{[customFetch]:transport}),{issuer:cfg!.issuer,audience:cfg!.clientId,algorithms:['RS256','ES256'],requiredClaims:['exp','iat','sub','nonce']});
    if(payload.nonce!==attempt.nonce || typeof payload.email!=='string' || !payload.sub)throw new HttpError(403,'LOGIN_FAILED','invalid identity claims');
    let userId:string;
    try { userId=store.account(cfg!.issuer,payload.sub,payload.email,payload.email_verified===true); }
    catch {throw new HttpError(403,'INVITE_REQUIRED','an invitation is required');}
    const session=store.issue(userId); issueCookie(res,session.token,secure);
    res.clearCookie('tb_login',{httpOnly:true,sameSite:'lax',secure});res.redirect('/');
  });
  return r;
}
