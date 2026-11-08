import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = path.join(os.homedir(), '.arena-webbridge', 'chrome-profile');
const base = 'https://arena.ai';
const PROMPT = 'Reply with exactly: BRIDGE_TEST_OK';

const browserDump = `(() => {
  function meta(el) {
    if (!el) return null;
    return {
      tag: el.tagName, id: el.id || undefined,
      testid: el.getAttribute('data-testid') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      role: el.getAttribute('role') || undefined,
      datarole: el.getAttribute('data-message-author-role') || el.getAttribute('data-role') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      name: el.getAttribute('name') || undefined,
      type: el.getAttribute('type') || undefined,
      busy: el.getAttribute('aria-busy') || undefined,
      text: ((el.innerText || el.value || el.textContent || '') + '').trim().slice(0, 500) || undefined,
      cls: (el.className ? String(el.className) : '').slice(0, 220) || undefined,
      html: (el.outerHTML || '').slice(0, 700),
    };
  }
  function q(sel){ try { return Array.from(document.querySelectorAll(sel)); } catch(e){ return []; } }
  const candidates = {
    forms: q('textarea,[contenteditable="true"],[role="textbox"],form').slice(0,40).map(meta),
    sendStop: q('button').filter(function(e){var t=((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('data-testid')||'')).toLowerCase(); return /send|submit|stop|generat|regenerat|run|cancel/.test(t);}).slice(0,60).map(meta),
    msgs: q('[data-message-author-role],[data-role],[class*="prose"],[class*="message"],[class*="response"],[class*="assistant"],[class*="agent"],[class*="step"],[class*="markdown"],article,[role="article"],[role="log"]').slice(0,120).map(meta),
    panels: q('main,[role="main"],[class*="column"],[class*="panel"],[class*="side"],[class*="left"],[class*="right"],[class*="compare"],[class*="model"]').slice(0,80).map(meta),
  };
  return { url: location.href, title: document.title, bodyText: ((document.body&&document.body.innerText)||'').slice(0,12000), candidates };
})()`;

async function dump(page, name) {
  await page.screenshot({ path: `/tmp/arena-${name}.png`, fullPage: true }).catch(()=>{});
  const info = await page.evaluate(browserDump).catch(e => ({ error: String(e), url: page.url() }));
  fs.writeFileSync(`/tmp/arena-${name}.json`, JSON.stringify(info, null, 2));
  console.log('dump', name, info.url || info.error);
}

async function fillAndSend(page, mode) {
  // Try direct-like textarea first, else tiptap/contenteditable.
  let filled = false;
  for (const sel of ['textarea[name="message"]','textarea[placeholder*="Ask"]','textarea:not([name="g-recaptcha-response"])','[contenteditable="true"].ProseMirror','[contenteditable="true"][role="textbox"]','[contenteditable="true"]','[role="textbox"]']) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(()=>0) && await loc.isVisible().catch(()=>false)) {
      await loc.click({ timeout: 5000 }).catch(()=>{});
      if (sel.includes('textarea')) {
        await loc.fill(PROMPT).catch(()=>{});
      } else {
        await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A').catch(()=>{});
        await page.keyboard.press('Backspace').catch(()=>{});
        await page.keyboard.type(PROMPT, { delay: 10 }).catch(()=>{});
      }
      filled = true; console.log('filled via', sel); break;
    }
  }
  if (!filled) console.log('NO INPUT FILLED');
  await page.waitForTimeout(500);
  let sent = false;
  for (const sel of ['button[aria-label="Send message"]','button[type="submit"]:has-text("Send")','button:has-text("Send")','button[data-testid*="send"]']) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(()=>0) && await loc.isVisible().catch(()=>false)) {
      const enabled = await loc.isEnabled().catch(()=>true);
      if (enabled) { await loc.click({ timeout: 5000 }).catch(e=>console.log('send click err', String(e).slice(0,120))); sent=true; console.log('sent via', sel); break; }
    }
  }
  if (!sent) { await page.keyboard.press('Enter').catch(()=>{}); console.log('fallback Enter'); }
}

async function waitForSettle(page, ms=45000) {
  const start = Date.now();
  let last = '';
  let stable = 0;
  while (Date.now()-start < ms) {
    await page.waitForTimeout(1200);
    const state = await page.evaluate(browserDump).catch(()=>({bodyText:''}));
    const t = (state.bodyText||'').slice(-4000);
    const hasTest = t.includes('BRIDGE_TEST_OK');
    const generating = /Stop generating|Stop/i.test(t) || await page.locator('button[aria-label*="Stop"],button:has-text("Stop")').first().isVisible().catch(()=>false);
    if (t === last) stable++; else { stable=0; last=t; }
    console.log('poll', Math.round((Date.now()-start)/1000)+'s', 'hasTest='+hasTest, 'generating='+generating, 'stable='+stable);
    if (hasTest && !generating && stable >= 2) break;
    if (!generating && stable >= 4 && (Date.now()-start)>8000) break;
  }
}

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1100 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();

for (const [name, pathPart] of [['agent-post','/agent'], ['sbs-post','/text/side-by-side?model_a=claude-haiku-4-5-20251001&model_b=gemini-3-flash']]) {
  console.log('\n===', name, pathPart);
  await page.goto(base + pathPart, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e=>console.log('goto err', String(e).slice(0,150)));
  await page.waitForTimeout(4000);
  await dump(page, name+'-pre');
  await fillAndSend(page, name);
  await waitForSettle(page, name==='agent-post'?70000:50000);
  await dump(page, name);
}
await context.close();
console.log('capture done');
