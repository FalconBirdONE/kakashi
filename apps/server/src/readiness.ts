import { brainEnv,railsEnv,trustEnv,decimal,cmpD } from '@kakashi/contracts';

/** Local validation only: startup never spends or sends a credential to test availability. */
export function validateComponents(names:readonly string[],env:NodeJS.ProcessEnv):void {
  for(const name of names){
    const schema=name==='brain'?brainEnv:name==='rails'?railsEnv:trustEnv;
    const result=schema.safeParse({...env,WORLD_ISSUER:env.WORLD_ISSUER||'https://auth.world.org'});
    if(!result.success)throw new Error(`Invalid ${name} configuration: ${result.error.issues.map(i=>i.path.join('.')).join(', ')}`);
  }
  if(names.includes('brain')){
    const limit=decimal(env.INFERENCE_LIMIT??''),ceiling=decimal(env.INFERENCE_MAX_REQUEST_COST??'');
    if(cmpD(ceiling,'0')<=0||cmpD(ceiling,limit)>0)throw new Error('Invalid inference admission budget');
    if(env.NODE_ENV==='production'&&(env.ZG_TRUST_MODE!=='private'||env.ZG_VERIFY_TEE!=='true'))throw new Error('Production inference requires private TEE verification');
  }
  if(env.NODE_ENV==='production'){
    if(env.DEMO_MODE!=='false')throw new Error('Production requires DEMO_MODE=false');
    if(env.LIVE_DEMO==='true')throw new Error('Production forbids LIVE_DEMO');
    if(!env.DB_PATH||env.DB_PATH===':memory:'||!env.AUTH_DB_PATH||env.AUTH_DB_PATH===':memory:')throw new Error('Persistent database paths are required');
    if(env.PAYMENTS_ENABLED==='true'){
      if(!['rails','brain','trust'].every(n=>names.includes(n)))throw new Error('Payments require all real components');
      if(!env.LOGIN_ISSUER||!env.LOGIN_CLIENT_ID||!env.LOGIN_CLIENT_SECRET||!env.LOGIN_REDIRECT_URI)throw new Error('Configure invite-only sign-in before enabling payments');
      if(env.PRODUCTION_CHECKS_PASSED!=='true')throw new Error('Payment access remains gated pending production checks');
    }
    for(const key of ['LOGIN_ISSUER','LOGIN_REDIRECT_URI','WORLD_ISSUER','ZG_BASE_URL'])if(env[key]&&new URL(env[key]!).protocol!=='https:')throw new Error(`${key} requires HTTPS`);
  }
}
