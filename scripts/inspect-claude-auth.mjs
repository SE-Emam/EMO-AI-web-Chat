import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const profile = path.join(os.homedir(), '.arena-webbridge', 'claude-profile');
const browserDump = `(() => {
  function meta(el){ if(!el) return null; return {tag:el.tagName,id:el.id||undefined,testid:el.getAttribute('data-testid')||undefined,aria:el.getAttribute('aria-label')||undefined,role:el.getAttribute('role')||undefined,placeholder:el.getAttribute('placeholder')||undefined,name:el.getAttribute('name')||undefined,contenteditable:el.getAttribute('contenteditable')||undefined,type:el.getAttribute('type')||undefined,href:el.getAttribute('href')||undefined,disabled:el.disabled||el.getAttribute('aria-disabled')||undefined,text:((el.innerText||el.value||el.textContent||'')+'').trim().slice(0,260)||undefined,cls:(el.className?String(el.className):'').slice(0,240)||undefined,html:(el.outerHTML||'').slice(0,900)}; }
  function uniq(a){ var s=new Set(),o=[]; for(var i=0;i<a.length;i++){var x=a[i]; if(x&&!s.has(x)){s.add(x);o.push(x);} } return o; }
  function q(sel){ try{return Array.from(document.querySelectorAll(sel));}catch(e){return [];} }
  return {
    url: location.href, title: document.title,
    bodyText: ((document.body&&document.body.innerText)||'').slice(0,12000),
    testids: uniq(q('[data-testid]').map(e=>e.getAttribute('data-testid'))).slice(0,300),
    arias: uniq(q('[aria-label]').map(e=>e.getAttribute('aria-label'))).slice(0,300),
    btnTexts: uniq(q('button,[role="button"]').map(e=>((e.innerText||'')+'').trim()||e.getAttribute('aria-label'))).slice(0,250),
    forms: q('textarea,[contenteditable],[role="textbox"],input,fieldset,form').slice(0,120).map(meta),
    sendStop: q('button,[role="button"]').filter(e=>/send|stop|submit|regenerat|retry|continue|up arrow|arrow/i.test(((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('data-testid')||'')))).slice(0,120).map(meta),
    modelEls: q('[data-testid*="model"],[aria-label*="model"],[class*="model"],button[aria-haspopup],select').slice(0,120).map(meta),
    msgCandidates: q('[data-testid*="message"],[data-is-streaming],[class*="font-claude"],[class*="font-user"],[class*="prose"],[class*="message"],article,[role="article"],[data-role]').slice(0,160).map(meta),
    streaming: q('[data-is-streaming],[aria-busy="true"],[class*="streaming"],[class*="result-streaming"]').slice(0,60).map(meta),
  };
})()`;
async function dump(page,name){ await page.waitForTimeout(5000); await page.screenshot({path:`/tmp/claude-${name}.png`,fullPage:true}).catch(()=>{}); const info=await page.evaluate(browserDump).catch(e=>({error:String(e),url:page.url()})); fs.writeFileSync(`/tmp/claude-${name}.json`,JSON.stringify(info,null,2)); console.log('saved',name,info.url); console.log((info.bodyText||info.error||'').slice(0,900).replace(/\s+/g,' ')); console.log('---'); }
const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:false,viewport:{width:1440,height:1000},args:['--disable-blink-features=AutomationControlled']});
const page=context.pages()[0]||await context.newPage();
await page.goto('https://claude.ai/new',{waitUntil:'domcontentloaded',timeout:60000}).catch(e=>console.log('goto err',String(e).slice(0,180)));
await dump(page,'auth-new');
await context.close();
