import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = path.join(os.homedir(), '.arena-webbridge', 'chrome-profile');
const base = 'https://arena.ai';

const browserDump = `(() => {
  function meta(el) {
    if (!el) return null;
    return {
      tag: el.tagName, id: el.id || undefined,
      testid: el.getAttribute('data-testid') || undefined,
      aria: el.getAttribute('aria-label') || undefined,
      role: el.getAttribute('role') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      name: el.getAttribute('name') || undefined,
      href: el.getAttribute('href') || undefined,
      type: el.getAttribute('type') || undefined,
      text: ((el.innerText || el.value || el.textContent || '') + '').trim().slice(0, 200) || undefined,
      cls: (el.className ? String(el.className) : '').slice(0, 200) || undefined,
    };
  }
  function uniq(a){ var s=new Set(),o=[]; for(var i=0;i<a.length;i++){var x=a[i]; if(x && !s.has(x)){s.add(x);o.push(x);} } return o; }
  function q(sel){ try { return Array.from(document.querySelectorAll(sel)); } catch(e){ return []; } }
  var testids = uniq(q('[data-testid]').map(function(e){return e.getAttribute('data-testid');})).slice(0,200);
  var arias = uniq(q('[aria-label]').map(function(e){return e.getAttribute('aria-label');})).slice(0,200);
  var btnTexts = uniq(q('button,[role="button"]').map(function(e){return ((e.innerText||'')+'').trim() || e.getAttribute('aria-label');})).slice(0,200);
  var links = q('a[href]').map(function(e){return {href:e.getAttribute('href'), text:((e.innerText||'')+'').trim().slice(0,100)};}).filter(function(x){var h=x.href||''; return h.indexOf('/text')>=0||h.indexOf('/agent')>=0||h.indexOf('side-by-side')>=0||h.charAt(0)==='/';}).slice(0,120);
  var forms = q('textarea,[contenteditable="true"],[role="textbox"],input').slice(0,60).map(meta);
  var sendStop = q('button').filter(function(e){var t=((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('data-testid')||'')).toLowerCase(); return /send|submit|stop|generat|regenerat|compare|run/.test(t);}).slice(0,60).map(meta);
  var modelEls = q('select,[role="combobox"],[aria-haspopup="listbox"],[aria-haspopup="menu"],[data-testid*="model"],[class*="model"],[class*="Model"],[class*="dropdown"]').slice(0,80).map(function(e){var m=meta(e); m.html=(e.outerHTML||'').slice(0,500); return m;});
  var msgCandidates = q('[data-message-author-role],[data-role],[class*="message"],[class*="prose"],[class*="response"],[class*="assistant"],[class*="agent"],[class*="step"],[class*="tool"],[class*="left"],[class*="right"],[class*="column"],[class*="compare"],article,[role="log"],[role="article"]').slice(0,60).map(function(e){var m=meta(e); m.html=(e.outerHTML||'').slice(0,450); return m;});
  return { url: location.href, title: document.title, bodyText: ((document.body&&document.body.innerText)||'').slice(0,6000), testids: testids, arias: arias, btnTexts: btnTexts, links: links, forms: forms, sendStop: sendStop, modelEls: modelEls, msgCandidates: msgCandidates };
})()`;

async function dumpPage(page, name) {
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `/tmp/arena-${name}-rich.png`, fullPage: true }).catch(() => {});
  const info = await page.evaluate(browserDump).catch(e => ({ error: String(e), stack: String(e?.stack||'').slice(0,600), url: page.url() }));
  fs.writeFileSync(`/tmp/arena-${name}-rich.json`, JSON.stringify(info, null, 2));
  const summary = typeof info.bodyText === 'string' ? info.bodyText.slice(0,700).replace(/\s+/g,' ') : info.error;
  console.log(`saved ${name}: ${info.url}\n${summary}\n---`);
}

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();
for (const [name, pathPart] of [['agent','/agent'], ['sbs','/text/side-by-side'], ['direct','/text/direct']]) {
  console.log('goto', pathPart);
  await page.goto(base + pathPart, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto err', String(e).slice(0,200)));
  await dumpPage(page, name);
}
await context.close();
