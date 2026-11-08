import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const profile = path.join(os.homedir(), '.arena-webbridge', 'tencent-aistudio-profile');
fs.mkdirSync(profile, { recursive: true });
const dump = `(() => {
  function meta(el){ if(!el) return null; return {tag:el.tagName,id:el.id||undefined,testid:el.getAttribute('data-testid')||undefined,aria:el.getAttribute('aria-label')||undefined,role:el.getAttribute('role')||undefined,placeholder:el.getAttribute('placeholder')||undefined,contenteditable:el.getAttribute('contenteditable')||undefined,type:el.getAttribute('type')||undefined,href:el.getAttribute('href')||undefined,text:((el.innerText||el.value||el.textContent||'')+'').trim().slice(0,260)||undefined,cls:(el.className?String(el.className):'').slice(0,240)||undefined,html:(el.outerHTML||'').slice(0,700)}; }
  function q(sel){ try{return Array.from(document.querySelectorAll(sel));}catch(e){return [];} }
  function uniq(a){ var s=new Set(),o=[]; for(var i=0;i<a.length;i++){var x=a[i]; if(x&&!s.has(x)){s.add(x);o.push(x);} } return o; }
  return { url: location.href, title: document.title,
    bodyText: ((document.body&&document.body.innerText)||'').slice(0,10000),
    testids: uniq(q('[data-testid]').map(e=>e.getAttribute('data-testid'))).slice(0,200),
    arias: uniq(q('[aria-label]').map(e=>e.getAttribute('aria-label'))).slice(0,200),
    btnTexts: uniq(q('button,[role="button"],a').map(e=>((e.innerText||'')+'').trim()||e.getAttribute('aria-label'))).slice(0,120),
    forms: q('textarea,[contenteditable],[role="textbox"],input,form').slice(0,80).map(meta),
    links: q('a[href]').slice(0,80).map(e=>({href:e.getAttribute('href'),text:((e.innerText||'')+'').trim().slice(0,80)})),
  };
})()`;
const target = process.argv[2] || 'https://aistudio.tencent.ai/';
const name = process.argv[3] || 'tencent-com';
const context = await chromium.launchPersistentContext(profile, { channel:'chrome', headless:false, viewport:{width:1440,height:1000}, args:['--disable-blink-features=AutomationControlled'], ignoreDefaultArgs:['--enable-automation'] });
const page = context.pages()[0] || await context.newPage();
await page.goto(target, { waitUntil:'domcontentloaded', timeout:60000 }).catch(e=>console.log('goto err', String(e).slice(0,180)));
await page.waitForTimeout(6000);
const info = await page.evaluate(dump).catch(e=>({error:String(e),url:page.url()}));
fs.writeFileSync(`/tmp/${name}.json`, JSON.stringify(info,null,2));
await page.screenshot({path:`/tmp/${name}.png`, fullPage:true}).catch(()=>{});
console.log('saved', name, info.url, info.title);
console.log((info.bodyText||info.error||'').slice(0,1200).replace(/\s+/g,' '));
await context.close();
