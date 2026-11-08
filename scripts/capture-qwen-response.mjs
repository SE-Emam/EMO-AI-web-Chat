import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const profile = path.join(os.homedir(), '.arena-webbridge', 'qwen-profile');
const dump = `(() => {
  function meta(el){ if(!el) return null; return {tag:el.tagName,id:el.id||undefined,testid:el.getAttribute('data-testid')||undefined,aria:el.getAttribute('aria-label')||undefined,role:el.getAttribute('role')||undefined,dataIsStreaming:el.getAttribute('data-is-streaming')||undefined,ariaBusy:el.getAttribute('aria-busy')||undefined,disabled:el.disabled||el.getAttribute('aria-disabled')||undefined,text:((el.innerText||el.value||el.textContent||'')+'').trim().slice(0,600)||undefined,cls:(el.className?String(el.className):'').slice(0,260)||undefined,html:(el.outerHTML||'').slice(0,1500)}; }
  function q(sel){ try{return Array.from(document.querySelectorAll(sel));}catch(e){return [];} }
  return {
    url: location.href, title: document.title,
    bodyText: ((document.body&&document.body.innerText)||'').slice(0,18000),
    streaming: q('[data-is-streaming],[aria-busy="true"],[class*="streaming"],[class*="loading"],[class*="stop"],button[aria-label*="Stop"],button[aria-label*="停止"]').slice(0,60).map(meta),
    messages: q('[class*="chat-message"],[class*="message-item"],[class*="qwen-chat-message"],[class*="response-message"],[class*="markdown-body"],.markdown-prose,[data-message-id],[id*="message"]').slice(0,120).map(meta),
    sendArea: q('.message-input-right-button-send, .message-input-right-button-send *, button').filter(e=>/send|stop|message-input-right/i.test((e.className||'')+' '+(e.getAttribute('aria-label')||''))).slice(0,40).map(meta),
  };
})()`;
const context = await chromium.launchPersistentContext(profile, { channel:'chrome', headless:false, viewport:{width:1440,height:1000}, args:['--disable-blink-features=AutomationControlled'] });
const page = context.pages()[0] || await context.newPage();
await page.goto('https://chat.qwen.ai/', { waitUntil:'domcontentloaded', timeout:60000 }).catch(()=>{});
await page.waitForTimeout(3500);
// try new chat if visible to avoid context pollution
await page.locator('button:has-text("New Chat"), [aria-label="New Chat"]').first().click({timeout:3000}).catch(()=>{});
await page.waitForTimeout(1200);
const ta = page.locator('textarea.message-input-textarea, textarea[placeholder*="help you"]').first();
await ta.click();
await ta.fill('Reply with exactly: QWEN_OK');
await page.waitForTimeout(700);
const sendCandidates = [
  '.message-input-right-button-send button',
  '.message-input-right-button-send',
  'button[aria-label*="Send"]',
  'button[aria-label*="send"]',
  'button.send-button',
  'div[class*="send"] button',
];
let clicked=false;
for (const sel of sendCandidates) {
  const loc = page.locator(sel).first();
  if (await loc.count() && await loc.isVisible().catch(()=>false)) {
    const dis = await loc.isDisabled().catch(()=>false);
    console.log('try send', sel, dis);
    if (!dis) { await loc.click({timeout:5000}).catch(()=>{}); clicked=true; break; }
  }
}
if (!clicked) { console.log('fallback Enter'); await page.keyboard.press('Enter'); }
for (let i=0;i<120;i++) {
  await page.waitForTimeout(1000);
  const text = await page.evaluate(()=>document.body.innerText||'').catch(()=>'');
  const has = text.includes('QWEN_OK');
  const streaming = await page.locator('[class*="stop"], [data-is-streaming="true"], button[aria-label*="Stop"]').count().catch(()=>0);
  if (i % 3 === 0) console.log('wait', i, 'has=', has, 'streaming=', streaming);
  if (has && streaming === 0) break;
  if (i > 20 && has) break;
}
await page.waitForTimeout(1500);
const info = await page.evaluate(dump).catch(e=>({error:String(e),url:page.url()}));
fs.writeFileSync('/tmp/qwen-response.json', JSON.stringify(info,null,2));
await page.screenshot({path:'/tmp/qwen-response.png', fullPage:true}).catch(()=>{});
console.log('saved response', info.url);
console.log((info.bodyText||'').slice(0,3500).replace(/\s+/g,' '));
await context.close();
