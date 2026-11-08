import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = path.join(os.homedir(), '.arena-webbridge', 'chrome-profile');
const base = 'https://arena.ai';

async function dumpPage(page, name) {
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/arena-${name}.png`, fullPage: true }).catch(() => {});
  const info = await page.evaluate(() => {
    const pick = (sels) => sels.map(s => {
      try { const els = [...document.querySelectorAll(s)]; return { sel: s, count: els.length, visible: els.filter(e=>e.offsetParent||getComputedStyle(e).visibility!=='hidden').length, sample: els.slice(0,2).map(e=>({tag:e.tagName,id:e.id,name:e.getAttribute('name'),placeholder:e.getAttribute('placeholder'),aria:e.getAttribute('aria-label'),testid:e.getAttribute('data-testid'),role:e.getAttribute('role'),text:(e.innerText||e.textContent||'').trim().slice(0,120),cls:(e.className||'').toString().slice(0,120)})) }; } catch(e){ return {sel:s, err:String(e)}; }
    });
    return {
      url: location.href,
      title: document.title,
      inputs: pick(['textarea','[contenteditable="true"]','input[type="text"]','input:not([type])','[role="textbox"]']),
      buttons: pick(['button','[role="button"]','input[type="submit"]']),
      messages: pick(['[data-message-author-role]','.prose','[data-testid*="message"]','[data-testid*="chat"]','[class*="message"]','article','[role="article"]','[class*="response"]','[class*="assistant"]','[class*="model"]']),
      status: pick(['[aria-busy]','[class*="generat"]','[class*="loading"]','[class*="stop"]','[class*="stream"]','[role="status"]','[data-state]']),
      tabs: pick(['[role="tab"]','[role="tablist"]','a[href*="/text/"]','a[href*="/agent"]']),
      headings: [...document.querySelectorAll('h1,h2,h3')].slice(0,12).map(e=>e.innerText.trim()).filter(Boolean),
      bodyTextHead: (document.body?.innerText||'').slice(0,1500),
    };
  }).catch(e => ({ error: String(e), url: page.url() }));
  fs.writeFileSync(`/tmp/arena-${name}-inspect.json`, JSON.stringify(info, null, 2));
  console.log(`saved ${name}:`, info.url || info.error);
}

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1400, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();
for (const [name, pathPart] of [['agent','/agent'], ['sbs','/text/side-by-side'], ['direct','/text/direct']]) {
  console.log('goto', pathPart);
  await page.goto(base + pathPart, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e=>console.log('goto err', e.message));
  await dumpPage(page, name);
}
console.log('done - close browser when finished inspecting');
await page.waitForTimeout(120000);
await context.close();
