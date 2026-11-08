import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = path.join(os.homedir(), '.arena-webbridge', 'claude-profile');
fs.mkdirSync(profile, { recursive: true });

const browserDump = `(() => {
  function meta(el){ if(!el) return null; return {tag:el.tagName,id:el.id||undefined,testid:el.getAttribute('data-testid')||undefined,aria:el.getAttribute('aria-label')||undefined,role:el.getAttribute('role')||undefined,placeholder:el.getAttribute('placeholder')||undefined,name:el.getAttribute('name')||undefined,contenteditable:el.getAttribute('contenteditable')||undefined,type:el.getAttribute('type')||undefined,href:el.getAttribute('href')||undefined,text:((el.innerText||el.value||el.textContent||'')+'').trim().slice(0,220)||undefined,cls:(el.className?String(el.className):'').slice(0,220)||undefined,html:(el.outerHTML||'').slice(0,600)}; }
  function uniq(a){ var s=new Set(),o=[]; for(var i=0;i<a.length;i++){var x=a[i]; if(x&&!s.has(x)){s.add(x);o.push(x);} } return o; }
  function q(sel){ try{return Array.from(document.querySelectorAll(sel));}catch(e){return [];} }
  return {
    url: location.href, title: document.title,
    bodyText: ((document.body&&document.body.innerText)||'').slice(0,8000),
    testids: uniq(q('[data-testid]').map(e=>e.getAttribute('data-testid'))).slice(0,250),
    arias: uniq(q('[aria-label]').map(e=>e.getAttribute('aria-label'))).slice(0,250),
    btnTexts: uniq(q('button,[role="button"]').map(e=>((e.innerText||'')+'').trim()||e.getAttribute('aria-label'))).slice(0,200),
    forms: q('textarea,[contenteditable],[role="textbox"],input,form,fieldset').slice(0,80).map(meta),
    sendStop: q('button,[role="button"]').filter(e=>/send|stop|submit|regenerat|retry|continue/i.test(((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('data-testid')||'')))).slice(0,80).map(meta),
    modelEls: q('[data-testid*="model"],[aria-label*="model"],[class*="model"],button[aria-haspopup]').slice(0,80).map(meta),
    msgCandidates: q('[data-testid*="message"],[data-is-streaming],[class*="message"],[class*="font-claude"],[class*="prose"],article,[role="article"],[data-role]').slice(0,100).map(meta),
    links: q('a[href]').map(e=>({href:e.getAttribute('href'),text:((e.innerText||'')+'').trim().slice(0,80)})).filter(x=>{var h=x.href||''; return h.indexOf('claude')>=0||h.charAt(0)==='/';}).slice(0,120),
  };
})()`;

async function dump(page, name) {
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `/tmp/claude-${name}.png`, fullPage: true }).catch(()=>{});
  const info = await page.evaluate(browserDump).catch(e=>({error:String(e),url:page.url()}));
  fs.writeFileSync(`/tmp/claude-${name}.json`, JSON.stringify(info,null,2));
  console.log(`saved ${name} ${info.url}\n${(info.bodyText||info.error||'').slice(0,700).replace(/\s+/g,' ')}\n---`);
}

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = context.pages()[0] || await context.newPage();
for (const [name, url] of [['home','https://claude.ai/'], ['new','https://claude.ai/new']]) {
  console.log('goto', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e=>console.log('goto err', String(e).slice(0,180)));
  await dump(page, name);
}
console.log('leaving browser open 45s for manual login if needed; close to save session');
await page.waitForTimeout(45000);
await context.close();
