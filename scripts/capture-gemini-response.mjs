import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const profile = path.join(os.homedir(), '.arena-webbridge', 'gemini-profile');
const dump = `(() => {
  function meta(el){ if(!el) return null; return {tag:el.tagName,id:el.id||undefined,testid:el.getAttribute('data-testid')||el.getAttribute('data-test-id')||undefined,aria:el.getAttribute('aria-label')||undefined,role:el.getAttribute('role')||undefined,dataIsStreaming:el.getAttribute('data-is-streaming')||undefined,ariaBusy:el.getAttribute('aria-busy')||undefined,mattooltip:el.getAttribute('mattooltip')||undefined,text:((el.innerText||el.value||el.textContent||'')+'').trim().slice(0,600)||undefined,cls:(el.className?String(el.className):'').slice(0,260)||undefined,html:(el.outerHTML||'').slice(0,1500)}; }
  function q(sel){ try{return Array.from(document.querySelectorAll(sel));}catch(e){return [];} }
  return {
    url: location.href, title: document.title,
    bodyText: ((document.body&&document.body.innerText)||'').slice(0,18000),
    streaming: q('[data-is-streaming],[aria-busy="true"],[class*="streaming"],[class*="loading-indicator"],button[aria-label*="Stop"],button[mattooltip*="Stop"]').slice(0,50).map(meta),
    messages: q('model-response,message-content,user-query,.model-response-text,.query-text,[class*="response-container"],[class*="model-response"],[data-testid*="message"]').slice(0,120).map(meta),
    sendStop: q('button').filter(e=>/send|stop|submit/i.test(((e.getAttribute('aria-label')||'')+' '+(e.getAttribute('mattooltip')||'')+' '+(e.getAttribute('data-testid')||'')))).slice(0,30).map(meta),
  };
})()`;
const context = await chromium.launchPersistentContext(profile, { channel:'chrome', headless:false, viewport:{width:1440,height:1000}, args:['--disable-blink-features=AutomationControlled'] });
const page = context.pages()[0] || await context.newPage();
await page.goto('https://gemini.google.com/app', { waitUntil:'domcontentloaded', timeout:60000 }).catch(()=>{});
await page.waitForTimeout(3500);
const editor = page.locator('.ql-editor[contenteditable="true"][aria-label*="prompt"], .ql-editor[contenteditable="true"], rich-textarea .ql-editor').first();
await editor.click();
await page.keyboard.insertText('Reply with exactly: GEMINI_OK');
await page.waitForTimeout(700);
// find send button
const sendSelectors = [
  'button[aria-label="Send message"]','button[aria-label*="Send"]','button[mattooltip="Send message"]','button[mattooltip*="Send"]','button[data-testid*="send"]','button.send-button','button[aria-label*="Submit"]'
];
let clicked=false;
for (const sel of sendSelectors) {
  const loc = page.locator(sel).first();
  if (await loc.count() && await loc.isVisible().catch(()=>false)) {
    const dis = await loc.isDisabled().catch(()=>false);
    const ad = await loc.getAttribute('aria-disabled').catch(()=>null);
    console.log('try send', sel, 'disabled=', dis, ad);
    if (!dis && ad!=='true') { await loc.click().catch(()=>{}); clicked=true; break; }
  }
}
if (!clicked) { console.log('send fallback Enter'); await page.keyboard.press('Enter'); }
for (let i=0;i<120;i++) {
  await page.waitForTimeout(1000);
  const text = await page.evaluate(()=>document.body.innerText||'').catch(()=>'');
  const has = text.includes('GEMINI_OK');
  const streaming = await page.locator('button[aria-label*="Stop"], button[mattooltip*="Stop"], .loading-indicator, [class*="stop"]').count().catch(()=>0);
  if (i % 3 === 0) console.log('wait', i, 'has=', has, 'streaming=', streaming);
  if (has && streaming === 0) break;
  if (i > 20 && has) break;
}
await page.waitForTimeout(1500);
const info = await page.evaluate(dump).catch(e=>({error:String(e),url:page.url()}));
fs.writeFileSync('/tmp/gemini-response.json', JSON.stringify(info,null,2));
await page.screenshot({path:'/tmp/gemini-response.png', fullPage:true}).catch(()=>{});
console.log('saved response', info.url);
console.log((info.bodyText||'').slice(0,3500).replace(/\s+/g,' '));
await context.close();
