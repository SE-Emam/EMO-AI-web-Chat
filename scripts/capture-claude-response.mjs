import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const profile = path.join(os.homedir(), '.arena-webbridge', 'claude-profile');
const dump = `(() => {
  function meta(el){ if(!el) return null; return {tag:el.tagName,id:el.id||undefined,testid:el.getAttribute('data-testid')||undefined,aria:el.getAttribute('aria-label')||undefined,role:el.getAttribute('role')||undefined,dataIsStreaming:el.getAttribute('data-is-streaming')||undefined,ariaBusy:el.getAttribute('aria-busy')||undefined,text:((el.innerText||el.value||el.textContent||'')+'').trim().slice(0,500)||undefined,cls:(el.className?String(el.className):'').slice(0,260)||undefined,html:(el.outerHTML||'').slice(0,1400)}; }
  function q(sel){ try{return Array.from(document.querySelectorAll(sel));}catch(e){return [];} }
  return {
    url: location.href, title: document.title,
    bodyText: ((document.body&&document.body.innerText)||'').slice(0,16000),
    testids: Array.from(new Set(q('[data-testid]').map(e=>e.getAttribute('data-testid')))).slice(0,200),
    streaming: q('[data-is-streaming],[aria-busy="true"],[class*="streaming"],[class*="result-streaming"],button[aria-label*="Stop"]').slice(0,40).map(meta),
    messages: q('[data-testid*="message"],[data-testid*="turn"],[class*="font-claude"],[class*="font-user-message"],[class*="prose"],article,[data-role],[class*="assistant"],[class*="human-turn"]').slice(0,80).map(meta),
    sendStop: q('button[data-testid*="send"],button[data-testid*="stop"],button[aria-label*="Send"],button[aria-label*="Stop"]').slice(0,20).map(meta),
  };
})()`;
const context = await chromium.launchPersistentContext(profile, { channel:'chrome', headless:false, viewport:{width:1440,height:1000}, args:['--disable-blink-features=AutomationControlled'] });
const page = context.pages()[0] || await context.newPage();
await page.goto('https://claude.ai/new', { waitUntil:'domcontentloaded', timeout:60000 }).catch(()=>{});
await page.waitForTimeout(3000);
const composer = page.locator('[data-testid="chat-input"][contenteditable="true"], div.ProseMirror[contenteditable="true"]').first();
await composer.click();
await composer.fill('Reply with exactly: CLAUDE_OK');
await page.waitForTimeout(500);
const send = page.locator('button[data-testid="chat-input-send"], button[aria-label="Send message"]').first();
await send.click({ timeout: 10000 }).catch(async()=>{ await page.keyboard.press('Enter'); });
// wait for response: stop button may appear, then disappear; or look for CLAUDE_OK text
for (let i=0;i<120;i++) {
  await page.waitForTimeout(1000);
  const text = await page.evaluate(()=>document.body.innerText||'').catch(()=>'');
  const has = text.includes('CLAUDE_OK');
  const streaming = await page.locator('[data-is-streaming="true"], button[aria-label*="Stop"], [class*="result-streaming"]').count().catch(()=>0);
  if (i % 3 === 0) console.log('wait', i, 'has=', has, 'streaming=', streaming);
  if (has && streaming === 0) break;
  if (i > 15 && has) break;
}
await page.waitForTimeout(1500);
const info = await page.evaluate(dump).catch(e=>({error:String(e),url:page.url()}));
fs.writeFileSync('/tmp/claude-response.json', JSON.stringify(info,null,2));
await page.screenshot({path:'/tmp/claude-response.png', fullPage:true}).catch(()=>{});
console.log('saved response', info.url);
console.log((info.bodyText||'').slice(0,2500).replace(/\s+/g,' '));
await context.close();
