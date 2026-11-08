import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = path.join(os.homedir(), '.arena-webbridge', 'chrome-profile');
const base = 'https://arena.ai';

async function dumpPage(page: any, name: string) {
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `/tmp/arena-${name}-rich.png`, fullPage: true }).catch(() => {});
  const info = await page.evaluate(() => {
    function meta(el: any) {
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
        text: ((el.innerText || el.value || el.textContent || '') + '').trim().slice(0, 180) || undefined,
        cls: (el.className ? String(el.className) : '').slice(0, 180) || undefined,
      };
    }
    function uniq(a: any[]) { const s = new Set(); const o: any[] = []; for (const x of a) { if (x && !s.has(x)) { s.add(x); o.push(x); } } return o; }
    function q(sel: string) { try { return Array.from(document.querySelectorAll(sel)); } catch(e){ return []; } }
    var testids = uniq(q('[data-testid]').map(function(e:any){return e.getAttribute('data-testid');})).slice(0,150);
    var arias = uniq(q('[aria-label]').map(function(e:any){return e.getAttribute('aria-label');})).slice(0,150);
    var btnTexts = uniq(q('button,[role="button"]').map(function(e:any){return ((e.innerText||'')+'').trim() || e.getAttribute('aria-label');})).slice(0,150);
    var links = q('a[href]').map(function(e:any){return {href:e.getAttribute('href'), text:((e.innerText||'')+'').trim().slice(0,80)};}).filter(function(x:any){var h=x.href||''; return h.indexOf('/text')>=0||h.indexOf('/agent')>=0||h.indexOf('side-by-side')>=0||h.charAt(0)==='/';}).slice(0,100);
    var forms = q('textarea,[contenteditable="true"],[role="textbox"],input').slice(0,50).map(meta);
    var sendStop = q('button').filter(function(e:any){var t=((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('data-testid')||'')).toLowerCase(); return /send|submit|stop|generat|regenerat/.test(t);}).slice(0,40).map(meta);
    var modelEls = q('select,[role="combobox"],[aria-haspopup="listbox"],[aria-haspopup="menu"],[data-testid*="model"],[class*="model-select"],[class*="ModelSelect"]').slice(0,50).map(function(e:any){var m=meta(e); m.html=(e.outerHTML||'').slice(0,450); return m;});
    var panels = q('main,[role="main"],[class*="panel"],[class*="column"],[class*="side"],[class*="compare"],[class*="chat"]').slice(0,30).map(function(e:any){var m=meta(e); m.html=(e.outerHTML||'').slice(0,350); return m;});
    return { url: location.href, title: document.title, bodyText: ((document.body&&document.body.innerText)||'').slice(0,5000), testids: testids, arias: arias, btnTexts: btnTexts, links: links, forms: forms, sendStop: sendStop, modelEls: modelEls, panels: panels };
  }).catch((e: any) => ({ error: String(e), stack: String(e && e.stack || '').slice(0,600), url: page.url() }));
  fs.writeFileSync(`/tmp/arena-${name}-rich.json`, JSON.stringify(info, null, 2));
  const summary = typeof info.bodyText === 'string' ? info.bodyText.slice(0,600).replace(/\s+/g,' ') : info.error;
  console.log(`saved ${name}: ${info.url}\n${summary}\n---`);
}

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();
  for (const [name, pathPart] of [['agent','/agent'], ['sbs','/text/side-by-side'], ['direct','/text/direct']] as const) {
    console.log('goto', pathPart);
    await page.goto(base + pathPart, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto err', String(e).slice(0,200)));
    await dumpPage(page, name);
  }
  await context.close();
})();
