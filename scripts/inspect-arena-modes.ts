import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = path.join(os.homedir(), '.arena-webbridge', 'chrome-profile');
const base = 'https://arena.ai';

async function dumpPage(page: any, name: string) {
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `/tmp/arena-${name}.png`, fullPage: true }).catch(() => {});
  const info = await page.evaluate(() => {
    const pick = (sels: string[]) => sels.map(s => {
      try {
        const els = Array.from(document.querySelectorAll(s));
        return {
          sel: s,
          count: els.length,
          visible: els.filter((e: any) => e.offsetParent || getComputedStyle(e).visibility !== 'hidden').length,
          sample: els.slice(0, 3).map((e: any) => ({
            tag: e.tagName, id: e.id, name: e.getAttribute('name'),
            placeholder: e.getAttribute('placeholder'), aria: e.getAttribute('aria-label'),
            testid: e.getAttribute('data-testid'), role: e.getAttribute('role'),
            href: e.getAttribute('href'), type: e.getAttribute('type'),
            text: (e.innerText || e.textContent || '').trim().slice(0, 140),
            cls: String(e.className || '').slice(0, 140),
          }))
        };
      } catch (e) { return { sel: s, err: String(e) }; }
    });
    return {
      url: location.href, title: document.title,
      inputs: pick(['textarea','[contenteditable="true"]','input[type="text"]','input[type="search"]','[role="textbox"]','[role="combobox"]']),
      buttons: pick(['button','[role="button"]','input[type="submit"]','a[role="button"]']),
      messages: pick(['[data-message-author-role]','[data-role]','.prose','[class*="assistant"]','[class*="response"]','[class*="message"]','[class*="bubble"]','article','[role="log"]','[data-testid*="message"]','[data-testid*="chat"]','[data-testid*="bot"]']),
      status: pick(['[aria-busy="true"]','button[aria-label*="Stop"]','button:has-text("Stop")','[class*="generat"]','[class*="loading"]','[class*="streaming"]','[class*="cursor"]','[role="status"]','[data-state]']),
      tabs: pick(['[role="tab"]','[role="tablist"]','nav a','a[href*="/text"]','a[href*="/agent"]','a[href*="side-by-side"]']),
      selects: pick(['select','[role="listbox"]','[aria-haspopup="listbox"]','[aria-haspopup="menu"]','[class*="model"]','[class*="select"]','[data-testid*="model"]']),
      headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0,15).map((e:any)=>e.innerText.trim()).filter(Boolean),
      bodyTextHead: (document.body?.innerText || '').slice(0, 2000),
    };
  }).catch((e: any) => ({ error: String(e), url: page.url() }));
  fs.writeFileSync(`/tmp/arena-${name}-inspect.json`, JSON.stringify(info, null, 2));
  console.log(`saved ${name}: ${info.url || info.error}`);
}

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome',
  headless: false,
  viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();
for (const [name, pathPart] of [['agent','/agent'], ['sbs','/text/side-by-side'], ['direct','/text/direct']] as const) {
  console.log('goto', pathPart);
  await page.goto(base + pathPart, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto err', String(e).slice(0,180)));
  await dumpPage(page, name);
}
console.log('done - leaving browser open 90s for manual review if needed');
await page.waitForTimeout(90000);
await context.close();
