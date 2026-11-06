import { describe,expect,it } from 'vitest';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPermitStore } from '../src/store.js';

describe('durable signature recovery',()=>{
 it('recovers the exact encrypted signature after restart and refuses a second permit for a signed purchase',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tb-signer-')),path=join(dir,'signer.sqlite'),secret='ab'.repeat(32);
  let store=openPermitStore(path,secret);
  try{
   expect(store.claim({permitId:'permit',purchaseId:'purchase',amountAtomic:'10000',refusal:null,maxTotal:20000n,at:new Date().toISOString()})).toBeNull();
   store.markSigned('permit','0.0.1@123.000000001','sensitive-signed-header');store.close();
   expect(readFileSync(path).includes(Buffer.from('sensitive-signed-header'))).toBe(false);
   store=openPermitStore(path,secret);
   expect(store.status('permit')).toEqual({state:'SIGNED',hederaTxId:'0.0.1@123.000000001',paymentHeader:'sensitive-signed-header'});
   expect(store.claim({permitId:'replacement',purchaseId:'purchase',amountAtomic:'10000',refusal:null,maxTotal:20000n,at:new Date().toISOString()})).toBe('PERMIT_REUSED');
   expect(store.totalCommitted()).toBe(10000n);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
 });
 it('retains an interrupted signing claim as uncertain instead of signing again',()=>{
  const store=openPermitStore(':memory:');
  try{store.claim({permitId:'p',purchaseId:'pur',amountAtomic:'1',refusal:null,maxTotal:2n,at:'t'});expect(store.status('p')).toEqual({state:'SIGNING'});expect(store.claim({permitId:'p2',purchaseId:'pur',amountAtomic:'1',refusal:null,maxTotal:2n,at:'t'})).toBe('PERMIT_REUSED');}finally{store.close();}
 });
});
