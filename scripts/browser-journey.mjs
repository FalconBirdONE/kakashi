import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { controlledStack } from '../apps/server/scripts/controlled-stack.mjs';
const stack=await controlledStack();
let browser,page;
try{
 browser=await chromium.launch();
 const context=await browser.newContext();page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto(stack.url+'/controlled/session');
 await page.getByRole('button',{name:'Create mandate',exact:true}).click();
 await page.getByRole('button',{name:'Activate with World ID',exact:true}).click();
 await page.getByText('Active',{exact:true}).waitFor();
 await page.getByRole('link',{name:'Research',exact:true}).click();
 await page.getByRole('textbox',{name:'Your question'}).fill('Will it rain in Mumbai?');
 await page.getByRole('button',{name:'Run',exact:true}).click();
 await page.getByText('Controlled forecast: dry weather, based on paid evidence.',{exact:true}).waitFor();
 await page.getByRole('link',{name:'[1]',exact:true}).waitFor();
 let stats=stack.stats();assert.equal(stats.payments,1);assert.equal(stats.signatures,1);assert.equal(stats.requests,3);
 await page.getByRole('link',{name:'Ledger',exact:true}).click();
 await page.getByText('0.00000003 0G credits',{exact:true}).waitFor();
 // Full server/trust/signer restart over the same databases: history, receipt and session survive.
 await stack.restart();await page.reload();
 await page.getByRole('link',{name:'History',exact:true}).click();
 await page.getByText('Will it rain in Mumbai?',{exact:true}).waitFor();
 assert.equal(stack.stats().payments,1);assert.equal(stack.stats().signatures,1);
 await page.request.post(stack.url+'/controlled/drop');
 await page.getByRole('link',{name:'Research',exact:true}).click();
 await page.getByRole('textbox',{name:'Your question'}).fill('Will it rain after recovery?');
 await page.getByRole('button',{name:'Run',exact:true}).click();
 await page.getByText('Data recovered',{exact:true}).waitFor({timeout:20000});
 await page.getByRole('link',{name:'[1]',exact:true}).waitFor();
 stats=stack.stats();assert.equal(stats.payments,2);assert.equal(stats.signatures,2);
 await page.waitForFunction(async()=>{const r=await fetch('/controlled/stats');return (await r.json()).anchored>0;});
 assert.deepEqual(errors,[]);
 await mkdir('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/controlled-journey.png',fullPage:true});
 console.log(JSON.stringify({browserJourney:'passed',...stack.stats(),externalCalls:0}));
}catch(e){
 if(page&&!page.isClosed()){
  try{await mkdir('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/controlled-failure.png',fullPage:true});console.error((await page.locator('body').innerText()).slice(0,5000));}catch(diagnostic){console.error('Could not capture browser failure:',diagnostic.message);}
 }
 throw e;
}finally{try{await browser?.close();}finally{await stack.close();}}
