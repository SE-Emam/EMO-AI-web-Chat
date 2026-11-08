import type { FastifyInstance } from 'fastify';

const HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>EMO.ai Gateway</title>
<style>
:root{--bg:#0b1020;--card:#151c2f;--muted:#93a4c7;--text:#eaf0ff;--accent:#5eead4;--danger:#fb7185;--warn:#fbbf24;--ok:#4ade80;--line:#26304f}
*{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:linear-gradient(180deg,#08101d,#0b1020);color:var(--text)}
.wrap{max-width:1200px;margin:0 auto;padding:20px} .grid{display:grid;gap:14px} .cards{grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.card{background:rgba(21,28,47,.95);border:1px solid var(--line);border-radius:14px;padding:14px;box-shadow:0 10px 30px rgba(0,0,0,.18)}
h1,h2,h3{margin:0 0 10px} h1{font-size:22px} h2{font-size:16px;color:var(--muted)} .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.pill{padding:4px 8px;border-radius:999px;background:#0f172a;border:1px solid var(--line);font-size:12px;color:var(--muted)}
.kv{display:grid;grid-template-columns:140px 1fr;gap:6px 10px;font-size:13px} .k{color:var(--muted)} code{background:#091121;padding:2px 6px;border-radius:6px}
button{background:#182544;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:8px 10px;cursor:pointer}
button:hover{border-color:#38507f} .primary{background:#123b35;border-color:#1e7669} .danger{background:#3a1820;border-color:#7a3140}
.models{max-height:180px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:8px;background:#0b1327}
label.model{display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:13px} input[type=text],textarea{width:100%;background:#091121;color:var(--text);border:1px solid var(--line);border-radius:10px;padding:8px}
.status-running{color:var(--ok)} .status-error{color:var(--danger)} .status-stopped{color:var(--muted)} .status-starting{color:var(--warn)}
small{color:var(--muted)}
</style>
</head>
<body>
<div class="wrap grid">
  <div class="card">
    <h1>EMO.ai Gateway — إدارة مزوّدات الويب</h1>
    <div class="row">
      <span class="pill">base uri: <code id="baseUri">mac.ai/v1</code></span>
      <span class="pill">api: <code id="apiKey">mac</code></span>
      <span class="pill">الحالة: <span id="gwStatus">...</span></span>
      <span class="pill">مدة التشغيل: <span id="gwUptime">...</span></span>
    </div>
  </div>
  <div class="card">
    <h2>الاستهلاك (جلسة المتصفح)</h2>
    <div class="kv">
      <div class="k">نشطة</div><div id="sActive">-</div>
      <div class="k">طلبات</div><div id="sReq">-</div>
      <div class="k">مكتملة</div><div id="sOk">-</div>
      <div class="k">أخطاء</div><div id="sErr">-</div>
      <div class="k">Streaming</div><div id="sStream">-</div>
      <div class="k">إجمالي منذ التشغيل</div><div id="lReq">-</div>
    </div>
  </div>
  <div id="providers" class="grid cards"></div>
</div>
<script>
async function api(path, opts={}){
  const headers = {...(opts.headers||{})};
  if (opts.body != null && headers['Content-Type'] == null && headers['content-type'] == null) headers['Content-Type']='application/json';
  const key = localStorage.getItem('emoApiKey') || '__EMO_API_KEY__';
  if (!headers['Authorization'] && !headers['authorization'] && !headers['x-api-key']) headers['Authorization']='Bearer '+key;
  const r=await fetch(path,{...opts,headers});
  const t=await r.text(); let d; try{d=JSON.parse(t)}catch{d={raw:t}};
  if(!r.ok) throw new Error(d?.error?.message||d?.message||t||r.status);
  return d;
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtMs(ms){ms=Math.max(0,ms||0); const s=Math.floor(ms/1000); const h=Math.floor(s/3600); const m=Math.floor((s%3600)/60); const sec=s%60; return h? h+'h '+m+'m '+sec+'s': m? m+'m '+sec+'s': sec+'s'}
async function refresh(){
  try {
  const st=await api('/api/gateway/status');
  document.getElementById('baseUri').textContent=st.gateway.baseUriDisplay;
  document.getElementById('apiKey').textContent=st.gateway.api;
  try{ localStorage.setItem('emoApiKey', st.gateway.api); }catch{}
  document.getElementById('gwStatus').textContent='يعمل';
  document.getElementById('gwUptime').textContent=fmtMs(Date.now()-new Date(st.usage.gatewayStartedAt).getTime());
  const u=st.usage; document.getElementById('sActive').textContent=u.sessionActive?'نعم':'لا (تم التصفير/بانتظار heartbeat)';
  document.getElementById('sReq').textContent=u.session.requests; document.getElementById('sOk').textContent=u.session.completions;
  document.getElementById('sErr').textContent=u.session.errors; document.getElementById('sStream').textContent=u.session.streamRequests;
  document.getElementById('lReq').textContent=u.lifetime.requests;
  const root=document.getElementById('providers'); root.innerHTML='';
  for(const p of st.providers){
    const selected=new Set(p.selectedModels||[]);
    const models=[...new Set([...(p.availableModels||[]),...(p.selectedModels||[])])];
    const el=document.createElement('div'); el.className='card';
    el.innerHTML=\`
      <div class="row" style="justify-content:space-between"><h3>\${esc(p.name||p.id)}</h3><span class="status-\${esc(p.status)}">\${esc(p.status)}</span></div>
      <div class="kv">
        <div class="k">ID</div><div><code>\${esc(p.id)}</code></div>
        <div class="k">مفعّل</div><div>\${p.enabled?'نعم':'لا'}</div>
        <div class="k">مدة التشغيل</div><div>\${fmtMs(p.runtimeMs)}</div>
        <div class="k">آخر خطأ</div><div style="color:var(--danger)">\${esc(p.lastError||'-')}</div>
      </div>
      <div class="row" style="margin:10px 0">
        <button class="primary" data-act="login" data-id="\${esc(p.id)}">تسجيل الدخول وجلب النماذج</button>
        <button data-act="start" data-id="\${esc(p.id)}">تشغيل</button>
        <button class="danger" data-act="stop" data-id="\${esc(p.id)}">إيقاف</button>
        <button data-act="refresh" data-id="\${esc(p.id)}">سحب النماذج</button>
        <button data-act="toggle" data-id="\${esc(p.id)}" data-enabled="\${p.enabled?1:0}">\${p.enabled?'تعطيل':'تفعيل'}</button>
      </div>
      <h2>النماذج (المحدد فقط يعمل عبر /v1)</h2>
      <div class="models">\${models.map(m=>\`<label class="model"><input type="checkbox" data-model="\${esc(m)}" data-id="\${esc(p.id)}" \${selected.has(m)?'checked':''}/> <span><code>\${esc(m)}</code></span></label>\`).join('')||'<small>لا توجد نماذج بعد. استخدم سحب النماذج بعد تسجيل الدخول/تشغيل المزود.</small>'}</div>
      <div class="row" style="margin-top:8px"><button data-act="saveModels" data-id="\${esc(p.id)}">حفظ النماذج</button></div>
      <details style="margin-top:8px"><summary>إعدادات</summary><pre style="white-space:pre-wrap;font-size:12px;color:var(--muted)">\${esc(JSON.stringify(p.settings||{},null,2))}</pre></details>\`;
    root.appendChild(el);
  }
  root.querySelectorAll('button[data-act]').forEach(btn=>btn.onclick=async()=>{
    const id=btn.dataset.id, act=btn.dataset.act;
    const old=btn.textContent;
    try{
      if(act==='login'){
        btn.disabled=true; btn.textContent='جارٍ فتح المتصفح... سجّل الدخول ثم أغلق النافذة';
        await api('/api/gateway/providers/'+encodeURIComponent(id)+'/login',{method:'POST'});
      }
      if(act==='start'||act==='stop'||act==='refresh') await api('/api/gateway/providers/'+encodeURIComponent(id)+'/'+act,{method:'POST'});
      if(act==='toggle') await api('/api/gateway/providers/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({enabled: !(btn.dataset.enabled==='1')})});
      if(act==='saveModels'){ const card=btn.closest('.card'); const boxes=[...card.querySelectorAll('input[type=checkbox][data-model]')]; const selected=boxes.filter(b=>b.checked).map(b=>b.dataset.model); const avail=boxes.map(b=>b.dataset.model); await api('/api/gateway/providers/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({availableModels:avail,selectedModels:selected})}); }
      await refresh();
    }catch(e){ alert(e.message||String(e)); }
    finally{ btn.disabled=false; if(btn.isConnected) btn.textContent=old; }
  });
  } catch(e) {
    document.getElementById('gwStatus').textContent='خطأ في الاتصال';
    console.error(e);
  }
}
async function beat(){ try{ await api('/api/gateway/heartbeat',{method:'POST'});}catch{} }
beat(); setInterval(beat, 5000); refresh().catch(()=>{}); setInterval(()=>refresh().catch(()=>{}), 4000);
</script>
</body></html>`;

export function registerGatewayUi(app: FastifyInstance, opts?: { apiKey?: string }): void {
  const apiKey = opts?.apiKey || 'mac';
  const rendered = HTML.replace(/__EMO_API_KEY__/g, () => apiKey);
  const handler = async (_req: any, reply: any) => reply.type('text/html; charset=utf-8').send(rendered);
  app.get('/', handler);
  app.get('/ui', handler);
}
