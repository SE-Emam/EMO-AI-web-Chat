import type { FastifyInstance } from 'fastify';

const HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>EMO-AI Gateway — لوحة التحكم وإدارة البوابة</title>
<link rel="icon" type="image/x-icon" href="/favicon.ico"/>
<link rel="icon" type="image/png" sizes="32x32" href="/favicon.png"/>
<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>
<script>
  (function(){
    try {
      var saved = localStorage.getItem('emo-gateway-theme');
      var theme = saved || ((window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark');
      document.documentElement.setAttribute('data-theme', theme);
      
      var savedLang = localStorage.getItem('emo-gateway-lang') || 'ar';
      var isRtl = (savedLang === 'ar');
      document.documentElement.setAttribute('lang', savedLang);
      document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');

      if (localStorage.getItem('emo-gateway-sidebar-collapsed') === 'true') {
        document.documentElement.classList.add('sidebar-collapsed-init');
      }
    } catch(e) {}
  })();
</script>
<style>
:root, [data-theme="dark"]{
  --bg: #09090b;
  --sidebar-bg: #101014;
  --card-bg: #141418;
  --card-hover: #191920;
  --card-subtle: #0d0d11;
  --border: #23232a;
  --border-focus: #383844;
  --border-subtle: #1a1a20;
  --text: #f4f4f7;
  --text-muted: #8e8e9c;
  --text-dim: #5c5c6a;
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --primary-subtle: rgba(59,130,246,0.12);
  --success: #10b981;
  --success-bg: rgba(16, 185, 129, 0.08);
  --success-border: rgba(16, 185, 129, 0.28);
  --danger: #ef4444;
  --danger-bg: rgba(239, 68, 68, 0.08);
  --danger-border: rgba(239, 68, 68, 0.28);
  --warn: #f59e0b;
  --warn-bg: rgba(245, 158, 11, 0.08);
  --warn-border: rgba(245, 158, 11, 0.28);
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --code-bg: #0b0b0e;
  --code-text: #cbd5e1;
  --nav-active-bg: #1a1c26;
  --nav-active-border: #2e3245;
  --nav-active-badge-bg: #262a3a;
  --nav-active-badge-border: #3b4058;
  --chip-active-bg: #161c28;
  --chip-active-border: #2a3b5c;
  --hub-bg: #0f172a;
  --hub-border: #2563eb;
  --hub-title: #93c5fd;
  --btn-primary-bg: #18181b;
  --btn-primary-border: #3f3f46;
  --btn-primary-text: #ffffff;
  --btn-primary-hover: #27272a;
  --row-hover: #18181f;
  --table-hover: rgba(255,255,255,0.02);
  --modal-bg: #141418;
  --modal-shadow: 0 20px 40px rgba(0,0,0,0.6);
  --logo-accent: #60a5fa;
  --icon-badge-bg: #141419;
  --color-scheme: dark;
}

[data-theme="light"]{
  --bg: #e9eef5;
  --sidebar-bg: #ffffff;
  --card-bg: #ffffff;
  --card-hover: #f1f5f9;
  --card-subtle: #f3f6fa;
  --border: #e2e8f0;
  --border-focus: #cbd5e1;
  --border-subtle: #f1f5f9;
  --text: #0f172a;
  --text-muted: #64748b;
  --text-dim: #94a3b8;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --primary-subtle: rgba(37,99,235,0.08);
  --success: #059669;
  --success-bg: rgba(5, 150, 105, 0.08);
  --success-border: rgba(5, 150, 105, 0.28);
  --danger: #dc2626;
  --danger-bg: rgba(220, 38, 38, 0.08);
  --danger-border: rgba(220, 38, 38, 0.28);
  --warn: #d97706;
  --warn-bg: rgba(217, 119, 6, 0.08);
  --warn-border: rgba(217, 119, 6, 0.28);
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --code-bg: #0f172a;
  --code-text: #e2e8f0;
  --nav-active-bg: #eff6ff;
  --nav-active-border: #bfdbfe;
  --nav-active-badge-bg: #dbeafe;
  --nav-active-badge-border: #93c5fd;
  --chip-active-bg: #eff6ff;
  --chip-active-border: #93c5fd;
  --hub-bg: #eff6ff;
  --hub-border: #3b82f6;
  --hub-title: #1d4ed8;
  --btn-primary-bg: #0f172a;
  --btn-primary-border: #334155;
  --btn-primary-text: #ffffff;
  --btn-primary-hover: #1e293b;
  --row-hover: #eef2f7;
  --table-hover: rgba(15,23,42,0.03);
  --modal-bg: #ffffff;
  --modal-shadow: 0 20px 40px rgba(0,0,0,0.12);
  --logo-accent: #2563eb;
  --icon-badge-bg: #f3f6fa;
  --color-scheme: light;
}

*{box-sizing:border-box}
body{
  margin:0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Arabic", sans-serif;
  background-color: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  color-scheme: var(--color-scheme);
  transition: background-color 0.2s ease, color 0.2s ease;
}
/* Layout */
.app-container{display:flex;width:100%;min-height:100vh}
.sidebar{
  width:250px;
  background:var(--sidebar-bg);
  border-left:1px solid var(--border);
  display:flex;
  flex-direction:column;
  flex-shrink:0;
  position:sticky;
  top:0;
  height:100vh;
  transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s ease, border-color 0.2s ease;
  z-index: 100;
}
.sidebar-header{
  padding:16px 14px 14px;
  border-bottom:1px solid var(--border);
  position: relative;
  transition: padding 0.22s ease;
}
.sidebar-header-expanded{
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:6px;
  text-align:center;
  transition:opacity .15s ease;
}
.sidebar-header-compact{
  display:none;
  align-items:center;
  justify-content:center;
  padding:2px 0;
}
.sidebar-compact-logo{
  width:32px;
  height:32px;
  border-radius:8px;
  object-fit:contain;
  box-shadow:0 2px 8px rgba(0,0,0,0.25);
}
.sidebar-toggle-btn{
  display:flex;
  align-items:center;
  justify-content:space-between;
  width:100%;
  padding:4px 2px;
  border-radius:6px;
  border:none;
  background:transparent;
  color:var(--text-muted);
  cursor:pointer;
  font-size:12.5px;
  font-weight:500;
  transition:color .15s ease, opacity .15s ease;
  user-select:none;
}
.sidebar-toggle-btn:hover{
  background:transparent;
  border-color:transparent;
  color:var(--text);
}
.sidebar-toggle-btn-main{
  display:flex;
  align-items:center;
  gap:8px;
}
.sidebar-toggle-btn .toggle-icon{
  flex-shrink:0;
  transition:transform .22s cubic-bezier(0.4, 0, 0.2, 1);
}
[dir="rtl"] .sidebar-toggle-btn .toggle-icon{
  transform:scaleX(-1);
}
.sidebar-toggle-label{
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  transition:opacity .15s ease;
}
.theme-logo-dark{display:block}
.theme-logo-light{display:none}
[data-theme="light"] .theme-logo-dark{display:none}
[data-theme="light"] .theme-logo-light{display:block}
.sidebar-logo{
  font-size:16px;
  font-weight:700;
  letter-spacing:-0.02em;
  display:flex;
  align-items:center;
  gap:8px;
}
.sidebar-logo span{color:var(--logo-accent)}
.sidebar-version{
  font-size:10px;
  color:var(--text-dim);
  background:var(--card-subtle);
  border:1px solid var(--border);
  padding:2px 6px;
  border-radius:4px;
  font-family:var(--font-mono);
}
.btn-theme-toggle{
  width:32px;
  height:32px;
  border-radius:8px;
  padding:0;
  border:1px solid var(--border);
  background:var(--card-subtle);
  color:var(--text);
  cursor:pointer;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:15px;
  transition:all .15s ease;
  flex-shrink:0;
}
.btn-theme-toggle:hover{
  background:var(--card-hover);
  border-color:var(--border-focus);
  transform:scale(1.06);
}
.theme-switch-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  cursor:pointer;
  padding:8px 10px;
  border-radius:6px;
  border:1px solid var(--border);
  background:var(--card-subtle);
  transition:all .15s ease;
  user-select:none;
}
.theme-switch-row:hover{
  background:var(--card-hover);
  border-color:var(--border-focus);
}
.theme-pill-toggle{
  width:32px;
  height:18px;
  border-radius:10px;
  background:var(--border-focus);
  position:relative;
  transition:all .2s ease;
}
[data-theme="light"] .theme-pill-toggle{
  background:var(--primary);
}
.theme-pill-slider{
  width:14px;
  height:14px;
  border-radius:50%;
  background:#ffffff;
  position:absolute;
  top:2px;
  left:2px;
  transition:all .2s ease;
  box-shadow:0 1px 2px rgba(0,0,0,0.25);
}
[data-theme="light"] .theme-pill-slider{
  transform:translateX(14px);
}
.service-toggle-wrap{display:inline-flex;align-items:center}
.service-toggle{
  appearance:none;
  border:none;
  background:transparent;
  padding:0;
  margin:0;
  cursor:pointer;
  display:inline-flex;
  align-items:center;
  justify-content:center;
}
.service-toggle:disabled{opacity:.55;cursor:not-allowed}
.service-toggle-track{
  width:42px;
  height:24px;
  border-radius:999px;
  background:rgba(239,68,68,.35);
  border:1px solid rgba(239,68,68,.45);
  position:relative;
  transition:all .2s ease;
  box-shadow:inset 0 1px 2px rgba(0,0,0,.15);
}
.service-toggle-knob{
  width:18px;
  height:18px;
  border-radius:50%;
  background:#fff;
  position:absolute;
  top:2px;
  inset-inline-start:2px;
  transition:all .2s ease;
  box-shadow:0 1px 3px rgba(0,0,0,.25);
}
.service-toggle.is-on .service-toggle-track{
  background:rgba(34,197,94,.35);
  border-color:rgba(34,197,94,.5);
}
.service-toggle.is-on .service-toggle-knob{
  inset-inline-start:20px;
}
.sidebar-nav{
  padding:16px 8px;
  display:flex;
  flex-direction:column;
  gap:4px;
  flex:1;
  overflow-y:auto;
  overflow-x:hidden;
}
.nav-item{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:9px 12px;
  border-radius:6px;
  font-size:13px;
  color:var(--text-muted);
  cursor:pointer;
  transition:all .15s ease;
  user-select:none;
  border:1px solid transparent;
}
.nav-item-content{
  display:flex;
  align-items:center;
  gap:8px;
  min-width:0;
}
.nav-icon{
  flex-shrink:0;
  transition:transform .15s ease;
}
.nav-label{
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  transition:opacity .15s ease;
}
.nav-item:hover{
  background:var(--card-bg);
  color:var(--text);
  border-color:var(--border);
}
.nav-item:hover .nav-icon{
  transform:scale(1.08);
}
.nav-item.active{
  background:var(--nav-active-bg);
  color:var(--text);
  border-color:var(--nav-active-border);
  font-weight:600;
}
.nav-item.active .nav-icon{
  color:var(--primary);
}
.nav-badge{
  font-size:10px;
  padding:1px 6px;
  border-radius:10px;
  background:var(--card-subtle);
  border:1px solid var(--border);
  color:var(--text-dim);
  font-family:var(--font-mono);
}
.nav-item.active .nav-badge{
  background:var(--nav-active-badge-bg);
  border-color:var(--nav-active-badge-border);
  color:var(--primary);
}
.sidebar-footer{
  padding:14px 16px;
  border-top:1px solid var(--border);
  font-size:11px;
  color:var(--text-dim);
  display:flex;
  flex-direction:column;
  gap:6px;
  position:relative;
  transition:padding .22s ease;
}
.sidebar-footer-info{
  display:flex;
  flex-direction:column;
  gap:6px;
  transition:opacity .15s ease;
}
.sidebar-footer-compact-status{
  display:none;
  align-items:center;
  justify-content:center;
  padding:4px 0;
}
.settings-gear-btn{
  display:flex;
  align-items:center;
  justify-content:space-between;
  width:100%;
  padding:4px 2px;
  border-radius:6px;
  border:none;
  background:transparent;
  color:var(--text-muted);
  cursor:pointer;
  font-size:12.5px;
  font-weight:500;
  transition:color .15s ease, opacity .15s ease;
}
.settings-gear-btn:hover{
  background:transparent;
  border-color:transparent;
  color:var(--text);
}
.settings-gear-btn-main{
  display:flex;
  align-items:center;
  gap:8px;
}
.settings-panel{
  display:none;
  position:absolute;
  bottom:calc(100% - 8px);
  inset-inline-start:12px;
  inset-inline-end:12px;
  background:var(--card-bg);
  border:1px solid var(--border);
  border-radius:10px;
  box-shadow:0 12px 32px rgba(0,0,0,.35);
  padding:12px;
  z-index:1200;
  flex-direction:column;
  gap:10px;
}
.settings-panel.open{display:flex}

/* Sidebar Collapsed State */
.sidebar.collapsed{
  width:68px;
}
.sidebar.collapsed .sidebar-header{
  padding:12px 8px 10px;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:8px;
}
.sidebar.collapsed .sidebar-header-expanded{
  display:none;
}
.sidebar.collapsed .sidebar-header-compact{
  display:flex;
}
.sidebar.collapsed .sidebar-toggle-btn{
  width:42px;
  height:42px;
  padding:0;
  justify-content:center;
  align-items:center;
  margin:0 auto;
  border-radius:8px;
}
.sidebar.collapsed .sidebar-toggle-label{
  display:none;
}
.sidebar.collapsed .sidebar-toggle-btn-main{
  gap:0;
  justify-content:center;
}
.sidebar.collapsed .sidebar-toggle-btn .toggle-icon{
  transform:rotate(180deg);
}
[dir="rtl"] .sidebar.collapsed .sidebar-toggle-btn .toggle-icon{
  transform:scaleX(-1) rotate(180deg);
}
.sidebar.collapsed .sidebar-nav{
  padding:12px 8px;
  align-items:center;
  gap:6px;
}
.sidebar.collapsed .nav-item{
  width:44px;
  height:44px;
  padding:0;
  justify-content:center;
  align-items:center;
  margin:0 auto;
  border-radius:8px;
}
.sidebar.collapsed .nav-item-content{
  justify-content:center;
  gap:0;
}
.sidebar.collapsed .nav-label,
.sidebar.collapsed .nav-badge{
  display:none;
}
.sidebar.collapsed .sidebar-footer{
  padding:10px 8px;
  align-items:center;
  gap:8px;
}
.sidebar.collapsed .sidebar-footer-info{
  display:none;
}
.sidebar.collapsed .sidebar-footer-compact-status{
  display:flex;
}
.sidebar.collapsed .settings-gear-btn{
  width:42px;
  height:42px;
  padding:0;
  justify-content:center;
  align-items:center;
  margin:0 auto;
  border-radius:8px;
}
.sidebar.collapsed .settings-btn-label,
.sidebar.collapsed .settings-btn-trailing{
  display:none;
}
.sidebar.collapsed .settings-gear-btn-main{
  gap:0;
  justify-content:center;
}
.sidebar.collapsed .settings-panel{
  position:fixed;
  bottom:16px;
  width:268px;
  inset-inline-start:76px;
  inset-inline-end:auto;
  box-shadow:0 16px 40px rgba(0,0,0,.45);
}

/* Floating Tooltip */
.sidebar-floating-tooltip{
  position:fixed;
  z-index:9999;
  background:var(--card-bg);
  color:var(--text);
  border:1px solid var(--border-focus);
  padding:5px 10px;
  border-radius:6px;
  font-size:11.5px;
  font-weight:500;
  white-space:nowrap;
  box-shadow:0 6px 20px rgba(0,0,0,.4);
  pointer-events:none;
  opacity:0;
  transition:opacity .12s ease;
  line-height:1.3;
}

/* Early initialization override to prevent layout shifts */
html.sidebar-collapsed-init .sidebar {
  width: 68px !important;
  transition: none !important;
}
html.sidebar-collapsed-init .sidebar .sidebar-header-expanded,
html.sidebar-collapsed-init .sidebar .sidebar-footer-info,
html.sidebar-collapsed-init .sidebar .nav-label,
html.sidebar-collapsed-init .sidebar .nav-badge,
html.sidebar-collapsed-init .sidebar .settings-btn-label,
html.sidebar-collapsed-init .sidebar .settings-btn-trailing,
html.sidebar-collapsed-init .sidebar .sidebar-toggle-label {
  display: none !important;
}
html.sidebar-collapsed-init .sidebar .sidebar-header-compact,
html.sidebar-collapsed-init .sidebar .sidebar-footer-compact-status {
  display: flex !important;
}
.settings-panel-header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  font-size:12.5px;
  font-weight:700;
  color:var(--text);
  padding-bottom:6px;
  border-bottom:1px solid var(--border-subtle);
}
.settings-panel-section{
  display:flex;
  flex-direction:column;
  gap:8px;
}
.settings-row-label{
  font-size:11px;
  color:var(--text-muted);
  font-weight:600;
}
.settings-action-btn{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  width:100%;
  padding:8px 10px;
  border-radius:6px;
  border:1px solid var(--border);
  background:var(--card-subtle);
  color:var(--text);
  cursor:pointer;
  font-size:12px;
  transition:all .15s ease;
  text-align:start;
}
.settings-action-btn:hover{
  background:var(--card-hover);
  border-color:var(--border-focus);
}
.settings-version-text{
  font-family:var(--font-mono);
  font-size:11px;
  color:var(--text-dim);
}
.main-content{
  flex:1;
  padding:24px 32px;
  overflow-y:auto;
  max-width:1440px;
}
.view-panel{display:none}
.view-panel.active{display:block}

/* Header & Top Stats */
.page-header{
  margin-bottom:20px;
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  flex-wrap:wrap;
  gap:16px;
}
.page-title{margin:0 0 4px;font-size:20px;font-weight:700}
.page-subtitle{margin:0;font-size:13px;color:var(--text-muted)}

/* Enterprise Metric Cards */
.metrics-row{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
  gap:12px;
  margin-bottom:24px;
}
.metric-card{
  background:var(--card-bg);
  border:1px solid var(--border);
  border-radius:8px;
  padding:16px 18px;
  position:relative;
  overflow:hidden;
}
.metric-accent-bar{display:none !important}
.metric-label{
  font-size:12px;
  color:var(--text-muted);
  margin-bottom:6px;
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.metric-value{
  font-size:22px;
  font-weight:700;
  font-family:var(--font-mono);
  letter-spacing:-0.03em;
}
.metric-sub{font-size:11px;color:var(--text-dim);margin-top:6px}

/* Clean Panels & Sections */
.section-panel{
  background:var(--card-bg);
  border:1px solid var(--border);
  border-radius:8px;
  padding:20px;
  margin-bottom:20px;
}
.section-title{
  margin:0 0 16px;
  font-size:14.5px;
  font-weight:600;
  display:flex;
  align-items:center;
  justify-content:space-between;
}

/* Badges & Indicators */
.badge{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:3px 8px;
  border-radius:4px;
  font-size:11.5px;
  font-weight:500;
  background:var(--card-subtle);
  border:1px solid var(--border);
  color:var(--text-muted);
}
.badge-success{background:var(--success-bg);border-color:var(--success-border);color:var(--success)}
.badge-danger{background:var(--danger-bg);border-color:var(--danger-border);color:var(--danger)}
.badge-warn{background:var(--warn-bg);border-color:var(--warn-border);color:var(--warn)}

.status-dot{
  width:7px;
  height:7px;
  border-radius:50%;
  display:inline-block;
}
.dot-running{background:var(--success);box-shadow:0 0 6px rgba(16,185,129,0.4)}
.dot-stopped{background:#52525b}
.dot-starting{background:var(--warn)}
.dot-error{background:var(--danger)}

/* Buttons */
button, .btn{
  font-family:inherit;
  font-size:12px;
  font-weight:500;
  padding:6px 12px;
  border-radius:6px;
  border:1px solid var(--border);
  background:var(--card-bg);
  color:var(--text);
  cursor:pointer;
  transition:all .15s ease;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
}
button:hover, .btn:hover{
  background:var(--card-hover);
  border-color:var(--border-focus);
}
button:disabled{opacity:0.45;cursor:not-allowed}

.btn-primary{background:var(--btn-primary-bg);border-color:var(--btn-primary-border);color:var(--btn-primary-text)}
.btn-primary:hover{background:var(--btn-primary-hover)}

.btn-start{background:var(--success-bg);border-color:var(--success-border);color:var(--success)}
.btn-start:hover{background:rgba(16,185,129,0.18)}

.btn-stop{background:var(--danger-bg);border-color:var(--danger-border);color:var(--danger)}
.btn-stop:hover{background:rgba(239,68,68,0.18)}

.btn-sm{padding:4px 9px;font-size:11.5px;border-radius:4px}
/* Manual refresh in progress: show a spinner and block duplicate clicks */
.btn-sm.is-refreshing{opacity:0.75}
.btn-sm.is-refreshing::before{
  content:'';
  width:10px;
  height:10px;
  flex:none;
  border:1.5px solid currentColor;
  border-top-color:transparent;
  border-radius:50%;
  animation:btnSpin .6s linear infinite;
}
@keyframes btnSpin{to{transform:rotate(360deg)}}
.btn-copy{
  font-family:var(--font-mono);
  font-size:11px;
  padding:4px 8px;
  border-radius:4px;
  background:var(--card-subtle);
  border:1px solid var(--border);
  color:var(--text-muted);
}
.btn-copy:hover{color:var(--text);border-color:var(--border-focus)}

/* Account Chips Bar */
.account-chips{
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  align-items:center;
  padding:8px;
  background:var(--card-subtle);
  border:1px solid var(--border);
  border-radius:6px;
}
.account-chip{
  font-size:11.5px;
  padding:3px 8px;
  border-radius:4px;
  border:1px solid var(--border);
  background:var(--card-bg);
  color:var(--text-muted);
  cursor:pointer;
  display:inline-flex;
  align-items:center;
  gap:6px;
  transition:all .15s ease;
}
.account-chip:hover{border-color:var(--border-focus);color:var(--text)}
.account-chip.active{
  background:var(--chip-active-bg);
  border-color:var(--chip-active-border);
  color:var(--primary);
  font-weight:600;
}
.chip-delete-btn{
  background:transparent;
  border:none;
  color:var(--text-dim);
  font-size:14px;
  line-height:1;
  padding:0 2px 0 5px;
  margin-right:2px;
  cursor:pointer;
  border-radius:4px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  transition:all .15s ease;
}
.chip-delete-btn:hover{
  color:#ef4444;
  background:rgba(239,68,68,0.2);
}

/* Providers Grid */
.providers-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(380px,1fr));
  gap:16px;
}
.provider-card{
  background:var(--card-bg);
  border:1px solid var(--border);
  border-radius:8px;
  padding:14px 16px;
  display:flex;
  flex-direction:column;
  gap:0;
  transition:border-color .2s ease, box-shadow .2s ease, padding .2s ease;
}
.provider-card:hover,
.provider-card:focus-within{
  border-color:var(--border-focus);
  box-shadow:var(--shadow);
}
.provider-card-body{
  display:flex;
  flex-direction:column;
  gap:12px;
  max-height:0;
  opacity:0;
  overflow:hidden;
  margin-top:0;
  pointer-events:none;
  transition:max-height .28s ease, opacity .2s ease, margin-top .2s ease;
}
.provider-card:hover .provider-card-body,
.provider-card:focus-within .provider-card-body{
  max-height:2000px;
  opacity:1;
  margin-top:12px;
  pointer-events:auto;
}
.providers-filter-bar{
  background:var(--card-bg);
  border:1px solid var(--border);
  border-radius:10px;
  padding:14px 16px;
  margin-bottom:18px;
  display:flex;
  flex-direction:column;
  gap:10px;
}
.providers-filter-header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  flex-wrap:wrap;
  gap:8px;
}
.prov-filter-pills{
  display:flex;
  flex-wrap:wrap;
  gap:7px;
  align-items:center;
}
.prov-filter-pill{
  display:inline-flex;
  align-items:center;
  gap:7px;
  padding:6px 11px;
  border-radius:8px;
  font-size:12px;
  font-weight:500;
  background:var(--card-subtle);
  border:1px solid var(--border);
  color:var(--text-muted);
  cursor:pointer;
  user-select:none;
  transition:all .15s ease;
}
.prov-filter-pill:hover{
  border-color:var(--border-focus);
  color:var(--text);
  background:var(--card-hover);
  transform:translateY(-1px);
}
.prov-filter-pill.active{
  background:rgba(59,130,246,0.14);
  border-color:var(--primary);
  color:var(--text);
  font-weight:600;
  box-shadow:0 0 0 1px rgba(59,130,246,0.25);
}
.prov-filter-pill .brand-svg,
.prov-filter-pill img.brand-logo{
  width:16px !important;
  height:16px !important;
  max-width:16px;
  max-height:16px;
  object-fit:contain;
}
.prov-filter-pill .pill-count{
  font-family:var(--font-mono);
  font-size:10.5px;
  padding:1px 5px;
  border-radius:4px;
  background:var(--card-bg);
  border:1px solid var(--border);
  color:var(--text-dim);
}
.prov-filter-pill.active .pill-count{
  border-color:rgba(59,130,246,0.4);
  color:var(--primary);
}
.prov-filter-pill.prov-filter-pill-enabled.active{
  background:rgba(16,185,129,0.14);
  border-color:var(--success);
  box-shadow:0 0 0 1px rgba(16,185,129,0.25);
}
.prov-filter-pill.prov-filter-pill-enabled.active .pill-count{
  border-color:rgba(16,185,129,0.4);
  color:var(--success);
}
.provider-card-header{
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.provider-title-group{
  display:flex;
  align-items:center;
  gap:12px;
}
.provider-icon-badge{
  width:44px;
  height:44px;
  border-radius:10px;
  background:var(--icon-badge-bg);
  border:1px solid var(--border);
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
  box-shadow:0 1px 3px rgba(0,0,0,0.06);
  transition:all .15s ease;
}
.provider-card:hover .provider-icon-badge{
  border-color:var(--border-focus);
  transform:scale(1.03);
}
.provider-icon-badge svg{
  width:28px !important;
  height:28px !important;
}
.provider-toggles{
  display:flex;
  align-items:center;
  gap:10px;
  background:var(--bg-subtle, rgba(255,255,255,0.03));
  border:1px solid var(--border);
  border-radius:6px;
  padding:6px 10px;
  font-size:11.5px;
  flex-wrap:wrap;
  margin-top:2px;
}
.provider-toggle-item{
  display:inline-flex;
  align-items:center;
  gap:6px;
  cursor:pointer;
  user-select:none;
  color:var(--text-muted);
  transition:color .15s ease;
}
.provider-toggle-item:hover{
  color:var(--text);
}
.provider-toggle-item input[type="checkbox"]{
  cursor:pointer;
  accent-color:var(--primary);
  width:14px;
  height:14px;
  margin:0;
}
.provider-toggle-item.active{
  color:var(--text);
  font-weight:500;
}
/* Very small caveat shown only while Privacy Mode is enabled: private mode runs
   in Temporary Chat, where tools / image generation / special features are off. */
.privacy-mode-note{
  display:flex;
  align-items:flex-start;
  gap:4px;
  margin-top:3px;
  font-size:9.5px;
  line-height:1.5;
  color:var(--text-dim);
  opacity:.9;
}
.topo-icon-badge{
  width:36px;
  height:36px;
  border-radius:8px;
  background:var(--icon-badge-bg);
  border:1px solid var(--border);
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
}
.topo-icon-badge svg{
  width:22px !important;
  height:22px !important;
}
.table-icon-badge{
  width:32px;
  height:32px;
  border-radius:6px;
  background:var(--icon-badge-bg);
  border:1px solid var(--border);
  display:flex;
  align-items:center;
  justify-content:center;
  flex-shrink:0;
}
.table-icon-badge svg{
  width:20px !important;
  height:20px !important;
}
.provider-title-group h3{
  margin:0;
  font-size:13.5px;
  font-weight:600;
  letter-spacing:-0.01em;
  color:var(--text);
  line-height:1.3;
}
.provider-id-tag{
  font-family:var(--font-mono);
  font-size:10.5px;
  color:var(--text-dim);
  direction:ltr;
  display:inline-block;
  margin-top:2px;
}

.models-container{
  background:var(--card-subtle);
  border:1px solid var(--border);
  border-radius:6px;
  padding:8px;
  max-height:160px;
  overflow-y:auto;
}
label.model-row{
  display:flex;
  align-items:center;
  gap:8px;
  padding:4px 6px;
  border-radius:4px;
  font-size:12px;
  cursor:pointer;
  transition:background .1s ease;
}
label.model-row:hover{background:var(--row-hover)}
label.model-row code{font-family:var(--font-mono);direction:ltr;color:var(--text)}
/* A selected model that the provider no longer offers: shown, but clearly
   marked as unavailable instead of being presented as a healthy option. */
label.model-row.model-stale code{color:var(--text-dim);text-decoration:line-through}

/* Live model discovery — notification centre */
.providers-notify-bar{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
  margin:10px 0 12px;
}
.model-notif-panel{
  border:1px solid var(--border);
  border-radius:8px;
  background:var(--card-bg);
  padding:8px;
  margin-bottom:14px;
  max-height:340px;
  overflow-y:auto;
}
.model-notif-item{
  display:flex;
  gap:10px;
  padding:8px;
  border-radius:6px;
  border:1px solid transparent;
}
.model-notif-item + .model-notif-item{border-top:1px solid var(--border-subtle)}
.model-notif-item.unread{background:var(--card-subtle);border-color:var(--border)}
.model-notif-icon{
  font-size:14px;
  line-height:1.4;
  color:var(--primary);
  min-width:18px;
  text-align:center;
}
.model-notif-body{flex:1;min-width:0}
.model-notif-title{font-size:12px;margin-bottom:2px}

/* Interactive Topology Graph - Live Flow */
.topology-box{
  background:var(--card-bg);
  border:1px solid var(--border);
  border-radius:10px;
  padding:20px;
  margin-bottom:24px;
  position:relative;
  overflow:hidden;
}
.topology-header-bar{
  display:flex;
  justify-content:space-between;
  align-items:center;
  flex-wrap:wrap;
  gap:12px;
  margin-bottom:18px;
  padding-bottom:14px;
  border-bottom:1px solid var(--border);
}
.topology-controls{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}
.topo-chip{
  font-size:11px;
  font-family:var(--font-mono);
  background:var(--card-bg);
  border:1px solid var(--border);
  padding:3px 9px;
  border-radius:6px;
  color:var(--text-muted);
  display:inline-flex;
  align-items:center;
  gap:5px;
}
.topo-chip strong{color:var(--text);font-weight:600}
.btn-ping-pulse{
  background:var(--card-bg);
  border:1px solid var(--border);
  color:var(--text);
  font-size:11px;
  font-weight:600;
  padding:5px 12px;
  border-radius:6px;
  cursor:pointer;
  display:inline-flex;
  align-items:center;
  gap:6px;
  transition:all .15s ease;
}
.btn-ping-pulse:hover{
  background:var(--card-hover);
  border-color:var(--primary);
  color:var(--primary);
  transform:translateY(-1px);
}
.btn-ping-pulse:active{
  transform:scale(0.97);
}
.topology-flow-wrapper{
  position:relative;
  min-height:264px;
  padding:6px 0;
  display:flex;
}
/* Ambient dot-grid backdrop, soft-masked so nodes stay readable */
.topology-flow-wrapper::before{
  content:'';
  position:absolute;
  inset:0;
  z-index:0;
  pointer-events:none;
  background-image:radial-gradient(rgba(148,163,184,0.13) 1px, transparent 1px);
  background-size:24px 24px;
  mask-image:radial-gradient(ellipse at center, black 42%, transparent 80%);
  -webkit-mask-image:radial-gradient(ellipse at center, black 42%, transparent 80%);
}
.topology-svg-overlay{
  position:absolute;
  top:0;
  left:0;
  width:100%;
  height:100%;
  pointer-events:none;
  z-index:1;
  overflow:visible;
}
/* The grid fills the wrapper height so the columns (and their nodes) use the
   whole panel instead of collapsing into a thin band with dead space around
   the hub. */
.topology-flow{
  display:grid;
  grid-template-columns:1fr 1fr 1fr;
  /* Breathing room between Inbound, Core and Upstream. Scales with the
     viewport on narrower desktops so the three columns never collide. */
  gap:clamp(64px, 9vw, 124px);
  align-items:stretch;
  position:relative;
  z-index:2;
  flex:1;
  min-height:252px;
}
@media(max-width:960px){
  .topology-flow{
    grid-template-columns:1fr;
    gap:32px;
    min-height:0;
  }
  .topology-flow-wrapper{
    min-height:0;
  }
}
.topology-col{
  display:flex;
  flex-direction:column;
  gap:14px;
  position:relative;
}
.topology-col-title{
  font-size:12px;
  color:var(--text-muted);
  font-weight:600;
  margin-bottom:4px;
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.topology-node{
  background:var(--card-bg);
  border:1px solid var(--border);
  border-radius:7px;
  padding:11px 14px;
  font-size:12px;
  position:relative;
  transition:border-color .18s ease, background .18s ease, transform .18s ease, box-shadow .18s ease;
  user-select:none;
}
.topology-node:hover{
  border-color:var(--primary);
  background:var(--card-hover);
  transform:translateY(-1px);
  box-shadow:0 4px 12px rgba(0,0,0,0.06);
}
.topology-node.node-highlight{
  border-color:var(--primary) !important;
  box-shadow:0 0 14px rgba(59,130,246,0.35) !important;
}
.topology-node.node-privacy.node-highlight{
  border-color:#10b981 !important;
  box-shadow:0 0 14px rgba(16,185,129,0.4) !important;
}
.topology-node:focus-visible{
  outline:2px solid var(--primary);
  outline-offset:2px;
  border-color:var(--primary);
}
.topology-node.node-privacy:focus-visible{
  outline-color:#10b981;
}
.topo-port{
  position:absolute;
  width:8px;
  height:8px;
  border-radius:50%;
  background:var(--border);
  border:2px solid var(--card-bg);
  top:50%;
  transform:translateY(-50%);
  transition:background .2s ease, transform .2s ease, box-shadow .2s ease;
  z-index:3;
  pointer-events:none;
}
.topo-port.port-left{left:-5px}
.topo-port.port-right{right:-5px}
.topology-node:hover .topo-port,
.topology-node.node-highlight .topo-port{
  background:var(--primary);
  box-shadow:0 0 8px var(--primary);
  transform:translateY(-50%) scale(1.3);
}
.topology-node.node-privacy:hover .topo-port,
.topology-node.node-privacy.node-highlight .topo-port{
  background:#10b981;
  box-shadow:0 0 8px #10b981;
}
.topology-node.hub{
  border-color:var(--hub-border);
  background:var(--hub-bg);
  text-align:center;
  display:flex;
  flex-direction:column;
  justify-content:center;
  align-items:center;
  padding:8px 12px;
  width:fit-content;
  min-width:150px;
  margin:auto;
}
.hub-beacon-wrap{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:5px;
  margin-bottom:3px;
}
.hub-beacon-pulse{
  position:relative;
  width:7px;
  height:7px;
  border-radius:50%;
  background:var(--primary);
  box-shadow:0 0 8px var(--primary);
}
.hub-beacon-pulse::after{
  content:'';
  position:absolute;
  inset:-4px;
  border-radius:50%;
  border:2px solid var(--primary);
  opacity:0.8;
  animation:hubRadarPulse 2s cubic-bezier(0,0,0.2,1) infinite;
}
@keyframes hubRadarPulse{
  0%{transform:scale(0.8);opacity:1}
  100%{transform:scale(2.4);opacity:0}
}
.hub-stopped .hub-beacon-pulse{
  background: var(--danger) !important;
  box-shadow: 0 0 6px var(--danger) !important;
}
.hub-stopped .hub-beacon-pulse::after{
  display: none !important;
}
.hub-metrics-ticker{
  font-size:8.5px;
  font-family:var(--font-mono);
  color:var(--text-muted);
  border-top:1px dashed var(--border);
  padding-top:3px;
  display:flex;
  justify-content:center;
  align-items:center;
  gap:4px;
  direction:ltr;
  white-space:nowrap;
}
.hub-metrics-ticker b{color:var(--text);font-weight:600}
.hub-sep{color:var(--text-dim)}.conduit-bg{
  stroke:rgba(148, 163, 184, 0.16);
  stroke-width:2.5px;
  fill:none;
  stroke-linecap:round;
  transition:stroke .2s ease, stroke-width .2s ease, opacity .2s ease;
}
.conduit-flow{
  stroke:#3b82f6;
  stroke-width:2px;
  fill:none;
  stroke-linecap:round;
  stroke-dasharray:6 10;
  animation:flowDash 1.2s linear infinite;
  transition:stroke .2s ease, stroke-width .2s ease, opacity .2s ease;
}
.conduit-flow.privacy{
  stroke:#10b981;
  stroke-dasharray:6 8;
  filter:drop-shadow(0 0 3px rgba(16,185,129,0.4));
}
.conduit-flow.highlighted{
  stroke:#60a5fa !important;
  stroke-width:3.5px !important;
  filter:drop-shadow(0 0 6px rgba(96,165,250,0.8)) !important;
  opacity:1 !important;
}
.conduit-flow.privacy.highlighted{
  stroke:#34d399 !important;
  stroke-width:3.5px !important;
  filter:drop-shadow(0 0 6px rgba(52,211,153,0.9)) !important;
  opacity:1 !important;
}
.conduit-flow.dimmed,
.conduit-bg.dimmed{
  opacity:0.12 !important;
}
.conduit-flow.dormant{
  stroke: var(--border-focus) !important;
  stroke-dasharray: 4 6 !important;
  animation: none !important;
  opacity: 0.35 !important;
  filter: none !important;
}
/* Shared bus lines (horizontal topology): a neutral vertical spine plus one
   connector into each hub port; the per-node stubs ride on top of it */
.topo-trunk{
  stroke:rgba(148,163,184,0.22);
  stroke-width:2.5px;
}
.section-highlight-pulse{
  animation: sectionHighlight 1.5s ease-out;
}
@keyframes sectionHighlight{
  0%{box-shadow: 0 0 0 4px rgba(59,130,246,0.6); border-color: #3b82f6;}
  100%{box-shadow: none; border-color: var(--border);}
}
.table-agent-badge{
  display:inline-flex;
  align-items:center;
  gap:6px;
  background:var(--card-subtle);
  border:1px solid var(--border);
  border-radius:6px;
  padding:2px 8px;
  font-size:11px;
  font-weight:500;
}
.particle-dot{
  fill:#60a5fa;
  filter:drop-shadow(0 0 4px #3b82f6);
  pointer-events:none;
  transition:opacity .2s ease;
}
.particle-dot.privacy{
  fill:#34d399;
  filter:drop-shadow(0 0 4px #10b981);
}
.particle-dot.dimmed{
  opacity:0.05 !important;
}
@keyframes flowDash{
  from{stroke-dashoffset:32}
  to{stroke-dashoffset:0}
}
/* Only paths that are genuinely flowing may pulse: dormant links must never
   light up as if traffic were crossing them. */
.ping-pulse-active .conduit-flow:not(.dormant){
  stroke-width:4px !important;
  animation-duration:0.4s !important;
  filter:drop-shadow(0 0 8px var(--primary)) !important;
}
.ping-pulse-active .conduit-flow.privacy:not(.dormant){
  filter:drop-shadow(0 0 8px #10b981) !important;
}
.ping-pulse-active .hub-beacon-pulse{
  transform:scale(1.4);
  box-shadow:0 0 18px var(--primary);
}

/* Edge labels: agent name + brand icon riding each connection line */
.topology-edge-labels{
  position:absolute;
  inset:0;
  pointer-events:none;
  z-index:4;
}
.topo-edge-label{
  position:absolute;
  transform:translate(-50%,-50%);
  display:inline-flex;
  align-items:center;
  gap:4px;
  background:var(--card-bg);
  border:1px solid var(--border);
  border-radius:5px;
  padding:1px 6px 1px 5px;
  font-size:9.5px;
  font-family:var(--font-mono);
  color:var(--text-muted);
  white-space:nowrap;
  direction:ltr;
  box-shadow:0 1px 3px rgba(0,0,0,0.06);
  opacity:0;
  pointer-events:none;
  transition:border-color .2s ease, color .2s ease, opacity .2s ease;
}
.topo-edge-label svg{width:11px;height:11px;flex:none}
.topo-edge-label.active{
  opacity:1;
  pointer-events:auto;
  border-color:var(--primary);
  color:var(--text);
  box-shadow:0 0 10px rgba(59,130,246,0.3);
}
.topo-edge-label.dormant{opacity:0;pointer-events:none}

/* Per-agent nodes (one per agent/IDE) — capped width so the columns stay
   compact but with room to breathe; anchored to the hub-facing edge */
.topology-node.topo-agent{
  padding:10px 13px;
  min-height:52px;
  border-radius:9px;
  width:100%;
  max-width:300px;
  margin-inline-start:auto;
  display:flex;
  flex-direction:column;
  gap:5px;
}
.topo-node-header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  width:100%;
}
.topo-node-main{
  display:flex;
  align-items:center;
  gap:8px;
  min-width:0;
  flex:1;
}
.topo-agent .topo-icon-badge{
  width:20px;
  height:20px;
  border-radius:5px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  background:var(--card-subtle);
  border:1px solid var(--border);
  flex:none;
}
.topo-agent .topo-icon-badge svg{
  width:12px !important;
  height:12px !important;
}
.topo-agent .topo-icon-badge img.brand-logo{
  width:100% !important;
  height:100% !important;
  max-width:none;
  max-height:none;
}
.topo-agent .topo-provider-name{
  font-size:12px;
  font-weight:600;
  line-height:1.2;
}
.topo-status-badge{
  display:flex;
  align-items:center;
  gap:4px;
  flex:none;
}
.topo-pulse-badge{
  animation:topoPulseGlow 2s infinite ease-in-out;
}
@keyframes topoPulseGlow{
  0%,100%{box-shadow:0 0 4px rgba(16,185,129,0.3)}
  50%{box-shadow:0 0 10px rgba(16,185,129,0.7)}
}
.topo-req-chips{
  display:flex;
  align-items:center;
  gap:5px;
  flex-wrap:wrap;
  width:100%;
}
.topo-model-chip{
  font-size:9.5px;
  font-family:var(--font-mono);
  background:var(--card-subtle);
  border:1px solid var(--border);
  color:var(--text);
  padding:1px 6px;
  border-radius:4px;
  direction:ltr;
  max-width:140px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.topo-stream-chip{
  font-size:8.5px;
  font-weight:600;
  color:#f59e0b;
  background:rgba(245,158,11,0.1);
  border:1px solid rgba(245,158,11,0.25);
  padding:1px 5px;
  border-radius:4px;
}
.topo-sync-chip{
  font-size:8.5px;
  font-weight:500;
  color:var(--text-dim);
  background:var(--card-subtle);
  border:1px solid var(--border);
  padding:1px 5px;
  border-radius:4px;
}
.topo-node-footer{
  display:flex;
  align-items:center;
  justify-content:space-between;
  font-size:9.5px;
  color:var(--text-muted);
  border-top:1px dashed var(--border);
  padding-top:4px;
  margin-top:2px;
  width:100%;
}
.topo-dest-badge{
  display:inline-flex;
  align-items:center;
  gap:3px;
  font-size:9.5px;
  color:var(--text-muted);
}
.topo-dest-badge strong{
  color:var(--text);
  font-weight:600;
}
.topo-metrics-text{
  font-family:var(--font-mono);
  direction:ltr;
  font-size:9.5px;
  color:var(--text-dim);
}
.topo-acc-pill{
  font-size:9px;
  color:var(--text-dim);
  direction:ltr;
  max-width:130px;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.topology-node.node-inflight{
  border-color:var(--primary) !important;
  box-shadow:0 0 14px rgba(59,130,246,0.3) !important;
  animation:topoInFlightBorder 2s infinite ease-in-out;
}
@keyframes topoInFlightBorder{
  0%,100%{border-color:rgba(59,130,246,0.5);box-shadow:0 0 8px rgba(59,130,246,0.25)}
  50%{border-color:rgba(59,130,246,1);box-shadow:0 0 16px rgba(59,130,246,0.45)}
}
/* Green port when this agent had live traffic recently */
.topology-node[data-status="active"] .topo-port,
.topology-node[data-status="inflight"] .topo-port{
  background:#10b981;
  box-shadow:0 0 8px rgba(16,185,129,0.7);
}
/* Serving real request traffic right now (agents and providers) */
.topology-node[data-live="1"] .topo-port{
  background:#10b981;
  box-shadow:0 0 8px rgba(16,185,129,0.7);
}
/* Provider chip on a live agent node: the upstream it actually reached */
.topo-live-prov{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  flex:none;
  width:18px;
  height:18px;
  border-radius:4px;
  overflow:hidden;
}
.topo-live-prov svg,
.topo-live-prov .brand-native svg{width:12px;height:12px}
.topo-live-prov img{width:100%;height:100%;object-fit:contain}
/* Empty state: no live traffic in a column */
.topo-empty,
.topo-empty-state{
  border:1px dashed var(--border);
  border-radius:10px;
  padding:20px 16px;
  background:rgba(255,255,255,0.015);
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
  gap:6px;
  max-width:280px;
  width:100%;
  box-sizing:border-box;
}
/* Empty-state cards hug the hub-facing edge in each column (RTL/LTR aware) */
#topColAgents .topo-empty,
#topColAgents .topo-empty-state{
  margin-inline-start:auto;
  margin-inline-end:0;
}
#topColProviders .topo-empty,
#topColProviders .topo-empty-state{
  margin-inline-end:auto;
  margin-inline-start:0;
}
.topo-empty-icon{
  width:38px;
  height:38px;
  border-radius:50%;
  background:var(--bg-subtle, rgba(255,255,255,0.03));
  border:1px solid var(--border);
  display:flex;
  align-items:center;
  justify-content:center;
  margin-bottom:4px;
  flex:none;
}
.topo-empty-title{
  font-size:12px;
  font-weight:600;
  color:var(--text-main);
  letter-spacing:-0.2px;
}
.topo-empty-desc{
  font-size:10.5px;
  line-height:1.45;
  color:var(--text-muted);
}

/* Upstream nodes are intentionally more compact than agent nodes */
.topology-node.topo-provider{
  padding:10px 13px;
  min-height:52px;
  border-radius:9px;
  width:100%;
  max-width:300px;
  margin-inline-end:auto;
  display:flex;
  flex-direction:column;
  gap:5px;
}
.topo-provider .topo-icon-badge{
  width:22px;
  height:22px;
  border-radius:5px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  background:var(--card-subtle);
  border:1px solid var(--border);
  flex:none;
}
.topo-provider .topo-icon-badge svg{
  width:13px !important;
  height:13px !important;
}
.topo-provider .topo-icon-badge img.brand-logo{
  width:100% !important;
  height:100% !important;
  max-width:none;
  max-height:none;
}
.topo-provider .topo-provider-name{
  font-size:12px;
  font-weight:600;
  line-height:1.2;
}
.topo-provider .topo-provider-email{
  font-size:9px;
  color:var(--text-dim);
  margin-top:1px;
}

/* Flow legend swatches */
.topo-legend-item{
  display:inline-flex;
  align-items:center;
  gap:5px;
  font-size:10.5px;
  font-family:var(--font-mono);
  color:var(--text-muted);
}
.legend-swatch{
  width:16px;
  height:3px;
  border-radius:2px;
  display:inline-block;
}
.swatch-flow{background:#3b82f6;box-shadow:0 0 4px rgba(59,130,246,0.6)}
.swatch-privacy{background:#10b981;box-shadow:0 0 4px rgba(16,185,129,0.6)}
.swatch-dormant{background:var(--border-focus)}

/* Respect reduced-motion preferences */
@media(prefers-reduced-motion:reduce){
  .conduit-flow{animation:none}
  .particle-dot{display:none}
  .hub-beacon-pulse::after{animation:none;opacity:.45}
  .btn-ping-pulse:hover{transform:none}
  .topology-node:hover{transform:none}
}

/* Agent Connect */
.agent-connect-layout{
  display:block;
  border:1px solid var(--border);
  border-radius:10px;
  overflow:hidden;
  background:var(--card-bg);
  box-shadow:0 1px 2px rgba(0,0,0,.04);
}
.agent-detail-pane{
  padding:20px;
  display:flex;
  flex-direction:column;
  gap:16px;
}
.connect-tabs{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  padding:6px;
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--card-subtle);
}
.connect-tab{
  appearance:none;
  border:1px solid transparent;
  background:transparent;
  color:var(--text-muted);
  padding:8px 14px;
  border-radius:8px;
  font-size:12.5px;
  font-weight:600;
  cursor:pointer;
  transition:all .15s ease;
}
.connect-tab:hover{color:var(--text);background:var(--card-bg)}
.connect-tab.active{
  color:var(--text);
  background:var(--card-bg);
  border-color:var(--border);
  box-shadow:0 1px 2px rgba(0,0,0,.06);
}
.connect-mode-panel{display:none;flex-direction:column;gap:14px}
.connect-mode-panel.active{display:flex}
.connect-mode-card{
  border:1px solid var(--border);
  border-radius:10px;
  background:var(--card-subtle);
  padding:14px;
}
.connect-mode-title{font-size:13px;font-weight:700;margin:0 0 4px;color:var(--text)}
.connect-mode-desc{font-size:12px;color:var(--text-muted);margin:0}
.connect-grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}

/* Connect Code Boxes */
.code-container{
  background:var(--code-bg);
  border:1px solid var(--border);
  border-radius:6px;
  padding:14px;
  font-family:var(--font-mono);
  font-size:12px;
  color:var(--code-text);
  position:relative;
  direction:ltr;
  text-align:left;
  overflow-x:auto;
}
.form-input{
  width:100%;
  background:var(--card-subtle);
  border:1px solid var(--border);
  border-radius:6px;
  padding:8px 10px;
  color:var(--text);
  font-size:13px;
  outline:none;
}
.form-input:focus{border-color:var(--primary)}

/* Tables */
.data-table{
  width:100%;
  border-collapse:collapse;
  font-size:12.5px;
  text-align:right;
}
.data-table th{
  padding:10px 12px;
  border-bottom:1px solid var(--border);
  color:var(--text-muted);
  font-weight:600;
}
.data-table td{
  padding:12px;
  border-bottom:1px solid var(--border);
  color:var(--text);
}
.data-table tr:hover td{background:var(--table-hover)}

/* Modal Dialog */
.modal-overlay{
  position:fixed;
  inset:0;
  background:rgba(0,0,0,0.6);
  backdrop-filter:blur(2px);
  display:none;
  align-items:center;
  justify-content:center;
  z-index:9999;
}
.modal-overlay.open{display:flex}
.modal-card{
  background:var(--modal-bg);
  border:1px solid var(--border-focus);
  box-shadow:var(--modal-shadow);
  border-radius:8px;
  width:480px;
  max-width:92%;
  padding:20px;
}
.form-group{margin-bottom:14px}
.form-group label{display:block;font-size:12px;color:var(--text-muted);margin-bottom:6px}

/* Toast Alerts */
#toastList{
  position:fixed;
  bottom:24px;
  left:24px;
  z-index:10000;
  display:flex;
  flex-direction:column;
  gap:8px;
  pointer-events:none;
}
.toast-msg{
  background:var(--card-bg);
  border:1px solid var(--border-focus);
  border-radius:6px;
  padding:10px 14px;
  font-size:12px;
  color:var(--text);
  box-shadow:var(--modal-shadow);
  display:flex;
  align-items:center;
  gap:8px;
  pointer-events:auto;
  animation:fade-in .2s ease;
}
@keyframes fade-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}

/* Brand & Provider Vector Icon Optical Alignment */
.brand-svg,
img.brand-logo{
  vertical-align:middle;
  flex-shrink:0;
  shape-rendering:geometricPrecision;
  filter:drop-shadow(0 1px 2px rgba(0,0,0,0.22));
  transition:transform .18s cubic-bezier(0.22,1,0.36,1),filter .18s ease;
}
.brand-svg{
  display:inline-block;
}
img.brand-logo{
  width:20px;
  height:20px;
  max-width:28px;
  max-height:28px;
  object-fit:contain;
}
img.brand-logo.theme-logo-light{display:none !important}
[data-theme="light"] img.brand-logo.theme-logo-dark{display:none !important}
[data-theme="light"] img.brand-logo.theme-logo-light{display:inline-block !important}
.provider-icon-badge img.brand-logo{
  width:100% !important;
  height:100% !important;
  max-width:none;
  max-height:none;
}
[data-theme="light"] .brand-svg{
  filter:drop-shadow(0 1px 1.5px rgba(15,23,42,0.1));
}
.topo-icon-badge,.agent-client-item span:first-child,.table-agent-badge{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  line-height:1;
}
.table-agent-badge{
  gap:6px;
  padding:3px 8px;
  border-radius:6px;
  background:var(--card-subtle);
  border:1px solid var(--border);
  font-size:11.5px;
  font-weight:500;
}
.provider-card:hover .brand-svg,.topology-node:hover .brand-svg,.agent-client-item:hover .brand-svg{
  transform:scale(1.07);
}
/* Official downloaded vendor logos (img) — fill the whole icon badge: the
   badge box defines the size, the img stretches edge-to-edge over it */
img.brand-logo{
  width:100%;
  height:100%;
  display:inline-block;
  max-width:none;
  max-height:none;
  object-fit:contain;
  border-radius:inherit;
}
/* Dark monochrome glyphs (arena column, Kimi K) become white in dark theme */
[data-theme="dark"] .brand-invert{
  filter:invert(1);
}
/* Native logos: downloaded brand logos render bare — no badge frame,
   background or backdrop shadow; only the logo itself is visible */
.provider-icon-badge:has(img.brand-logo),
.topo-icon-badge:has(img.brand-logo),
.table-icon-badge:has(img.brand-logo){
  background:transparent;
  border:none;
  box-shadow:none;
}
/* Same native treatment for provider glyphs rendered inside .brand-native
   (claude, gemini, qwen, mistral — see NATIVE_ICON_BRANDS) */
.provider-icon-badge:has(.brand-native),
.topo-icon-badge:has(.brand-native),
.table-icon-badge:has(.brand-native){
  background:transparent;
  border:none;
  box-shadow:none;
}
/* Edge chips / labels that reach agents also get brand logos */
.topo-chip img.brand-logo{
  width:13px;
  height:13px;
  max-width:13px;
  max-height:13px;
  border-radius:3px;
  object-fit:contain;
}

/* Directional layout support for LTR/RTL */
[dir="ltr"] .sidebar {
  border-left: none;
  border-right: 1px solid var(--border);
}
[dir="ltr"] .agent-clients-list {
  border-left: none;
  border-right: 1px solid var(--border);
}
[dir="ltr"] .chip-delete-btn {
  margin-right: 0;
  margin-left: 2px;
  padding: 0 5px 0 2px;
}
[dir="ltr"] .topology-node.hub .port-in {
  left: -5px;
  right: auto;
}
[dir="ltr"] .topology-node.hub .port-out {
  right: -5px;
  left: auto;
}
[dir="ltr"] #topologyAgentList .topo-port {
  right: -5px;
  left: auto;
}
[dir="ltr"] #topologyActiveList .topo-port {
  left: -5px;
  right: auto;
}
[dir="rtl"] .topology-node.hub .port-in {
  right: -5px;
  left: auto;
}
[dir="rtl"] .topology-node.hub .port-out {
  left: -5px;
  right: auto;
}
[dir="rtl"] #topologyAgentList .topo-port {
  left: -5px;
  right: auto;
}
[dir="rtl"] #topologyActiveList .topo-port {
  right: -5px;
  left: auto;
}
</style>
</head>
<body>

<div id="toastList"></div>
<div id="sidebarFloatingTooltip" class="sidebar-floating-tooltip" aria-hidden="true"></div>

<div class="app-container">
  <!-- Sidebar Navigation -->
  <aside class="sidebar" id="appSidebar">
    <div class="sidebar-header">
      <div class="sidebar-header-expanded">
        <div style="width:100%;display:flex;align-items:center;justify-content:center;padding:2px 0 0">
          <img src="/logo-dark.png" alt="EMO-AI Logo" class="theme-logo-dark" style="width:100%;max-width:192px;height:auto;object-fit:contain"/>
          <img src="/logo-light.png" alt="EMO-AI Logo" class="theme-logo-light" style="width:100%;max-width:192px;height:auto;object-fit:contain"/>
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:4px">
          <span style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-muted)">Gateway Engine</span>
          <span class="sidebar-version" style="font-size:9.5px;padding:1px 6px">v0.1.0</span>
        </div>

      </div>

      <div class="sidebar-header-compact">
        <img src="/favicon.png" alt="EMO-AI" class="sidebar-compact-logo"/>
      </div>
    </div>

    <nav class="sidebar-nav">
      <div class="nav-item active" data-nav="overview" data-tooltip="لوحة التحكم وإدارة البوابة" data-i18n-tooltip="navOverview" onclick="navigate('overview', this)">
        <div class="nav-item-content">
          <svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
          <span class="nav-label" data-i18n="navOverview">لوحة التحكم وإدارة البوابة</span>
        </div>
        <span class="nav-badge" id="badgeActiveProv">0</span>
      </div>
      <div class="nav-item" data-nav="usage" data-tooltip="سجل الطلبات" data-i18n-tooltip="navUsage" onclick="navigate('usage', this)">
        <div class="nav-item-content">
          <svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span class="nav-label" data-i18n="navUsage">سجل الطلبات</span>
        </div>
        <span class="nav-badge" id="badgeTotalRequestsCount">0</span>
      </div>

      <div class="nav-item" data-nav="providers" data-tooltip="المزوّدات والنماذج" data-i18n-tooltip="navProviders" onclick="navigate('providers', this)">
        <div class="nav-item-content">
          <svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          <span class="nav-label" data-i18n="navProviders">المزوّدات والنماذج</span>
        </div>
        <span class="nav-badge" id="badgeTotalProviders">15</span>
      </div>
      <div class="nav-item" data-nav="accounts" data-tooltip="الحسابات" data-i18n-tooltip="navAccounts" onclick="navigate('accounts', this)">
        <div class="nav-item-content">
          <svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span class="nav-label" data-i18n="navAccounts">الحسابات</span>
        </div>
        <span class="nav-badge" id="badgeTotalAccounts">0</span>
      </div>
      <div class="nav-item" data-nav="keys" data-tooltip="المفاتيح والمزودات" data-i18n-tooltip="navKeys" onclick="navigate('keys', this)">
        <div class="nav-item-content">
          <svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
          <span class="nav-label" data-i18n="navKeys">المفاتيح والمزودات</span>
        </div>
        <span class="nav-badge" id="badgeTotalKeys">1</span>
      </div>
      <div class="nav-item" data-nav="swarm" data-tooltip="موجه الوكلاء (Swarm)" data-i18n-tooltip="navSwarm" onclick="navigate('swarm', this)">
        <div class="nav-item-content">
          <svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
          <span class="nav-label" data-i18n="navSwarm">موجه الوكلاء (Swarm)</span>
        </div>
        <span class="nav-badge" style="background:#8b5cf6;color:#fff">Active</span>
      </div>
    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-footer-info">
        <div><span data-i18n="identifierLabel">المعرّف:</span> <code style="font-family:var(--font-mono);color:var(--text)">emo-web.ai/v1</code></div>
        <div><span data-i18n="endpointLabel">نقطة النهاية:</span> <span style="font-family:var(--font-mono)">127.0.0.1:8989</span></div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
          <span class="status-dot dot-running" id="sbDot"></span>
          <span id="sbStatusText" style="color:var(--success)" data-i18n="gatewayConnected">البوابة متصلة</span>
        </div>
      </div>

      <div class="sidebar-footer-compact-status" id="sbStatusCompact" title="البوابة متصلة" data-tooltip="البوابة متصلة" data-i18n-tooltip="statusOnline">
        <span class="status-dot dot-running" id="sbDotMini"></span>
      </div>

      <button type="button" class="settings-gear-btn" onclick="navigate('settings', null)" title="الإعدادات" data-i18n-title="settingsTitle" data-tooltip="الإعدادات" data-i18n-tooltip="settingsTitle">
        <span class="settings-gear-btn-main">
          <svg class="settings-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span class="settings-btn-label" data-i18n="settingsTitle">الإعدادات</span>
        </span>
        <span class="settings-btn-trailing" style="font-size:11px;color:var(--text-dim)">⚙</span>
      </button>

      <button type="button" class="sidebar-toggle-btn" id="sidebarToggleBtn" onclick="toggleSidebarCollapse()" title="طي القائمة الجانبية" data-i18n-title="sidebarToggleCollapse" data-tooltip="طي القائمة الجانبية" data-i18n-tooltip="sidebarToggleCollapse" aria-label="Toggle Sidebar">
        <span class="sidebar-toggle-btn-main">
          <svg class="toggle-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2"/>
            <path d="M9 3v18"/>
            <path d="m14 9-3 3 3 3"/>
          </svg>
          <span class="sidebar-toggle-label" data-i18n="sidebarToggleCollapse">طي القائمة الجانبية</span>
        </span>
      </button>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main-content">
    
    <!-- View 1: Overview & Graph -->
    <div id="view-overview" class="view-panel active">
      <div class="page-header" style="flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between">
        <div>
          <h1 class="page-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:16px;font-weight:700">
            <span data-i18n="overviewTitle">لوحة التحكم</span>
            <span class="badge badge-success" id="serviceStateBadge" style="font-size:11px;padding:3px 8px;gap:6px">
              <span class="status-dot dot-running" id="serviceStateDot"></span>
              <span id="serviceStateText" data-i18n="serviceRunning">الخدمة نشطة</span>
            </span>
          </h1>
          <p class="page-subtitle" data-i18n="overviewSubtitle">حالة البوابة، مسارات الربط، ومؤشرات الأداء</p>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="service-toggle-wrap" title="تشغيل أو إيقاف استقبال الطلبات على البوابة" data-i18n-title="serviceToggleTitle">
            <button type="button" class="service-toggle is-on" id="btnToggleGatewayService" onclick="toggleGatewayService()" role="switch" aria-checked="true" aria-label="تشغيل أو إيقاف استقبال الطلبات على البوابة" data-i18n-aria="serviceToggleTitle">
              <span class="service-toggle-track" aria-hidden="true">
                <span class="service-toggle-knob"></span>
              </span>
            </button>
          </div>
          <button class="btn-sm" type="button" id="btnQuickRefresh" onclick="manualRefresh(this)" title="تحديث البيانات الآن" data-i18n-title="btnQuickRefreshTitle" data-i18n="btnQuickRefresh">تحديث</button>
        </div>
      </div>

      <!-- Quick Connection & Configuration Strip -->
      <div class="section-panel" style="padding:12px 16px;margin-bottom:16px;background:var(--card-subtle)">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:12px">
            <div>
              <span style="color:var(--text-muted)" data-i18n="baseUrlLabel">Base URL:</span>
              <code style="font-family:var(--font-mono);font-weight:600;color:var(--text);margin:0 4px" id="quickBaseUrl">http://127.0.0.1:8989/v1</code>
              <button class="btn-copy btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('quickBaseUrl').textContent);showToast(t('toastCopiedBaseUrl'))" data-i18n="btnCopy">نسخ</button>
            </div>
            <div>
              <span style="color:var(--text-muted)" data-i18n="apiKeyLabel">API Key:</span>
              <code style="font-family:var(--font-mono);font-weight:600;color:var(--primary);margin:0 4px" id="quickApiKey">emo.web</code>
              <button class="btn-copy btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('quickApiKey').textContent);showToast(t('toastCopiedApiKey'))" data-i18n="btnCopy">نسخ</button>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;font-size:11px">
            <span class="badge" style="font-size:10px">OpenAI /v1</span>
            <span class="badge" style="font-size:10px">Claude /v1/messages</span>
            <span class="badge" style="font-size:10px">Gemini /v1beta</span>
          </div>
        </div>
      </div>

      <!-- Live KPI Metrics -->
      <div class="metrics-row">
        <div class="metric-card">
          <div class="metric-label"><span data-i18n="metricUptime">مدة التشغيل</span> <span style="color:var(--success)" data-i18n="metricLive">مباشر</span></div>
          <div class="metric-value" id="uptimeCounter">00:00:00</div>
          <div class="metric-sub" id="uptimeStartedAt" data-i18n="metricSinceStart">منذ بدء التشغيل</div>
        </div>
        <div class="metric-card">
          <div class="metric-label" data-i18n="metricTotalTokens">إجمالي الرموز المقدرة</div>
          <div class="metric-value" id="totalTokens">0</div>
          <div class="metric-sub"><span data-i18n="metricPromptShort">المدخلات:</span> <span id="promptTokens">0</span> <span data-i18n="metricComplShort">| المخرجات:</span> <span id="complTokens">0</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label" data-i18n="metricSuccessRate">نسبة نجاح الطلبات</div>
          <div class="metric-value" style="color:var(--success)" id="successRate">100%</div>
          <div class="metric-sub"><span id="okRequests">0</span> <span data-i18n="metricCompletedOfPart">مكتمل من</span> <span id="totalRequests">0</span> <span data-i18n="metricRequestsPart">طلب</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-label" data-i18n="metricActiveProviders">المزوّدات النشطة</div>
          <div class="metric-value" id="activeProvidersCount">0</div>
          <div class="metric-sub"><span id="activeModelsCount">0</span> <span data-i18n="metricActiveModelsPart">نموذج مفعل</span></div>
        </div>
      </div>

      <!-- Topology Flow Graph -->
      <div class="topology-box" id="topologyFlowContainer">
        <div class="topology-header-bar">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:8px">
              <span data-i18n="topoLiveFlow">مخطط الربط الحي</span>
              <span class="badge badge-success" id="topoLivePulseBadge"><span class="status-dot dot-running"></span> <span data-i18n="topoLivePulse">متصل</span></span>
            </div>
            <div style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono)" data-i18n="topoAutoSync">تحديث تلقائي كل 3 ثوانٍ</div>
          </div>
          <div class="topology-controls">
            <span class="topo-chip"><strong id="topoInCount">—</strong> <span data-i18n="topoInboundChannels">قنوات واردة</span></span>
            <span class="topo-chip"><strong id="topoOutCount">—</strong> <span data-i18n="topoActiveProviders">مزودات نشطة</span></span>
            <span class="topo-chip" id="topoReqCountChip"><strong id="topoReqCount">—</strong> <span data-i18n="topoLiveRequests">طلبات متدفقة</span></span>
            <span class="topo-chip" id="topoPrivacyChip" style="display:none;color:#10b981;border-color:rgba(16,185,129,0.3)"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" style="flex:none"><path d="M12 22s8-3.2 8-10V5.2L12 2 4 5.2V12c0 6.8 8 10 8 10z"/></svg> <span data-i18n="topoPrivacyPath">مسار خصوصية مؤقت</span></span>
            <button class="btn-ping-pulse" id="btnFlowPingPulse" onclick="triggerFlowPingPulse()" title="فحص حالة مسارات الربط الحالية" data-i18n-title="topoPulseBtn">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="flex:none"><path d="M13 2 3.5 13.5H10L9 22l10.5-11.5H13L13 2z"/></svg> <span data-i18n="topoPulseBtn">نبضة تدفق</span>
            </button>
          </div>
        </div>

        <div class="topology-flow-wrapper" id="topologyFlowWrapper" role="group" aria-label="مخطط الربط الحي: يمكن التنقل بين العقد بمفتاح Tab لإبراز مسارات التدفق" data-i18n-aria="topoWrapperAria">
          <svg class="topology-svg-overlay" id="topologySvgOverlay"></svg>

          <div class="topology-flow">
            <!-- Col 1: Agents & IDEs -->
            <div class="topology-col" id="topColAgents" style="display:flex;flex-direction:column">
              <div class="topology-col-title">
                <span data-i18n="topoAgentsTitle">الوكلاء ومحررات الكود</span>
                <span class="badge" style="font-size:9.5px;padding:1px 6px">Inbound</span>
              </div>
              <div style="flex:1;display:flex;flex-direction:column">
                <div id="topologyAgentList" style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:18px">
                  <div class="topo-empty-state">
                    <div class="topo-empty-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted);opacity:0.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
                    <div class="topo-empty-title" data-i18n="topoWaitingRequests">في انتظار تدفق الطلبات</div>
                    <div class="topo-empty-desc" data-i18n="topoWaitingRequestsSub">تظهر أدوات التطوير والوكلاء هنا لحظياً بمجرد إرسال طلب جديد</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Col 2: Gateway Hub Core -->
            <div class="topology-col" id="topColHub" style="display:flex;flex-direction:column">
              <div class="topology-col-title" style="justify-content:center">
                <span data-i18n="topoHubTitle">البوابة المركزية متعددة البروتوكولات</span>
                <span class="badge badge-success" style="font-size:9.5px;padding:1px 6px">Router</span>
              </div>
              <div style="flex:1;display:flex;align-items:center;justify-content:center;width:100%">
                <div class="topology-node hub hub-compact" id="topNodeHub" tabindex="0" aria-label="EMO-AI Gateway Core — البوابة المركزية متعددة البروتوكولات" data-i18n-aria="hubAriaLabel" title="EMO-AI Gateway Core">
                  <span class="topo-port port-in port-right" title="منفذ الاستقبال الوارد" data-i18n-title="topoHubPortIn"></span>
                  <span class="topo-port port-out port-left" title="منفذ الإمداد للمزودات" data-i18n-title="topoHubPortOut"></span>
                  <div class="hub-beacon-wrap">
                    <span class="hub-beacon-pulse"></span>
                    <img src="/logo-dark.png" alt="EMO-AI" class="theme-logo-dark" style="width:74px;height:auto;max-height:18px;object-fit:contain"/>
                    <img src="/logo-light.png" alt="EMO-AI" class="theme-logo-light" style="width:74px;height:auto;max-height:18px;object-fit:contain"/>
                  </div>
                  <div class="hub-metrics-ticker">
                    <span id="hubUptimeSec" title="مدة تشغيل البوابة" data-i18n-title="topoHubUptime">0s</span>
                    <span class="hub-sep">·</span>
                    <span title="معدل الطلبات (لكل دقيقة)" data-i18n-title="topoHubReqRate"><b id="hubReqRate">0</b><span data-i18n="topoHubReqRateUnit">/د</span></span>
                    <span class="hub-sep">·</span>
                    <span id="hubMetricsLatency" title="زمن الاستجابة وسرعة الاتصال" data-i18n-title="topoHubLatency">~85ms</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Col 3: Upstream Providers & Models -->
            <div class="topology-col" id="topColProviders" style="display:flex;flex-direction:column">
              <div class="topology-col-title">
                <span data-i18n="topoProvidersTitle">المزوّدات ونقاط النهاية النشطة</span>
                <span class="badge" style="font-size:9.5px;padding:1px 6px">Upstream</span>
              </div>
              <div style="flex:1;display:flex;flex-direction:column">
                <div id="topologyActiveList" style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:18px">
                  <div class="topo-empty-state">
                    <div class="topo-empty-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted);opacity:0.8"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg></div>
                    <div class="topo-empty-title" data-i18n="topoWaitingProvs">في انتظار المزودات</div>
                    <div class="topo-empty-desc" data-i18n="topoWaitingProvsSub">يظهر المزود الذي يخدم الطلب لحظياً أثناء المعالجة وتدفق البيانات</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--text-dim)">
          <div style="display:flex;align-items:center;gap:6px">
            <span data-i18n="topoInteractionHint">تفاعل: مرّر الماوس فوق أي عقدة، أو تنقّل بـ Tab عبر لوحة المفاتيح، لإبراز مسارات التدفق.</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap" id="topoFlowLegend">
            <span class="topo-legend-item"><span class="legend-swatch swatch-flow"></span> <span data-i18n="topoLegendFlow">تدفق قياسي</span></span>
            <span class="topo-legend-item"><span class="legend-swatch swatch-privacy"></span> <span data-i18n="topoLegendPrivacy">مسار خصوصية</span></span>
            <span class="topo-legend-item"><span class="legend-swatch swatch-dormant"></span> <span data-i18n="topoLegendDormant">مسار خامل</span></span>
          </div>
        </div>
      </div>

      <!-- Quick Models Snapshot -->
      <div class="section-panel">
        <div class="section-title">
          <span data-i18n="quickModelsTitle">النماذج المفعلة القابلة للاستدعاء الآن في أدواتك</span>
          <span style="font-size:12px;color:var(--text-muted)" data-i18n="quickModelsSubtitle">انقر على أي نموذج لنسخ اسمه بدقة</span>
        </div>
        <div id="quickModelsBadges" style="display:flex;flex-wrap:wrap;gap:8px"></div>
      </div>

      <!-- Integrated Consumption & Live Request Telemetry Section -->
      <div class="section-panel" id="overview-consumption-section" style="margin-top:20px;padding:20px">
        <div class="section-title" style="margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div>
            <div style="display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700">
              <span data-i18n="consumptionTitle">سجل الطلبات والاستهلاك</span>
              <span class="badge badge-success" style="font-size:10px" data-i18n="metricLive">مباشر</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px" data-i18n="consumptionSubtitle">تفاصيل الطلبات الواردة، زمن الاستجابة، وحجم الاستهلاك</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button class="btn-sm" onclick="clearRecentRequests()" title="مسح سجل الطلبات المعروضة" data-i18n-title="clearLogHint" data-i18n="btnClearLog">مسح السجل</button>
          </div>
        </div>

        <!-- Consumption Metrics Cards -->
        <div class="metrics-row" style="margin-bottom:18px">
          <div class="metric-card">
            <div class="metric-label" data-i18n="metricPromptChars">أحرف الإدخال</div>
            <div class="metric-value" id="promptChars">0</div>
          </div>
          <div class="metric-card">
            <div class="metric-label" data-i18n="metricComplChars">أحرف الإخراج</div>
            <div class="metric-value" id="complChars">0</div>
          </div>
          <div class="metric-card">
            <div class="metric-label" data-i18n="metricStreamReq">طلبات البث</div>
            <div class="metric-value" id="streamRequests">0</div>
          </div>
          <div class="metric-card">
            <div class="metric-label" data-i18n="metricLifetimeReq">إجمالي الطلبات</div>
            <div class="metric-value" id="lifetimeReq">0</div>
          </div>
        </div>

        <!-- Live Requests Table -->
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th data-i18n="thTimestamp">الوقت</th>
                <th data-i18n="thAgent">الوكيل</th>
                <th data-i18n="thModel">النموذج</th>
                <th data-i18n="thType">النوع</th>
                <th data-i18n="thTokens">الرموز</th>
                <th data-i18n="thLatency">الاستجابة</th>
                <th data-i18n="thStatus">الحالة</th>
              </tr>
            </thead>
            <tbody id="recentRequestsTableBody">
              <tr>
                <td colspan="7" style="text-align:center;color:var(--text-dim);padding:24px" data-i18n="noRequestsRecorded">
                  لا توجد طلبات مسجلة بعد.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- View 3: Providers & Models -->
    <div id="view-providers" class="view-panel">
      <div class="page-header">
        <div>
          <h1 class="page-title" data-i18n="providersTitle">إدارة المزوّدات والنماذج</h1>
          <p class="page-subtitle" data-i18n="providersSubtitle">تشغيل وإيقاف المزوّدات، فحص الاتصال السريع، والتبديل بين الحسابات</p>
        </div>
      </div>

      <div class="providers-filter-bar" id="providersFilterBar"></div>

      <div class="providers-notify-bar">
        <button type="button" class="btn-sm" id="btnModelNotifications" onclick="toggleModelNotifications()" style="display:inline-flex;align-items:center;gap:6px">
          <span aria-hidden="true">🔔</span>
          <span data-i18n="notifCenterTitle">تغييرات النماذج</span>
          <span class="badge badge-danger" id="modelNotifUnreadBadge" style="display:none">0</span>
        </button>
        <button type="button" class="btn-sm" id="btnNotifMarkAll" onclick="markAllModelNotificationsRead()" data-i18n="notifMarkAll">تعليم الكل كمقروء</button>
        <span style="font-size:11px;color:var(--text-muted)" data-i18n="notifCenterSub">تُبلّغ هنا كل التغييرات التي يكتشفها الفحص الحيّ</span>
      </div>
      <div id="modelNotificationsPanel" class="model-notif-panel" style="display:none"></div>

      <div class="providers-grid" id="providersGrid"></div>
    </div>

    <!-- View 4: Accounts Management -->
    <div id="view-accounts" class="view-panel">
      <div class="page-header">
        <div>
          <h1 class="page-title" data-i18n="accountsTitle">إدارة الحسابات المتعددة</h1>
          <p class="page-subtitle" data-i18n="accountsSubtitle">إدارة الحسابات لكل مزود، التبديل بينها، وإضافة حسابات جديدة</p>
        </div>
        <div>
          <button class="btn-primary" onclick="openAddAccountModal()" data-i18n="btnAddAccount">+ إضافة حساب جديد</button>
        </div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap">
        <div class="accounts-filter" id="accountsFilterBar" style="display:flex;gap:8px;flex-wrap:wrap"></div>
        <div style="position:relative;display:flex;align-items:center;gap:8px">
          <span id="accountsSelectedCount" style="font-size:12px;color:var(--text-muted)"></span>
          <button type="button" class="btn-sm" id="btnAccountsBulkMenu" onclick="toggleAccountsBulkMenu(event)" title="إجراءات جماعية" style="padding:6px 10px;display:inline-flex;align-items:center;gap:6px">⚙ <span>إجراءات</span></button>
          <div id="accountsBulkMenu" style="display:none;position:absolute;top:calc(100% + 6px);inset-inline-end:0;min-width:220px;background:var(--card-bg);border:1px solid var(--border);border-radius:8px;box-shadow:var(--modal-shadow);padding:6px;z-index:50">
            <button type="button" class="settings-action-btn" onclick="bulkAccountsAction('disable','all')" style="margin-bottom:4px">تعطيل الكل</button>
            <button type="button" class="settings-action-btn" onclick="bulkAccountsAction('disable','selected')" style="margin-bottom:4px">تعطيل المحدد</button>
            <button type="button" class="settings-action-btn" onclick="bulkAccountsAction('enable','all')" style="margin-bottom:4px">تفعيل الكل</button>
            <button type="button" class="settings-action-btn" onclick="bulkAccountsAction('enable','selected')" style="margin-bottom:4px">تفعيل المحدد</button>
            <button type="button" class="settings-action-btn" onclick="bulkAccountsAction('delete','all')" style="margin-bottom:4px;color:var(--danger)">حذف الكل</button>
            <button type="button" class="settings-action-btn" onclick="bulkAccountsAction('delete','selected')" style="color:var(--danger)">حذف المحدد</button>
          </div>
        </div>
      </div>

      <div class="section-panel" style="padding:0;overflow:hidden">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:36px"><input type="checkbox" id="accountsSelectAll" onchange="toggleSelectAllAccounts(this.checked)" title="تحديد الكل"></th>
              <th data-i18n="thProvider">المزود</th>
              <th data-i18n="thAccountName">اسم الحساب</th>
              <th data-i18n="thEmail">البريد الإلكتروني</th>
              <th data-i18n="thLoginStatus">حالة الدخول</th>
              <th data-i18n="thActiveStatus">الحساب النشط</th>
              <th data-i18n="thActions">الإجراءات</th>
            </tr>
          </thead>
          <tbody id="accountsTableBody"></tbody>
        </table>
      </div>
    </div>

    <!-- View 5: API Keys & Custom Providers -->
    <div id="view-keys" class="view-panel">
      <div class="page-header">
        <div>
          <h1 class="page-title" data-i18n="keysTitle">مفاتيح API والمزوّدات المخصصة</h1>
          <p class="page-subtitle" data-i18n="keysSubtitle">إدارة مفاتيح الوصول للبوابة وربط مزوّدات API خارجية</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary" onclick="openAddKeyModal()" data-i18n="btnAddCustomKey">+ مفتاح جديد</button>
          <button class="btn-primary" onclick="openAddCustomProviderModal()" data-i18n="btnAddCustomProvider">+ إضافة مزود</button>
        </div>
      </div>

      <!-- Section: Generated API Keys -->
      <div class="section-panel">
        <div class="section-title">
          <span data-i18n="customKeysSectionTitle">مفاتيح الوصول المعتمدة</span>
          <span style="font-size:12px;color:var(--text-muted)" data-i18n="customKeysSectionDesc">تُقبل في ترويسات Authorization: Bearer و x-api-key و x-goog-api-key</span>
        </div>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead>
              <tr>
                <th data-i18n="thKeyName">اسم المفتاح</th>
                <th data-i18n="thKeySecret">المفتاح السري</th>
                <th data-i18n="thCreated">تاريخ الإنشاء</th>
                <th data-i18n="thKeyStatus">الحالة</th>
                <th data-i18n="thActions">الإجراءات</th>
              </tr>
            </thead>
            <tbody id="apiKeysTableBody"></tbody>
          </table>
        </div>
      </div>

      <!-- Section: Custom Upstream Providers -->
      <div class="section-panel">
        <div class="section-title">
          <span data-i18n="customProvidersSectionTitle">المزوّدات المخصصة</span>
          <span style="font-size:12px;color:var(--text-muted)" data-i18n="customProvidersSectionDesc">ربط خدمات OpenAI-compatible مثل Ollama و DeepSeek و OpenRouter و Groq</span>
        </div>
        <div id="customProvidersList" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px"></div>
      </div>
    </div>

    <!-- View 6: Swarm Coordinator -->
    <div id="view-swarm" class="view-panel">
      <div class="page-header">
        <div>
          <h1 class="page-title" data-i18n="navSwarm">موجه الوكلاء (Swarm)</h1>
          <p class="page-subtitle" data-i18n="swarmSubtitle">تنفيذ المهام عبر أدوار وكلاء محددة وتوليف النتائج، مع إدارة مجموعات توجيه النماذج.</p>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-primary btn-sm" onclick="runLiveSwarm()" data-i18n="btnRunTask">تشغيل مهمة</button>
        </div>
      </div>

      <div class="section-panel" style="margin-bottom:16px">
        <div class="section-title">
          <span data-i18n="swarmRolesTitle">أدوار التنفيذ</span>
          <span style="font-size:12px;color:var(--text-muted)" data-i18n="swarmRolesSubtitle">توزيع العمل حسب الاختصاص</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--card-subtle)">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
              <strong style="font-size:13px" data-i18n="swarmRoleArchitect">المهندس المعماري</strong>
              <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono)">Architect</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:8px" data-i18n="swarmRoleArchitectDesc">تفكيك الهدف وتحديد البنية والخطوات.</div>
            <label style="font-size:10.5px;color:var(--text-muted);display:block;margin-bottom:4px" data-i18n="swarmModelLabel">مجموعة الراوتر لهذا الدور</label>
            <select id="swarmModelArchitect" class="form-input" style="font-size:11px;padding:4px 6px;width:100%;direction:ltr"><option value="auto" data-i18n="swarmModelAuto">تلقائي ذكي (auto)</option></select>
          </div>
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--card-subtle)">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
              <strong style="font-size:13px" data-i18n="swarmRoleCoder">مهندس التنفيذ</strong>
              <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono)">Coder</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:8px" data-i18n="swarmRoleCoderDesc">تنفيذ التغييرات والكتابة البرمجية.</div>
            <label style="font-size:10.5px;color:var(--text-muted);display:block;margin-bottom:4px" data-i18n="swarmModelLabel">مجموعة الراوتر لهذا الدور</label>
            <select id="swarmModelCoder" class="form-input" style="font-size:11px;padding:4px 6px;width:100%;direction:ltr"><option value="auto" data-i18n="swarmModelAuto">تلقائي ذكي (auto)</option></select>
          </div>
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--card-subtle)">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
              <strong style="font-size:13px" data-i18n="swarmRoleReviewer">المراجع</strong>
              <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono)">Reviewer</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:8px" data-i18n="swarmRoleReviewerDesc">مراجعة الجودة والمخاطر والملاحظات.</div>
            <label style="font-size:10.5px;color:var(--text-muted);display:block;margin-bottom:4px" data-i18n="swarmModelLabel">مجموعة الراوتر لهذا الدور</label>
            <select id="swarmModelReviewer" class="form-input" style="font-size:11px;padding:4px 6px;width:100%;direction:ltr"><option value="auto" data-i18n="swarmModelAuto">تلقائي ذكي (auto)</option></select>
          </div>
          <div style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--card-subtle)">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
              <strong style="font-size:13px" data-i18n="swarmRoleTester">مهندس الاختبارات</strong>
              <span style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono)">Tester</span>
            </div>
            <div style="font-size:12px;color:var(--text-muted);line-height:1.5;margin-bottom:8px" data-i18n="swarmRoleTesterDesc">اقتراح حالات الاختبار والتحقق.</div>
            <label style="font-size:10.5px;color:var(--text-muted);display:block;margin-bottom:4px" data-i18n="swarmModelLabel">مجموعة الراوتر لهذا الدور</label>
            <select id="swarmModelTester" class="form-input" style="font-size:11px;padding:4px 6px;width:100%;direction:ltr"><option value="auto" data-i18n="swarmModelAuto">تلقائي ذكي (auto)</option></select>
          </div>
        </div>
      </div>

      <!-- Model Router Groups -->
      <div class="section-panel" style="margin-bottom:16px">
        <div class="section-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <div>
            <span style="font-weight:700" data-i18n="routerTitle">مجموعات الراوتر</span>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px" data-i18n="routerSubtitle">اجمع نماذج من مزودين وحسابات مختلفة تحت اسم واحد مع failover أو توزيع بالتناوب</div>
          </div>
          <button class="btn-primary btn-sm" onclick="openRouterGroupModal()" data-i18n="btnAddRouterGroup">+ مجموعة جديدة</button>
        </div>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px" data-i18n="routerHint">اسم المجموعة يصبح اسم النموذج (model) للعميل. sequential = تجربة بالترتيب عند الفشل، round-robin = توزيع بالتناوب.</div>
        <div id="routerGroupsList" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px"></div>
      </div>

      <!-- Execution -->
      <div class="section-panel" style="margin-bottom:16px">
        <div class="section-title">
          <span data-i18n="swarmExecTitle">تنفيذ مهمة</span>
          <span style="font-size:12px;color:var(--text-muted)" data-i18n="swarmExecSubtitle">إرسال هدف إلى منسق الوكلاء</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          <div>
            <label for="swarmGoalInput" style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px" data-i18n="swarmGoalLabel">تعليمات النظام</label>
            <textarea id="swarmGoalInput" rows="4" class="form-input" style="width:100%;resize:vertical" placeholder="اكتب تعليمات النظام التي سيعمل وفقها جميع الوكلاء (السياق، القيود، أسلوب التنفيذ...)" data-i18n-ph="swarmGoalPlaceholder"></textarea>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px">
            <div style="min-width:220px">
              <label for="swarmModeSelect" style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px" data-i18n="swarmModeLabel">نمط التشغيل</label>
              <select id="swarmModeSelect" class="form-input" style="width:100%;max-width:320px">
                <option value="auto" data-i18n="swarmModeAuto">تلقائي (تسلسلي + متوازي)</option>
                <option value="pipeline" data-i18n="swarmModePipeline">تسلسلي</option>
                <option value="parallel" data-i18n="swarmModeParallel">متوازي</option>
              </select>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button id="btnRunSwarmExec" class="btn-primary btn-sm" onclick="runLiveSwarm()" data-i18n="btnExecute">تشغيل</button>
              <button id="btnStopSwarmExec" class="btn-stop btn-sm" onclick="stopLiveSwarm()" disabled data-i18n="btnStopSwarm">إيقاف</button>
            </div>
          </div>
          <div id="swarmOutputBox" style="display:none;margin-top:4px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:14px;max-height:450px;overflow:auto;font-family:var(--font-mono);font-size:12px;white-space:pre-wrap;line-height:1.6;direction:ltr;text-align:left"></div>
        </div>
      </div>
    </div>

    <!-- View: Settings -->
    <div id="view-settings" class="view-panel">
      <div class="page-header">
        <div>
          <h1 class="page-title" data-i18n="settingsTitle">الإعدادات</h1>
          <p class="page-subtitle" data-i18n="settingsPageSubtitle">إدارة اللغة والمظهر ومعلومات التطبيق والربط مع الوكلاء</p>
        </div>
      </div>

      <div class="section-panel" style="margin-bottom:16px">
        <div class="section-title"><span data-i18n="langAndAppearance">اللغة والمظهر</span></div>
        <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:8px">
            <label style="font-size:12px;color:var(--text-muted);white-space:nowrap" data-i18n="langLabel">اللغة</label>
            <select id="langSelect" onchange="changeLanguage(this.value)" class="form-input" style="width:190px;max-width:100%;padding:6px 10px;font-size:12.5px;height:34px">
              <option value="ar" data-i18n="langOptAr">العربية (AR)</option>
              <option value="en" data-i18n="langOptEn">English (EN)</option>
              <option value="fr" data-i18n="langOptFr">Français (FR)</option>
              <option value="ru" data-i18n="langOptRu">Русский (RU)</option>
              <option value="es" data-i18n="langOptEs">Español (ES)</option>
              <option value="zh" data-i18n="langOptZh">中文 (ZH)</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;color:var(--text-muted);white-space:nowrap" data-i18n="appearanceLabel">المظهر</span>
            <div class="theme-switch-row" onclick="toggleTheme()" title="تبديل المظهر (داكن / فاتح)" data-i18n-title="themeToggleTitle" style="width:auto;min-width:0;padding:6px 10px;gap:10px;margin:0">
              <div style="display:flex;align-items:center;gap:8px">
                <span id="themeStatusIcon" style="font-size:14px">🌙</span>
                <span id="themeStatusLabel" style="font-size:12.5px;font-weight:500;color:var(--text)">الوضع الداكن</span>
              </div>
              <div class="theme-pill-toggle">
                <div class="theme-pill-slider"></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="section-panel" style="margin-bottom:16px">
        <div class="section-title"><span data-i18n="aboutAppLabel">عن التطبيق</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;align-items:end">
          <div class="metric-card" style="margin:0">
            <div class="metric-label" data-i18n="currentVersionLabel">الإصدار الحالي</div>
            <div class="metric-value" style="font-size:18px" id="appVersionText">v0.1.0</div>
          </div>
          <div class="metric-card" style="margin:0">
            <div class="metric-label" data-i18n="latestVersionLabel">آخر إصدار</div>
            <div class="metric-value" style="font-size:18px" id="latestVersionText">v0.1.0</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <button type="button" class="btn-primary btn-sm" id="btnCheckAppUpdate" onclick="checkAppUpdate(this)" data-i18n="checkUpdateBtn">تحقق من التحديثات</button>
            <span id="appUpdateStatus" style="font-size:12px;color:var(--text-muted);min-height:18px"></span>
          </div>
        </div>
      </div>

      <div class="section-panel">
      <div class="section-panel" id="agentConnectionSectionPanel">
        <div class="section-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
          <span data-i18n="agentConnectionSection">الربط مع الوكلاء</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="nav-badge" id="badgeDetectedAgents">0</span>
            <button type="button" class="btn-primary btn-sm" id="btnToggleAgentConnectSettings" onclick="toggleAgentConnectSettings()" data-i18n="openAgentConnectionBtn">اعدادات الاتصال بالوكلاء</button>
          </div>
        </div>
        <div id="agentConnectSettingsSummary" style="font-size:12px;color:var(--text-muted);margin-bottom:0" data-i18n="agentConnectionSettingsDesc">إدارة الاتصال بالوكلاء والربط التلقائي واليدوي وإعداد MCP.</div>
        <div id="agentConnectSettingsContent" style="display:none;margin-top:16px">
      <div class="page-header">
        <div>
          <h1 class="page-title" data-i18n="connectTitle">الاتصال بالوكلاء</h1>
          <p class="page-subtitle" data-i18n="connectSubtitle">إعداد وتهيئة الاتصال بالوكلاء عبر الربط التلقائي، اليدوي، و MCP مع اختيار الوكيل</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-sm" id="btnRescanAgents" onclick="rescanLocalAgents()" data-i18n="btnRescanAgents">إعادة الفحص</button>
          <button class="btn-primary btn-sm" onclick="openAddCustomAgentModal()" data-i18n="btnAddCustomAgent">+ إضافة وكيل</button>
        </div>
      </div>

      <div class="section-panel" style="padding:16px 20px;margin-bottom:16px">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px">
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px" data-i18n="labelOpenAiBaseUrl">OpenAI Base URL (/v1)</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="inpBaseUrl" class="form-input" style="font-family:var(--font-mono);direction:ltr" readonly value="http://127.0.0.1:8989/v1"/>
              <button class="btn-copy" onclick="copyInput('inpBaseUrl', this)" data-i18n="btnCopy">نسخ</button>
            </div>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px" data-i18n="labelAnthropicBaseUrl">Anthropic Base URL (Claude Code)</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="inpAnthropicUrl" class="form-input" style="font-family:var(--font-mono);direction:ltr" readonly value="http://127.0.0.1:8989"/>
              <button class="btn-copy" onclick="copyInput('inpAnthropicUrl', this)" data-i18n="btnCopy">نسخ</button>
            </div>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px" data-i18n="labelGeminiBaseUrl">Gemini Base URL (Gemini CLI)</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="inpGeminiUrl" class="form-input" style="font-family:var(--font-mono);direction:ltr" readonly value="http://127.0.0.1:8989"/>
              <button class="btn-copy" onclick="copyInput('inpGeminiUrl', this)" data-i18n="btnCopy">نسخ</button>
            </div>
          </div>
          <div>
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px" data-i18n="labelDefaultApiKey">Default API Key</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="inpApiKey" class="form-input" style="font-family:var(--font-mono);direction:ltr" readonly value="emo.web"/>
              <button class="btn-copy" onclick="copyInput('inpApiKey', this)" data-i18n="btnCopy">نسخ</button>
            </div>
          </div>
        </div>
      </div>

      <div class="agent-connect-layout">
        <div class="agent-detail-pane" id="agentDetailPane">
          <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between">
            <div style="flex:0 1 360px;min-width:240px;max-width:420px;width:100%">
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px" data-i18n="localAgentsListTitle">الوكلاء والمحررات المحلية</label>
              <select id="selAgentClient" class="form-input" style="direction:ltr;width:100%" onchange="selectAgentFromDropdown(this.value)"></select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span id="dtClientProtocol" class="badge" style="font-size:10px;text-transform:uppercase"></span>
              <span id="dtClientStatusBadge" class="badge badge-success" data-i18n="installedOnDevice">✓ مثبت على جهازك</span>
              <button id="btnDeleteCustomAgent" class="btn-stop btn-sm" style="display:none" onclick="deleteCurrentCustomAgent()" data-i18n="btnDeleteCustomAgent">حذف الوكيل</button>
            </div>
          </div>

          <div class="connect-mode-card" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:12px;min-width:220px">
              <span id="dtClientIcon" class="table-icon-badge"></span>
              <div>
                <h2 id="dtClientName" style="margin:0 0 4px;font-size:16px">OpenCode</h2>
                <div id="dtClientPath" style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);direction:ltr"></div>
              </div>
            </div>
            <div style="flex:1;min-width:240px;max-width:420px">
              <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px" data-i18n="selectSnippetModelLabel">النموذج المستهدف في الإعداد:</label>
              <select id="selSnippetModel" class="form-input" style="direction:ltr" onchange="onConnectModelChange()"></select>
            </div>
          </div>

          <div class="connect-tabs" role="tablist" aria-label="Connection modes">
            <button type="button" class="connect-tab active" data-connect-tab="auto" onclick="setConnectMode('auto', this)" data-i18n="connectTabAuto">ربط تلقائي</button>
            <button type="button" class="connect-tab" data-connect-tab="manual" onclick="setConnectMode('manual', this)" data-i18n="connectTabManual">ربط يدوي</button>
            <button type="button" class="connect-tab" data-connect-tab="mcp" onclick="setConnectMode('mcp', this)" data-i18n="connectTabMcp">ربط MCP</button>
          </div>

          <div id="connectModeAuto" class="connect-mode-panel active">
            <div class="connect-mode-card">
              <div class="connect-mode-title" data-i18n="autoConfigSectionTitle">الربط التلقائي للوكيل</div>
              <p class="connect-mode-desc" data-i18n="autoConnectDesc">تحديث ملف إعدادات الأداة تلقائياً مع حفظ نسخة احتياطية (.bak)</p>
            </div>
            <div id="autoConnectBar" style="display:flex;align-items:center;gap:12px;padding:14px 16px;border:1px solid var(--border);border-radius:10px;background:var(--card-subtle)">
              <div style="flex:1">
                <div style="font-size:12.5px;font-weight:600" data-i18n="autoConnectTitle">التكوين التلقائي</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px" data-i18n="autoConnectDesc">تحديث ملف إعدادات الأداة تلقائياً مع حفظ نسخة احتياطية (.bak)</div>
              </div>
              <button class="btn-primary btn-sm" id="btnAutoConnectAgent" onclick="autoConnectCurrentAgent()" data-i18n="btnAutoConnect">تطبيق الإعدادات</button>
            </div>
          </div>

          <div id="connectModeManual" class="connect-mode-panel">
            <div class="connect-mode-card">
              <div class="connect-mode-title" data-i18n="manualConfigTitle">الإعداد اليدوي (مقتطف التهيئة)</div>
              <p class="connect-mode-desc" data-i18n="mcpHintAgent">اختر الوكيل والنموذج من الأعلى ليتم تضمينهما في الإعداد.</p>
            </div>
            <div class="code-container" style="position:relative">
              <button class="btn-copy" style="position:absolute;top:10px;inset-inline-end:10px" onclick="copyCode(this)" data-i18n="copyCodeBtn">نسخ الكود</button>
              <pre id="dtSnippetCode" style="margin:0"></pre>
            </div>
          </div>

          <div id="connectModeMcp" class="connect-mode-panel">
            <div class="connect-mode-card" style="display:flex;flex-direction:column;gap:12px">
              <div>
                <div class="connect-mode-title" data-i18n="mcpSetupTitle">إعداد وتهيئة MCP</div>
                <p class="connect-mode-desc" data-i18n="mcpSetupDesc">أنشئ إعداد MCP للوكيل المحدد واختر هدف التكامل ثم انسخ ملف/مقتطف الإعداد.</p>
              </div>
              <div class="connect-grid-2">
                <div>
                  <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px">الوكيل (MCP)</label>
                  <select id="selMcpAgent" class="form-input" style="direction:ltr" onchange="onMcpAgentChange(this.value)"></select>
                </div>
                <div>
                  <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px" data-i18n="mcpTargetLabel">هدف MCP</label>
                  <select id="selMcpTarget" class="form-input" style="direction:ltr" onchange="updateMcpConfigDisplay()">
                    <option value="auto">Auto (حسب الوكيل)</option>
                    <option value="generic">Generic MCP (mcp-remote / HTTP)</option>
                    <option value="claude">Claude Desktop</option>
                    <option value="cursor">Cursor</option>
                    <option value="windsurf">Windsurf</option>
                    <option value="vscode">VS Code / Copilot Chat</option>
                    <option value="zed">Zed</option>
                    <option value="opencode">OpenCode</option>
                  </select>
                </div>
              </div>
              <div>
                <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:6px" data-i18n="mcpServerNameLabel">اسم خادم MCP</label>
                <input type="text" id="inpMcpServerName" class="form-input" style="direction:ltr;font-family:var(--font-mono);max-width:320px;background:var(--bg-elevated);color:var(--text-muted)" value="emo.web" readonly />
              </div>
              <div style="font-size:11.5px;color:var(--text-muted)" data-i18n="mcpHintAgent">اختر الوكيل والنموذج من الأعلى ليتم تضمينهما في الإعداد.</div>
            </div>
            <div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
                <label style="font-size:12px;color:var(--text-muted)" data-i18n="mcpConfigTitle">إعداد MCP الناتج</label>
              </div>
              <div class="code-container" style="position:relative">
                <button class="btn-copy" style="position:absolute;top:10px;inset-inline-end:10px" onclick="copyMcpConfig(this)" data-i18n="mcpCopyConfig">نسخ إعداد MCP</button>
                <pre id="dtMcpConfigCode" style="margin:0"></pre>
              </div>
            </div>
          </div>
        </div>
      </div>
        </div>
      </div>

  </main>
</div>

<!-- Modal: Add API Key -->
<div id="addKeyModal" class="modal-overlay">
  <div class="modal-card">
    <div class="section-title">
      <span data-i18n="modalAddKeyTitle">إنشاء مفتاح API جديد للبوابة</span>
      <button class="btn-sm" onclick="closeAddKeyModal()">✕</button>
    </div>
    <div class="form-group">
      <label data-i18n="labelKeyName">اسم المفتاح / التسمية التوضيحية</label>
      <input type="text" id="inpKeyName" class="form-input" placeholder="مثال: Cursor-Work أو ClaudeCode-Key" data-i18n-ph="phKeyName" required/>
    </div>
    <div class="form-group">
      <label data-i18n="labelKeySecret">المفتاح السري (اتركه فارغاً للتوليد التلقائي)</label>
      <div style="display:flex;gap:6px">
        <input type="text" id="inpCustomKeyVal" class="form-input" style="font-family:var(--font-mono);direction:ltr" placeholder="sk-emo-..."/>
        <button class="btn-sm" onclick="generateRandomKeyVal()" data-i18n="btnGenerateRandom">توليد عشوائي</button>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button onclick="closeAddKeyModal()" data-i18n="btnCancel">إلغاء</button>
      <button class="btn-primary" onclick="submitAddKey()" data-i18n="btnSaveKey">حفظ وتفعيل المفتاح</button>
    </div>
  </div>
</div>

<!-- Modal: Router Group -->
<div id="routerGroupModal" class="modal-overlay">
  <div class="modal-card" style="width:760px;max-width:95vw">
    <div class="section-title">
      <span id="rgModalTitle" data-i18n="rgModalCreateTitle">إنشاء مجموعة راوتر</span>
      <button class="btn-sm" onclick="closeRouterGroupModal()">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 100px 160px;gap:10px;margin-bottom:12px">
      <div>
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:5px" data-i18n="rgNameLabel">اسم المجموعة (اسم النموذج)</label>
        <input id="rgName" class="form-input" placeholder="مثال: A" data-i18n-ph="phRgName" />
      </div>
      <div>
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:5px" data-i18n="rgIconLabel">أيقونة</label>
        <input id="rgIcon" class="form-input" placeholder="🔀" maxlength="4" />
      </div>
      <div>
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:5px" data-i18n="rgStrategyLabel">الاستراتيجية</label>
        <select id="rgStrategy" class="form-input">
          <option value="sequential" data-i18n="rgStrategySeq">بالترتيب (failover)</option>
          <option value="round-robin" data-i18n="rgStrategyRR">بالتناوب (round-robin)</option>
        </select>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <label style="font-size:12px;color:var(--text-muted)" data-i18n="rgTargetsLabel">الأهداف (بالترتيب = الأولوية)</label>
      <button class="btn-sm" onclick="addRouterTargetRow()" data-i18n="rgAddTarget">+ إضافة هدف</button>
    </div>
    <div id="rgTargetsList" style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow:auto;margin-bottom:8px"></div>
    <div style="font-size:11px;color:var(--text-dim);margin-bottom:14px" data-i18n="rgTargetsHint">تثبيت حساب يغيّر البروفايل النشط للمزوّد عند الحاجة. تجنّب حسابين مختلفين لنفس المزوّد في round-robin.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px">
      <button onclick="closeRouterGroupModal()" data-i18n="btnCancel">إلغاء</button>
      <button class="btn-primary" id="btnSaveRouterGroup" onclick="saveRouterGroup()" data-i18n="btnSave">حفظ</button>
    </div>
  </div>
</div>

<!-- Modal: Add / Edit Custom Upstream Provider Settings -->
<div id="addCustomProviderModal" class="modal-overlay">
  <div class="modal-card" style="width:540px">
    <div class="section-title">
      <span id="cpModalTitle" data-i18n="modalAddCpTitle">إضافة مزود API مخصص</span>
      <button class="btn-sm" onclick="closeAddCustomProviderModal()">✕</button>
    </div>
    <div class="form-group">
      <label data-i18n="labelCpName">اسم المزود</label>
      <input type="text" id="inpCpName" class="form-input" placeholder="DeepSeek / Ollama / OpenRouter" data-i18n-ph="phCpName" required/>
    </div>
    <div class="form-group">
      <label data-i18n="labelCpUrl">رابط نقطة النهاية (Base URL)</label>
      <input type="text" id="inpCpUrl" class="form-input" style="font-family:var(--font-mono);direction:ltr" placeholder="https://api.deepseek.com/v1 أو http://localhost:11434/v1" data-i18n-ph="phCpUrl" required/>
    </div>
    <div class="form-group">
      <label data-i18n="labelCpKey">مفتاح API</label>
      <div style="display:flex;gap:6px">
        <input type="password" id="inpCpApiKey" class="form-input" style="font-family:var(--font-mono);direction:ltr" placeholder="sk-..."/>
        <button type="button" class="btn-sm" id="btnToggleCpKeyVis" onclick="toggleCpApiKeyVisibility()" title="إظهار / إخفاء المفتاح" data-i18n-title="toggleKeyVisibility" style="display:inline-flex;align-items:center;justify-content:center;padding:4px 8px"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <button type="button" class="btn-sm" id="btnVerifyCpConn" onclick="verifyCpConnectionFromModal()" style="white-space:nowrap" data-i18n="cpVerifyBtn">التحقق من الاتصال</button>
        <button type="button" class="btn-sm btn-primary" id="btnFetchCpModels" onclick="fetchCpModelsFromEndpoint()" style="white-space:nowrap" data-i18n="btnFetchModelsAuto">جلب النماذج</button>
      </div>
      <div id="cpVerifyBanner" style="display:none;margin-top:8px;padding:8px 10px;border-radius:6px;font-size:11.5px;border:1px solid var(--border);background:var(--bg-elevated);line-height:1.5"></div>
    </div>

    <div class="form-group">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:6px;flex-wrap:wrap">
        <label style="margin:0" data-i18n="labelCpModelsManagement">النماذج</label>
        <span id="cpFetchStatus" style="font-size:11px;color:var(--text-muted)" data-i18n="cpFetchHint">اجلب النماذج من الخادم أو أضفها يدوياً</span>
      </div>

      <div id="cpFetchedModelsWrap" style="display:none;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span id="cpFetchedModelsLabel" style="font-size:11px;color:var(--text-muted)" data-i18n="labelCpModelsListSelect">النماذج المتوفرة:</span>
          <div style="display:flex;gap:4px">
            <button type="button" class="btn-sm" style="padding:2px 7px;font-size:10.5px" onclick="toggleAllCpFetchedModels(true)" data-i18n="btnSelectAll">تحديد الكل</button>
            <button type="button" class="btn-sm" style="padding:2px 7px;font-size:10.5px" onclick="toggleAllCpFetchedModels(false)" data-i18n="btnDeselectAll">إلغاء الكل</button>
          </div>
        </div>
        <div class="models-container" id="cpFetchedModelsList" style="max-height:150px"></div>
      </div>

      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input type="text" id="inpCpManualSingle" class="form-input" style="font-family:var(--font-mono);direction:ltr;font-size:12px" placeholder="اسم النموذج (مثال: deepseek-reasoner)" data-i18n-ph="phCpManualSingle" onkeydown="if(event.key==='Enter'){event.preventDefault();addManualCpModelToModal();}"/>
        <button type="button" class="btn-sm" onclick="addManualCpModelToModal()" style="white-space:nowrap" data-i18n="btnAddManualModel">+ إضافة</button>
      </div>

      <input type="text" id="inpCpModels" class="form-input" style="font-family:var(--font-mono);direction:ltr" placeholder="deepseek-chat, deepseek-reasoner" data-i18n-ph="phCpModels"/>
    </div>

    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button onclick="closeAddCustomProviderModal()" data-i18n="btnCancel">إلغاء</button>
      <button class="btn-primary" id="btnSubmitCpModal" onclick="submitAddCustomProvider()" data-i18n="btnSaveCustomProv">حفظ</button>
    </div>
  </div>
</div>

<!-- Modal: Add Account -->
<div id="addAccountModal" class="modal-overlay">
  <div class="modal-card">
    <div class="section-title">
      <span data-i18n="modalAddAccTitle">إضافة حساب جديد للمزود</span>
      <button class="btn-sm" onclick="closeAddAccountModal()">✕</button>
    </div>
    <div class="form-group">
      <label data-i18n="labelSelectProvider">المزود المستهدف</label>
      <select id="selModalProvider" class="form-input">
        <option value="arena-browser">Arena Web</option>
        <option value="claude-web">Claude Web</option>
        <option value="gemini-web">Gemini Web</option>
        <option value="qwen-web">Qwen Web</option>
        <option value="chatgpt-web">ChatGPT Web</option>
        <option value="grok-web">Grok Web</option>
        <option value="kimi-web">Kimi Web</option>
        <option value="minimax-web">MiniMax Web</option>
        <option value="longcat-web">LongCat Web</option>
        <option value="llm7-web">LLM7 Web</option>
        <option value="kiwi-web">LLM Kiwi Web</option>
        <option value="zai-web">ZAI Web</option>
        <option value="tencent-ai-web">Tencent AI Studio</option>
        <option value="deepseek-web">DeepSeek Web</option>
        <option value="mistral-web">Mistral Web</option>
      </select>
    </div>
    <div class="form-group">
      <label data-i18n="labelAccountName">اسم الحساب / التسمية (اختياري)</label>
      <input type="text" id="inpModalAccName" class="form-input" placeholder="مثال: حساب العمل أو الحساب الشخصي" data-i18n-ph="phAccountName"/>
    </div>
    <div class="form-group">
      <label data-i18n="labelAccountEmail">البريد الإلكتروني</label>
      <input type="email" id="inpModalAccEmail" class="form-input" placeholder="user@gmail.com" required/>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button onclick="closeAddAccountModal()" data-i18n="btnCancel">إلغاء</button>
      <button class="btn-primary" onclick="submitAddAccount()" data-i18n="btnSaveAccount">حفظ الحساب</button>
    </div>
  </div>
</div>

<!-- Modal: Account Details Drawer -->
<div id="accountDetailModal" class="modal-overlay">
  <div class="modal-card">
    <div class="section-title">
      <span id="dtAccTitle" data-i18n="modalAccountDetailTitle">تفاصيل الحساب</span>
      <button class="btn-sm" onclick="closeAccountDetailModal()">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;margin:16px 0">
      <div><span style="color:var(--text-muted)" data-i18n="labelProvider">المزود:</span> <strong id="dtAccProvider"></strong></div>
      <div><span style="color:var(--text-muted)" data-i18n="labelName">الاسم:</span> <span id="dtAccName"></span></div>
      <div><span style="color:var(--text-muted)" data-i18n="labelEmail">البريد:</span> <code id="dtAccEmail" style="font-family:var(--font-mono)"></code></div>
      <div><span style="color:var(--text-muted)" data-i18n="labelLoginState">حالة الدخول:</span> <span id="dtAccLogged"></span></div>
      <div><span style="color:var(--text-muted)" data-i18n="labelProfilePath">مسار الملف الشخصي:</span> <div id="dtAccPath" style="font-size:11px;color:var(--text-dim);font-family:var(--font-mono);direction:ltr;word-break:break-all"></div></div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:8px;margin-top:20px">
      <button class="btn-stop btn-sm" id="btnDeleteAccount" data-i18n="btnDelete">حذف الحساب</button>
      <div style="display:flex;gap:6px">
        <button class="btn-primary btn-sm" id="btnActivateAccount" data-i18n="btnSetAsActive">تعيين كحساب نشط</button>
        <button class="btn-sm" id="btnLoginAccount" data-i18n="btnLogin">تسجيل الدخول</button>
      </div>
    </div>
  </div>
</div>

<!-- Modal: Add Custom Agent -->
<div id="addCustomAgentModal" class="modal-overlay">
  <div class="modal-card" style="width:540px">
    <div class="section-title">
      <span data-i18n="modalAddCustomAgentTitle">إضافة وكيل يدوي</span>
      <button class="btn-sm" onclick="closeAddCustomAgentModal()">✕</button>
    </div>
    <div class="form-group">
      <label data-i18n="labelAgentName">اسم الوكيل</label>
      <input type="text" id="inpCustomAgentName" class="form-input" placeholder="مثال: Pi Agent أو وكيل مخصص" data-i18n-ph="phAgentName" required/>
    </div>
    <div class="form-group">
      <label data-i18n="labelAgentId">معرّف الوكيل (Slug ID)</label>
      <input type="text" id="inpCustomAgentId" class="form-input" style="font-family:var(--font-mono);direction:ltr" placeholder="my-agent" data-i18n-ph="phAgentId"/>
    </div>
    <div class="form-group">
      <label data-i18n="labelAgentProtocol">بروتوكول الاتصال</label>
      <select id="selCustomAgentProtocol" class="form-input" style="direction:ltr">
        <option value="openai">OpenAI</option>
        <option value="anthropic">Anthropic</option>
        <option value="gemini">Gemini</option>
      </select>
    </div>
    <div class="form-group">
      <label data-i18n="labelAgentIcon">أيقونة الوكيل (emoji أو SVG)</label>
      <input type="text" id="inpCustomAgentIcon" class="form-input" placeholder="🤖" data-i18n-ph="phAgentIcon"/>
    </div>
    <div class="form-group">
      <label data-i18n="labelAgentCommand">الأمر / المسار (Command / Path)</label>
      <input type="text" id="inpCustomAgentCommand" class="form-input" style="font-family:var(--font-mono);direction:ltr" placeholder="my-agent أو /path/to/agent" data-i18n-ph="phAgentCommand"/>
    </div>
    <div class="form-group">
      <label data-i18n="labelAgentConfigPath">مسار ملف التكوين (Config Path)</label>
      <input type="text" id="inpCustomAgentConfigPath" class="form-input" style="font-family:var(--font-mono);direction:ltr" placeholder="~/.config/my-agent/config.json" data-i18n-ph="phAgentConfigPath"/>
    </div>
    <div class="form-group">
      <label data-i18n="labelAgentNotes">ملاحظات (اختياري)</label>
      <textarea id="inpCustomAgentNotes" class="form-input" rows="2" placeholder="أي تعليمات إضافية لتشغيل هذا الوكيل" data-i18n-ph="phAgentNotes"></textarea>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px">
      <button onclick="closeAddCustomAgentModal()" data-i18n="btnCancel">إلغاء</button>
      <button class="btn-primary" onclick="saveCustomAgent()" data-i18n="btnSaveCustomAgent">حفظ الوكيل</button>
    </div>
  </div>
</div>

<script>
// Official Vector SVG Icons (Optically Balanced & Authentic Brand Marks)
const BRAND_ICONS = {
  // Providers (22x22 viewBox 0 0 24 24)
  'claude-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" fill="#D97757" style="flex:none"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.45.255h.388l.055-.158-.134-.097-.103-.097L6.974 9.836 4.424 8.148l-1.336-.971-.723-.492-.364-.461-.158-1.008.656-.723.88.061.225.061.893.686 1.906 1.475 2.49 1.834.364.303.146-.103.018-.073-.164-.273-1.354-2.447-1.445-2.49-.643-1.031-.17-.62a2.33 2.33 0 00-.104-.728L6.287.134 6.7 0l.996.134.419.364.619 1.415 1.002 2.228 1.554 3.03.456.898.242.832.092.255h.158v-.146l.127-1.706.237-2.094.23-2.696.08-.759.376-.91.747-.492.583.28.48.685-.067.443-.285 1.852-.559 2.902-.364 1.943h.212l.243-.243.984-1.305 1.651-2.065.729-.82.85-.904.546-.431h1.032l.759 1.129-.34 1.166-1.063 1.348-.88 1.141-1.263 1.7-.79 1.36.073.11.189-.019 2.853-.607 1.542-.28 1.84-.315.832.388.09.395-.327.807-1.967.486-2.308.461-3.436.814-.043.03.049.06 1.548.147.662.036h1.62l3.018.225.79.522.473.638-.079.48-.94.497-2.279.06-2.459-.14-3.235-.2-1.397.043-.073.048.067.073 2.222 1.458 2.052 1.323 2.769 1.828.328.668-.316.82-1.129.546-2.083-1.063-2.35-1.487-2.46-1.725-.2-.097-.078.048.03.116 1.148 1.924 1.706 2.793 1.251 2.083.189.862-.51 1.038-.972.37-1.427-.376-1.579-2.277-1.64-2.477-1.572-2.52h-.14l-.067.098-.51 3.533-.48 2.374-.637 2.107-.759.613-.99-.042-.686-.808.207-1.05.74-2.733.626-3.048.334-2.18-.049-.079-.115.024-2.04 2.678-2.32 3.017-1.78 1.706-.82.492-.85-.437-.34-.984.455-.91 1.7-1.87 2.162-2.41 1.62-1.92z"/></svg>',
  'gemini-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" style="flex:none"><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001.52.52 0 000 .93 14.155 14.155 0 014.45 3.001 14.134 14.134 0 013.679 6.452.503.503 0 00.975 0 14.111 14.111 0 013.678-6.452 14.147 14.147 0 014.45-3.001.52.52 0 000-.93z" fill="#4E82EE"/><path d="M12 6.8a6.8 6.8 0 002.1 3.5 6.8 6.8 0 003.5 1.5 6.8 6.8 0 00-3.5 1.5A6.8 6.8 0 0012 16.8a6.8 6.8 0 00-2.1-3.5 6.8 6.8 0 00-3.5-1.5 6.8 6.8 0 003.5-1.5A6.8 6.8 0 0012 6.8z" fill="#A855F7" fill-opacity="0.65"/></svg>',
  'qwen-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" fill="#6366F1" style="flex:none"><path d="M19.713 2.825h-5.907c0-.251-.066-.503-.196-.728L12.819.728A1.46 1.46 0 0 0 11.559 0h-1.58c-.52 0-1 .275-1.26.728l-2.42 4.19a1.45 1.45 0 0 0 0 1.453l.791 1.37c.26.448.74.727 1.26.727h11.36c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-.79-1.37a1.46 1.46 0 0 0-1.26-.728zM.195 9.905l2.951 5.115a1.46 1.46 0 0 0-.531.531l-.791 1.37a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h4.84c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451L5.086 7.083a1.46 1.46 0 0 0-1.26-.728h-1.58c-.52 0-1 .276-1.26.728l-.79 1.37a1.45 1.45 0 0 0 0 1.452m15.888 13.367 2.951-5.115c.217.125.469.196.728.196h1.582c.52 0 1-.275 1.26-.728l.79-1.37a1.45 1.45 0 0 0 0-1.451l-2.42-4.191a1.46 1.46 0 0 0-1.259-.728h-1.582c-.52 0-1 .276-1.259.728l-5.678 9.838a1.45 1.45 0 0 0 0 1.452l.79 1.37c.26.448.74.727 1.26.727h1.582c.52 0 1-.275 1.26-.728z"/></svg>',
  'zai-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" style="flex:none"><rect x="2" y="2" width="20" height="20" rx="5.5" fill="#2563EB"/><path d="M7.2 7.5h9.6L9.9 16.5h6.9" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="17.2" cy="7.5" r="1.3" fill="#60A5FA"/></svg>',
  'tencent-ai-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" style="flex:none"><circle cx="12" cy="12" r="10.2" fill="#0052D9"/><path d="M12 1.8A10.2 10.2 0 0122.2 12c0 5.63-4.57 10.2-10.2 10.2" fill="#00A870" fill-opacity="0.55"/><path d="M7 10.5c0-1.9 2.2-3.5 5-3.5s5 1.6 5 3.5c0 2.6-2.2 5.5-5 5.5s-5-2.9-5-5.5zm2.4-.3a2.6 2.6 0 005.2 0c0-.8-1.2-1.4-2.6-1.4s-2.6.6-2.6 1.4z" fill="#fff"/></svg>',
  'arena-browser': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.45 1-1 1H7.5"/><path d="M14 14.66V17c0 .55.45 1 1 1h1.5"/><path d="M6 2v7a6 6 0 0 0 12 0V2Z"/></svg>',
  'chatgpt-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" fill="#10A37F" style="flex:none"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 8.937a4.485 4.485 0 0 1 2.366-1.973V12.6a.766.766 0 0 0 .388.677l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 8.937zm16.924 3.73l-5.844-3.37 2.02-1.166a.076.076 0 0 1 .071 0l4.83 2.79A4.504 4.504 0 0 1 18.66 16.4v-5.656a.766.766 0 0 0-.396-.677zm2.4-4.86a4.494 4.494 0 0 1 .536 3.018l-.142-.085-4.783-2.759a.771.771 0 0 0-.78 0L10.65 11.35V9.018a.08.08 0 0 1 .033-.062L15.52 6.16a4.5 4.5 0 0 1 6.145 1.646zM10.74 3.57a4.476 4.476 0 0 1 2.876 1.04l-.141.081-4.779 2.758a.795.795 0 0 0-.392.681v6.737l-2.02-1.168a.071.071 0 0 1-.038-.052V8.064a4.504 4.504 0 0 1 4.494-4.494zm-1.01 7.21l3.003-1.733 3.003 1.733v3.466l-3.003 1.733-3.003-1.733z"/></svg>',
  'grok-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" style="flex:none"><path d="M2.3 21.7L21.7 2.3M9.25 14.75a5.5 5.5 0 1 1 7.78-7.78 5.5 5.5 0 0 1-7.78 7.78z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
  'kimi-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" style="flex:none"><circle cx="12" cy="12" r="10.5" fill="#111827" stroke="#00E599" stroke-width="1.5"/><path d="M8.2 7v10M15.8 7l-5.2 5 5.2 5" stroke="#00E599" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="16.8" cy="7.2" r="1.4" fill="#38BDF8"/></svg>',
  'minimax-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" style="flex:none"><rect x="2" y="2" width="20" height="20" rx="6" fill="#FF3B5C"/><path d="M12 2h4a6 6 0 016 6v8a6 6 0 01-6 6h-4V2z" fill="#FF8A00" fill-opacity="0.45"/><path d="M5.5 14.5V9.5c0-1.1.9-2 2-2s2 .9 2 2v5m0-3.5c0-1.1.9-2 2-2s2 .9 2 2v3.5m0-3.5c0-1.1.9-2 2-2s2 .9 2 2v3.5" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  'longcat-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" fill="#F59E0B" style="flex:none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5c0 .83-.67 1.5-1.5 1.5S10 17.33 10 16.5V9.5C10 8.67 10.67 8 11.5 8s1.5.67 1.5 1.5v7zm-5-3c0 .83-.67 1.5-1.5 1.5S5 14.33 5 13.5v-2C5 10.67 5.67 10 6.5 10s1.5.67 1.5 1.5v2zm10 0c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5v-2c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v2z"/></svg>',
  'llm7-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" style="flex:none"><rect width="20" height="20" x="2" y="2" rx="5.5" fill="#8B5CF6" fill-opacity="0.18" stroke="#8B5CF6" stroke-width="1.6"/><path d="M8 7.5h8l-4.8 9.2H8.6l4.2-7.4H8V7.5z" fill="#A78BFA"/></svg>',
  'kiwi-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" style="flex:none"><circle cx="12" cy="12" r="10" fill="#365c3c"/><circle cx="12" cy="12" r="8.5" fill="#97cf43"/><circle cx="12" cy="12" r="3" fill="#fff"/><circle cx="12" cy="12" r="2" fill="#e2f1c8"/><circle cx="12" cy="7.5" r="0.7" fill="#486822"/><circle cx="15.5" cy="9.5" r="0.7" fill="#486822"/><circle cx="15.5" cy="14.5" r="0.7" fill="#486822"/><circle cx="12" cy="16.5" r="0.7" fill="#486822"/><circle cx="8.5" cy="14.5" r="0.7" fill="#486822"/><circle cx="8.5" cy="9.5" r="0.7" fill="#486822"/></svg>',
  'deepseek-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" style="flex:none"><rect width="20" height="20" x="2" y="2" rx="5.5" fill="#4D6BFE"/><path d="M18.6 9.6c-.8-.3-1.6-.1-2.2.4-.5-.9-1.5-1.6-2.8-1.8-2.6-.4-5.1 1.1-5.8 3.5-.3 1.1-.2 2.2.3 3.1-.7.2-1.4.1-2-.3-.3-.2-.7.1-.5.4.6 1 1.8 1.5 3.1 1.3 1.1.8 2.6 1.2 4.1.9 2.5-.4 4.4-2.4 4.5-4.9.7-.3 1.3-.9 1.6-1.7.2-.4-.1-.8-.3-.9zm-4.9 2.2a.95.95 0 110-1.9.95.95 0 010 1.9z" fill="#FFFFFF"/></svg>',
  'mistral-web': '<svg class="brand-svg" viewBox="0 0 24 24" width="22" height="22" style="flex:none"><path d="M3 4h4v3.2H3V4zm14 0h4v3.2h-4V4z" fill="#FFD800"/><path d="M3 7.2h7.2v3.2H3V7.2zm10.8 0H21v3.2h-7.2V7.2z" fill="#FFAF00"/><path d="M3 10.4h18v3.2H3v-3.2z" fill="#FF8205"/><path d="M3 13.6h4v3.2H3v-3.2zm7 0h4v3.2h-4v-3.2zm7 0h4v3.2h-4v-3.2z" fill="#FA500F"/><path d="M1 16.8h8V20H1v-3.2zm14 0h8V20h-8v-3.2z" fill="#E10500"/></svg>',

  // Coding Agents & Clients (18x18 viewBox 0 0 24 24)
  'opencode': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><rect x="2" y="3" width="20" height="18" rx="4" fill="#1E293B" stroke="#38BDF8" stroke-width="1.8"/><path d="M7.5 9.5L10.5 12l-3 2.5M12.5 14.5h4" stroke="#38BDF8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  'claudecode': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" fill="#D97757" style="flex:none"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.45.255h.388l.055-.158-.134-.097-.103-.097L6.974 9.836 4.424 8.148l-1.336-.971-.723-.492-.364-.461-.158-1.008.656-.723.88.061.225.061.893.686 1.906 1.475 2.49 1.834.364.303.146-.103.018-.073-.164-.273-1.354-2.447-1.445-2.49-.643-1.031-.17-.62a2.33 2.33 0 00-.104-.728L6.287.134 6.7 0l.996.134.419.364.619 1.415 1.002 2.228 1.554 3.03.456.898.242.832.092.255h.158v-.146l.127-1.706.237-2.094.23-2.696.08-.759.376-.91.747-.492.583.28.48.685-.067.443-.285 1.852-.559 2.902-.364 1.943h.212l.243-.243.984-1.305 1.651-2.065.729-.82.85-.904.546-.431h1.032l.759 1.129-.34 1.166-1.063 1.348-.88 1.141-1.263 1.7-.79 1.36.073.11.189-.019 2.853-.607 1.542-.28 1.84-.315.832.388.09.395-.327.807-1.967.486-2.308.461-3.436.814-.043.03.049.06 1.548.147.662.036h1.62l3.018.225.79.522.473.638-.079.48-.94.497-2.279.06-2.459-.14-3.235-.2-1.397.043-.073.048.067.073 2.222 1.458 2.052 1.323 2.769 1.828.328.668-.316.82-1.129.546-2.083-1.063-2.35-1.487-2.46-1.725-.2-.097-.078.048.03.116 1.148 1.924 1.706 2.793 1.251 2.083.189.862-.51 1.038-.972.37-1.427-.376-1.579-2.277-1.64-2.477-1.572-2.52h-.14l-.067.098-.51 3.533-.48 2.374-.637 2.107-.759.613-.99-.042-.686-.808.207-1.05.74-2.733.626-3.048.334-2.18-.049-.079-.115.024-2.04 2.678-2.32 3.017-1.78 1.706-.82.492-.85-.437-.34-.984.455-.91 1.7-1.87 2.162-2.41 1.62-1.92z"/></svg>',
  'cursor': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" style="flex:none"><path d="M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z"/></svg>',
  'vscode': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" fill="#007ACC" style="flex:none"><path d="M17.5 1.5L7.2 10.6 2.7 7.1 1 8.5l4.2 3.5L1 15.5l1.7 1.4 4.5-3.5 10.3 9.1L23 19.8V4.2L17.5 1.5zm0 6.2v8.6L10.2 12l7.3-4.3z"/></svg>',
  'windsurf': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" fill="#00E599" style="flex:none"><path clip-rule="evenodd" d="M23.78 5.004h-.228a2.187 2.187 0 00-2.18 2.196v4.912c0 .98-.804 1.775-1.76 1.775a1.818 1.818 0 01-1.472-.773L13.168 5.95a2.197 2.197 0 00-1.81-.95c-1.134 0-2.154.972-2.154 2.173v4.94c0 .98-.797 1.775-1.76 1.775-.57 0-1.136-.289-1.472-.773L.408 5.098C.282 4.918 0 5.007 0 5.228v4.284c0 .216.066.426.188.604l5.475 7.889c.324.466.8.812 1.351.938 1.377.316 2.645-.754 2.645-2.117V11.89c0-.98.787-1.775 1.76-1.775h.002c.586 0 1.135.288 1.472.773l4.972 7.163a2.15 2.15 0 001.81.95c1.158 0 2.151-.973 2.151-2.173v-4.939c0-.98.787-1.775 1.76-1.775h.194c.122 0 .22-.1.22-.222V5.225a.221.221 0 00-.22-.222z"/></svg>',
  'hermes': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#38BDF8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><rect width="18" height="18" x="3" y="3" rx="3"/><path d="m9 8 3 3-3 3"/><path d="m15 8-3 3 3 3"/></svg>',
  'python': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" fill="#38BDF8" style="flex:none"><path d="M11.858 0c-.978.005-1.913.088-2.736.234C6.7.662 6.26 1.558 6.26 3.21v2.182h5.725v.727H4.111c-1.664 0-3.121 1-3.577 2.903-.526 2.181-.549 3.542 0 5.82.407 1.694 1.379 2.902 3.043 2.902h1.969v-2.616c0-1.89 1.635-3.557 3.576-3.557h5.72c1.591 0 2.862-1.31 2.862-2.91v-5.45c0-1.553-1.309-2.718-2.863-2.977A18 18 0 0 0 11.858 0M8.762 1.755c.591 0 1.074.491 1.074 1.095 0 .601-.483 1.087-1.074 1.087A1.08 1.08 0 0 1 7.688 2.85c0-.604.48-1.095 1.074-1.095m9.656 4.364v2.543c0 1.971-1.671 3.63-3.577 3.63H9.122c-1.566 0-2.862 1.34-2.862 2.91v5.452c0 1.551 1.349 2.464 2.862 2.91 1.813.532 3.55.628 5.72 0 1.44-.418 2.862-1.258 2.862-2.91V18.47h-5.719v-.727h8.582c1.664 0 2.284-1.16 2.862-2.903.598-1.793.573-3.518 0-5.819-.41-1.656-1.196-2.903-2.862-2.903zm-3.216 13.807a1.08 1.08 0 0 1 1.074 1.088c0 .604-.48 1.094-1.074 1.094-.592 0-1.075-.49-1.075-1.094 0-.601.483-1.088 1.075-1.088"/></svg>',
  'geminicli': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001.52.52 0 000 .93 14.155 14.155 0 014.45 3.001 14.134 14.134 0 013.679 6.452.503.503 0 00.975 0 14.111 14.111 0 013.678-6.452 14.147 14.147 0 014.45-3.001.52.52 0 000-.93z" fill="#60A5FA"/></svg>',
  'antigravity': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><circle cx="12" cy="12" r="5" fill="#4285F4"/><ellipse cx="12" cy="12" rx="10" ry="4" fill="none" stroke="#8AB4F8" stroke-width="1.8" transform="rotate(-25 12 12)"/><circle cx="19" cy="8" r="1.6" fill="#8AB4F8"/></svg>',
  'codex': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><path d="M4 3h16a1 1 0 011 1v16a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1zm3 5v2h2.5v6H7v2h8v-2h-2.5V10H15V8H7z" fill="#10A37F"/></svg>',
  't3': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><path d="M12 2L3 20h18L12 2zm0 4l6 12H6l6-12z" fill="#FF6B35"/></svg>',
  'lobehub': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><path d="M12 2a5 5 0 015 5v1h3a2 2 0 012 2v2a2 2 0 01-2 2h-3v1a5 5 0 01-5 5H7a2 2 0 01-2-2v-1H4a2 2 0 01-2-2v-2a2 2 0 012-2h1V7a5 5 0 015-5h2zm0 2H7a3 3 0 00-3 3v1h8V7a3 3 0 00-3-3zm-5 6H4v2h3v-2zm12 0h-3v2h3v-2zM7 14v1a3 3 0 003 3h2a3 3 0 003-3v-1H7zm2 3h6v2H9v-2z" fill="#7C3AED"/></svg>',
  'jan': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><rect x="3" y="4" width="18" height="14" rx="3" fill="#2D3748" stroke="#4FD1C5" stroke-width="1.5"/><circle cx="9" cy="11" r="1.8" fill="#4FD1C5"/><circle cx="15" cy="11" r="1.8" fill="#4FD1C5"/><path d="M9 15c0 1.5 1.3 2.5 3 2.5s3-1 3-2.5" stroke="#4FD1C5" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M12 4V2" stroke="#4FD1C5" stroke-width="2" stroke-linecap="round"/></svg>',
  'anythingllm': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><circle cx="12" cy="12" r="8" fill="none" stroke="#6366F1" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#6366F1" fill-opacity="0.25"/><circle cx="12" cy="12" r="2" fill="#818CF8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2" stroke="#818CF8" stroke-width="1.5" stroke-linecap="round"/></svg>',
  'librechat': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><path d="M4 5a3 3 0 013-3h8a3 3 0 013 3v7a3 3 0 01-3 3H9l-5 4V5z" fill="#10A37F" fill-opacity="0.85"/><path d="M20 9a3 3 0 013 3v3a3 3 0 01-3 3v3l-4-3h-3" fill="#0E8A6C" fill-opacity="0.85"/></svg>',
  'zed': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><path d="M4 3h9l-2.5 4.5H15L7 15h5l-2 6-8-11h5.5L4 3z" fill="#8B5CF6"/><path d="M16 3h4l-2 4h3l-8 11h-4l2-5h-3l7-10z" fill="#A78BFA"/></svg>',
  'pi': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><path d="M4 6h16M4 6c0 4 2 7 5 7h6c3 0 5-3 5-7M9 6v12m6-12v12" stroke="#F59E0B" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'alphacode': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><path d="M12 1l10 6v10l-10 6L2 17V7l10-6z" fill="none" stroke="#EF4444" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 16L12 8l4 8M9.5 13h5" stroke="#EF4444" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'kiro': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><circle cx="12" cy="12" r="9" fill="none" stroke="#0EA5E9" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="#0EA5E9" stroke-width="1.8"/><circle cx="12" cy="12" r="1.5" fill="#0EA5E9"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="#0EA5E9" stroke-width="1.8" stroke-linecap="round"/></svg>',
  'openwebui': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><circle cx="12" cy="12" r="9" fill="#111827" stroke="#3B82F6" stroke-width="1.8"/><path d="M8 12a4 4 0 108 0 4 4 0 00-8 0z" fill="#3B82F6" fill-opacity="0.3"/><circle cx="12" cy="12" r="1.8" fill="#60A5FA"/></svg>',
  'dify': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><rect x="3" y="3" width="18" height="18" rx="4" fill="#155EEF"/><path d="M7 8h10M7 12h7M7 16h10" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  'flowise': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><rect x="3" y="3" width="6" height="6" rx="2" fill="#6366F1"/><rect x="15" y="3" width="6" height="6" rx="2" fill="#8B5CF6"/><rect x="9" y="15" width="6" height="6" rx="2" fill="#A78BFA"/><path d="M6 9v3a3 3 0 003 3h0M18 9v3a3 3 0 01-3 3h0" stroke="#6366F1" stroke-width="1.8" fill="none"/></svg>',
  'n8n': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><circle cx="6" cy="12" r="3" fill="#EA4B71"/><circle cx="18" cy="7" r="3" fill="#EA4B71"/><circle cx="18" cy="17" r="3" fill="#EA4B71"/><path d="M9 12h4M13 10l2-1M13 14l2 1" stroke="#EA4B71" stroke-width="2" stroke-linecap="round"/></svg>',
  'continue': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><rect x="3" y="3" width="18" height="18" rx="5" fill="#1E293B" stroke="#22C55E" stroke-width="1.8"/><path d="M8 12h8M12 8v8" stroke="#22C55E" stroke-width="2.2" stroke-linecap="round"/></svg>',
  'roocode': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><rect x="3" y="3" width="18" height="18" rx="5" fill="#7C3AED"/><path d="M7 15l3-6 2 4 2-4 3 6" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'aider': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><circle cx="12" cy="12" r="9" fill="#0F766E"/><path d="M8 15l4-7 4 7M9.5 13h5" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'copilot': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><defs><linearGradient id="copilotG" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#7C3AED"/><stop offset="50%" stop-color="#2563EB"/><stop offset="100%" stop-color="#06B6D4"/></linearGradient></defs><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="url(#copilotG)"/><path d="M8 9.2c0-1.8 1.3-3.2 3.1-3.2h1.8c1.8 0 3.1 1.4 3.1 3.2v5.6c0 1.8-1.3 3.2-3.1 3.2h-1.8C9.3 18 8 16.6 8 14.8V9.2z" fill="#fff" fill-opacity="0.95"/><path d="M10 9.8h1.2v4.4H10zm2.8 0H14v4.4h-1.2z" fill="#2563EB"/></svg>',
  'sillytavern': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" style="flex:none"><path d="M4 6c0-1.1.9-2 2-2h12a2 2 0 012 2v2c0 4-3 7-8 7s-8-3-8-7V6z" fill="#F59E0B"/><path d="M9 15v3a3 3 0 006 0v-3" stroke="#F59E0B" stroke-width="2" fill="none"/><circle cx="9.5" cy="9" r="1" fill="#fff"/><circle cx="14.5" cy="9" r="1" fill="#fff"/></svg>',
  'curl': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#94A3B8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  'openai': '<svg class="brand-svg" viewBox="0 0 24 24" width="18" height="18" fill="#10A37F" style="flex:none"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073z"/></svg>'
};

function normalizeBrandKey(id){
  if(!id) return '';
  const raw = String(id).trim();
  if(BRAND_ICONS[raw]) return raw;
  const s = raw.toLowerCase().replace(/[\\s_-]+/g, '');
  if(s.includes('claude')) return 'claudecode';
  if(s.includes('opencode')) return 'opencode';
  if(s.includes('cursor')) return 'cursor';
  if(s.includes('windsurf')) return 'windsurf';
  if(s.includes('vscode') || s.includes('cline') || s.includes('continue')) return 'vscode';
  if(s.includes('python')) return 'python';
  if(s.includes('gemini')) return 'geminicli';
  if(s.includes('antigravity')) return 'antigravity';
  if(s.includes('codex')) return 'codex';
  if(s.includes('t3code') || s === 't3') return 't3';
  if(s.includes('lobehub')) return 'lobehub';
  if(s.includes('jan')) return 'jan';
  if(s.includes('anythingllm')) return 'anythingllm';
  if(s.includes('librechat')) return 'librechat';
  if(s.includes('zed')) return 'zed';
  if(s.includes('hermes')) return 'hermes';
  if(s.includes('pi')) return 'pi';
  if(s.includes('alphacode')) return 'alphacode';
  if(s.includes('kiro') || s.includes('kilo')) return 'kiro';
  if(s.includes('openwebui')) return 'openwebui';
  if(s.includes('dify')) return 'dify';
  if(s.includes('flowise')) return 'flowise';
  if(s.includes('n8n')) return 'n8n';
  if(s.includes('continue')) return 'continue';
  if(s.includes('roo')) return 'roocode';
  if(s.includes('aider')) return 'aider';
  if(s.includes('copilot')) return 'copilot';
  if(s.includes('sillytavern')) return 'sillytavern';
  if(s.includes('curl')) return 'curl';
  if(s.includes('openai')) return 'openai';
  return raw;
}

// Official vendor logos downloaded locally to public/vendors (png).
// One file per brand (trimmed to the glyph, transparent background). Brands
// with a dark monochrome glyph get invert:true so the dark theme flips it
// to white. Size/layout is owned by CSS (img fills its icon badge).
const BRAND_LOGO_FILES = {
  'arena-browser': { file: 'arena-web.png', invert: true },
  'grok-web': { file: 'grok-web.png', invert: true },
  'kimi-web': { file: 'kimi-web.png', invert: true },
  'longcat-web': { file: 'longcat-web.png' },
  'deepseek-web': { file: 'deepseek-web.png' },
  'kiwi-web': { file: 'kiwi-web.png' },
  'llm7-web': { file: 'llm7-web.png' },
  'minimax-web': { file: 'minimax-web.png' },
  'tencent-ai-web': { file: 'tencent-web.png' },
  'zai-web': { file: 'zai-web.png' }
};

// Provider glyphs (inline SVG) that render native like the downloaded logos —
// no badge frame/background. ChatGPT deliberately stays framed.
const NATIVE_ICON_BRANDS = ['claude-web', 'gemini-web', 'qwen-web', 'mistral-web'];

function brandLogoMarkup(entry){
  const cls = 'brand-logo' + (entry.invert ? ' brand-invert' : '');
  return '<img src="/vendors/' + entry.file + '" class="' + cls + '" alt=""/>';
}

function getBrandIcon(id){
  const key = normalizeBrandKey(id);
  const logo = BRAND_LOGO_FILES[key] || BRAND_LOGO_FILES[id];
  if(logo) return brandLogoMarkup(logo);
  const icon = BRAND_ICONS[key] || BRAND_ICONS['opencode'];
  // These provider glyphs render native (no badge frame/background) to match
  // the downloaded brand logos
  if(NATIVE_ICON_BRANDS.includes(key) || NATIVE_ICON_BRANDS.includes(id)){
    return '<span class="brand-native">' + icon + '</span>';
  }
  return icon;
}

// Multilingual Internationalization Dictionary (6 Languages: AR, EN, FR, RU, ES, ZH)
const I18N = {
  ar: {
    documentTitle: "EMO-AI Gateway — لوحة التحكم",
    serviceToggleTitle: "تشغيل أو إيقاف استقبال الطلبات على البوابة",
    clearLogHint: "مسح سجل الطلبات المعروضة",
    baseUrlLabel: "Base URL:",
    apiKeyLabel: "API Key:",
    metricPromptShort: "المدخلات:",
    metricComplShort: "| المخرجات:",
    labelOpenAiBaseUrl: "OpenAI Base URL (/v1)",
    labelAnthropicBaseUrl: "Anthropic Base URL (Claude Code)",
    labelGeminiBaseUrl: "Gemini Base URL (Gemini CLI)",
    labelDefaultApiKey: "مفتاح API الافتراضي",
    topoWrapperAria: "مخطط الربط الحي: يمكن التنقل بين العقد بمفتاح Tab لإبراز مسارات التدفق",
    hubAriaLabel: "EMO-AI Gateway Core — البوابة المركزية متعددة البروتوكولات",
    engineDesc: "",
    navOverview: "لوحة التحكم",
    navUsage: "سجل الطلبات",
    navConnect: "ربط الوكلاء والمحررات",
    navProviders: "المزوّدات والنماذج",
    navAccounts: "إدارة الحسابات",
    navRouter: "مجموعات الراوتر",
    navKeys: "مفاتيح API والمزودات",
    navSwarm: "موجه الوكلاء (Swarm)",
    sidebarToggleCollapse: "طي القائمة الجانبية",
    sidebarToggleExpand: "توسيع القائمة الجانبية",
    langLabel: "اللغة",
    themeToggleTitle: "تبديل المظهر (داكن / فاتح)",
    darkMode: "الوضع الداكن",
    lightMode: "الوضع الفاتح",
    settingsTitle: "الإعدادات",
    settingsClose: "إغلاق",
    appearanceLabel: "المظهر",
    langAndAppearance: "اللغة والمظهر",
    appUpdateLabel: "تحديث التطبيق",
    currentVersionLabel: "الإصدار الحالي",
    checkUpdateBtn: "تحقق من التحديثات",
    connectionsLabel: "الاتصالات",
    mcpConnection: "الاتصال بالوكلاء",
    toastCheckingUpdate: "جارٍ التحقق من التحديثات...",
    toastAppUpToDate: "التطبيق محدّث ({version})",
    settingsPageSubtitle: "إدارة اللغة والمظهر ومعلومات التطبيق والربط مع الوكلاء",
    aboutAppLabel: "عن التطبيق",
    latestVersionLabel: "آخر إصدار",
    agentConnectionSection: "الربط مع الوكلاء",
    agentConnectionSettingsDesc: "إدارة الاتصال بالوكلاء والربط التلقائي واليدوي وإعداد MCP.",
    openAgentConnectionBtn: "اعدادات الاتصال بالوكلاء",
    connectTabAuto: "ربط تلقائي",
    connectTabManual: "ربط يدوي",
    connectTabMcp: "ربط MCP",
    mcpSetupTitle: "إعداد وتهيئة MCP",
    mcpSetupDesc: "أنشئ إعداد MCP للوكيل المحدد واختر هدف التكامل ثم انسخ ملف/مقتطف الإعداد.",
    mcpTargetLabel: "هدف MCP",
    mcpServerNameLabel: "اسم خادم MCP",
    mcpConfigTitle: "إعداد MCP الناتج",
    mcpCopyConfig: "نسخ إعداد MCP",
    mcpHintAgent: "اختر الوكيل والنموذج من الأعلى ليتم تضمينهما في الإعداد.",
    manualConfigTitle: "الإعداد اليدوي (مقتطف التهيئة)",
    autoConfigSectionTitle: "الربط التلقائي للوكيل",
    identifierLabel: "المعرّف:",
    endpointLabel: "نقطة النهاية:",
    gatewayConnected: "البوابة متصلة",
    gatewayDisconnected: "انقطاع الاتصال",
    overviewTitle: "لوحة التحكم",
    overviewSubtitle: "حالة البوابة، مسارات الربط، ومؤشرات الأداء",
    serviceRunning: "الخدمة نشطة",
    serviceStopped: "الخدمة متوقفة",
    btnStopService: "إيقاف الخدمة",
    btnStartService: "تشغيل الخدمة",
    btnQuickRefresh: "تحديث",
    btnQuickRefreshTitle: "تحديث البيانات الآن",
    btnRefreshing: "جارٍ التحديث…",
    toastRefreshed: "تم تحديث البيانات",
    toastRefreshFailed: "تعذر تحديث البيانات",
    btnCopy: "نسخ",
    copied: "تم النسخ",
    metricUptime: "مدة التشغيل",
    metricLive: "مباشر",
    metricSinceStart: "منذ بدء التشغيل",
    metricTotalTokens: "إجمالي الرموز المقدرة",
    metricSuccessRate: "نسبة نجاح الطلبات",
    metricCompletedOfPart: "مكتمل من",
    metricRequestsPart: "طلب",
    metricActiveProviders: "المزوّدات النشطة",
    metricActiveModelsPart: "نموذج مفعل",
    topoLiveFlow: "مخطط الربط الحي",
    topoLivePulse: "متصل",
    topoFlowStopped: "متوقف",
    topoAutoSync: "تحديث تلقائي كل 3 ثوانٍ",
    topoInboundChannels: "قنوات واردة",
    topoActiveProviders: "مزودات نشطة",
    topoPrivacyPath: "وضع الخصوصية",
    topoPulseBtn: "فحص المسارات",
    topoPulsing: "جارٍ الفحص...",
    topoAgentsTitle: "الوكلاء ومحررات الكود",
    topoAgentsScanning: "جارٍ فحص الأدوات المثبتة...",
    topoHubTitle: "البوابة المركزية",
    topoHubPortIn: "منفذ الاستقبال الوارد",
    topoHubPortOut: "منفذ الإمداد للمزودات",
    topoHubUptime: "مدة تشغيل البوابة",
    topoHubReqRate: "معدل الطلبات (لكل دقيقة)",
    topoHubReqRateUnit: "/د",
    topoHubLatency: "زمن الاستجابة وسرعة الاتصال",
    topoProvidersTitle: "المزوّدات النشطة",
    topoProvidersLoading: "جارٍ تحميل المزودات النشطة...",
    topoNoActiveProviders: "لا يوجد مزود مفعل حالياً",
    topoLiveNow: "مباشر الآن",
    topoRecent: "نشط مؤخراً",
    topoStandby: "جاهز للاستقبال",
    topoInFlight: "قيد المعالجة",
    topoRouteTo: "المسار",
    topoLiveRequests: "طلبات متدفقة",
    topoServing: "يخدم طلباً",
    topoNoLiveAgents: "لا توجد قنوات نشطة حالياً — قم بتنفيذ طلب عبر الوكلاء لظهور العقدة ومسار التدفق",
    requestInFlight: "قيد التنفيذ…",
    topoCustom: "مخصص",
    topoNoLiveProvs: "لا يوجد مزود يخدم طلباً قيد التنفيذ الآن — يظهر المزود هنا فقط أثناء تنفيذ طلب عبره",
    topoWaitingRequests: "في انتظار تدفق الطلبات",
    topoWaitingRequestsSub: "تظهر أدوات التطوير والوكلاء هنا لحظياً بمجرد إرسال طلب جديد",
    topoWaitingProvs: "في انتظار المزودات",
    topoWaitingProvsSub: "يظهر المزود الذي يخدم الطلب لحظياً أثناء المعالجة وتدفق البيانات",
    topoLastProv: "آخر مزود",
    topoInteractionHint: "مرّر المؤشر فوق أي عقدة لإبراز مسارات الاتصال",
    topoLegendFlow: "تدفق قياسي",
    topoLegendPrivacy: "مسار خصوصية",
    topoLegendDormant: "مسار خامل",
    quickModelsTitle: "النماذج المفعلة",
    quickModelsSubtitle: "انقر على اسم النموذج لنسخه",
    quickModelsEmpty: "لا توجد نماذج مفعلة حالياً. اختر النماذج من صفحة المزوّدات ثم اضغط حفظ.",
    consumptionTitle: "سجل الطلبات والاستهلاك",
    consumptionSubtitle: "تفاصيل الطلبات الواردة، زمن الاستجابة، وحجم الاستهلاك",
    btnClearLog: "مسح السجل",
    metricPromptChars: "أحرف الإدخال",
    metricComplChars: "أحرف الإخراج",
    metricStreamReq: "طلبات البث",
    metricLifetimeReq: "إجمالي الطلبات",
    thTimestamp: "الوقت",
    thAgent: "الوكيل",
    thModel: "النموذج",
    thType: "النوع",
    thTokens: "الرموز",
    thLatency: "الاستجابة",
    thStatus: "الحالة",
    noRequestsRecorded: "لا توجد طلبات مسجلة بعد.",
    connectTitle: "الاتصال بالوكلاء",
    connectSubtitle: "إدارة الاتصال بالوكلاء عبر الربط التلقائي واليدوي وإعداد MCP مع اختيار الوكيل المناسب.",
    localAgentsListTitle: "الوكلاء والمحررات المحلية",
    installedOnDevice: "مثبت",
    setupGuide: "دليل الإعداد",
    selectSnippetModelLabel: "النموذج الافتراضي:",
    copyCodeBtn: "نسخ الكود",
    btnRescanAgents: "إعادة الفحص",
    btnAddCustomAgent: "+ إضافة وكيل",
    autoConnectTitle: "التكوين التلقائي",
    autoConnectDesc: "تحديث ملف إعدادات الأداة تلقائياً مع حفظ نسخة احتياطية (.bak)",
    btnAutoConnect: "تطبيق الإعدادات",
    btnDeleteCustomAgent: "حذف الوكيل",
    modalAddCustomAgentTitle: "إضافة وكيل مخصص",
    labelAgentName: "اسم الوكيل",
    phAgentName: "مثال: Pi Agent أو وكيل مخصص",
    labelAgentId: "المعرّف",
    phAgentId: "my-agent",
    labelAgentProtocol: "بروتوكول الاتصال",
    labelAgentIcon: "الأيقونة",
    phAgentIcon: "AG",
    labelAgentCommand: "الأمر أو المسار",
    phAgentCommand: "my-agent أو /path/to/agent",
    labelAgentConfigPath: "مسار ملف الإعدادات",
    phAgentConfigPath: "~/.config/my-agent/config.json",
    labelAgentNotes: "ملاحظات (اختياري)",
    phAgentNotes: "أي تعليمات إضافية لتشغيل هذا الوكيل",
    btnSaveCustomAgent: "حفظ الوكيل",
    agentCustom: "مخصص",
    agentConfigured: "مهيأ",
    scanningAgents: "جارٍ البحث...",
    scanningAgentsToast: "جارٍ فحص الجهاز للوكلاء والمحررات...",
    agentsScanDone: "تم العثور على {count} وكيل مثبت",
    autoConnecting: "جارٍ التطبيق...",
    autoConnectSuccess: "تم تطبيق الإعدادات بنجاح",
    autoConnectFailed: "تعذر تطبيق الإعدادات تلقائياً",
    agentNotInstalledMsg: "هذا الوكيل غير مثبت على جهازك — ثبّته أولاً ثم أعد المحاولة",
    noAgentSelected: "يرجى اختيار وكيل أولاً",
    agentNameRequired: "اسم الوكيل مطلوب",
    agentSaved: "تم حفظ الوكيل المخصص بنجاح",
    agentDeleted: "تم حذف الوكيل المخصص",
    notCustomAgent: "هذا الوكيل ليس مخصصاً",
    confirmDeleteAgent: "هل أنت متأكد من حذف الوكيل {name}؟",
    providersTitle: "المزوّدات والنماذج",
    providersSubtitle: "تشغيل المزوّدات، تحديد النماذج المفعلة، وإدارة الجلسات",
    accountsTitle: "إدارة الحسابات",
    accountsSubtitle: "إضافة الحسابات والتبديل بينها لكل مزود",
    btnAddAccount: "+ إضافة حساب",
    thProvider: "المزود",
    thAccountName: "اسم الحساب",
    thEmail: "البريد الإلكتروني",
    thLoginStatus: "حالة الدخول",
    thActiveStatus: "الحالة",
    thActions: "الإجراءات",
    keysTitle: "مفاتيح API والمزوّدات المخصصة",
    keysSubtitle: "إدارة مفاتيح الوصول للبوابة وربط مزوّدات API خارجية",
    btnAddCustomKey: "+ مفتاح جديد",
    btnAddCustomProvider: "+ إضافة مزود",
    routerTitle: "مجموعات الراوتر",
    routerSubtitle: "اجمع نماذج من مزودين وحسابات مختلفة تحت اسم واحد مع failover أو توزيع بالتناوب",
    routerHint: "اسم المجموعة يصبح اسم النموذج (model) للعميل. sequential = تجربة بالترتيب عند الفشل، round-robin = توزيع بالتناوب.",
    btnAddRouterGroup: "+ مجموعة جديدة",
    rgModalCreateTitle: "إنشاء مجموعة راوتر",
    rgModalEditTitle: "تعديل المجموعة",
    rgNameLabel: "اسم المجموعة (اسم النموذج)",
    rgIconLabel: "أيقونة",
    rgStrategyLabel: "الاستراتيجية",
    rgStrategySeq: "بالترتيب (failover)",
    rgStrategyRR: "بالتناوب (round-robin)",
    rgTargetsLabel: "الأهداف (بالترتيب = الأولوية)",
    rgAddTarget: "+ إضافة هدف",
    rgTargetsHint: "تثبيت حساب يغيّر البروفايل النشط للمزوّد عند الحاجة. تجنّب حسابين مختلفين لنفس المزوّد في round-robin.",
    rgNoGroups: "لا توجد مجموعات بعد. أنشئ مجموعة لتجميع نماذجك المفضلة.",
    rgTargetProvider: "المزوّد",
    rgTargetModel: "النموذج",
    rgTargetAccount: "الحساب",
    rgAccountActive: "الحساب النشط (افتراضي)",
    rgBtnTest: "اختبار",
    rgBtnEdit: "تعديل",
    rgBtnDelete: "حذف",
    rgEnabled: "مفعّلة",
    rgDisabled: "موقوفة",
    rgApiKeyLabel: "مفتاح API للمجموعة",
    rgApiKeyHint: "استخدم هذا المفتاح مع الوكيل ليعمل حصراً على هذه المجموعة",
    rgNoApiKey: "لا يوجد مفتاح لهذه المجموعة",
    rgTestOk: "يعمل",
    rgTestFail: "فشل",
    rgSaved: "تم حفظ المجموعة",
    rgDeleted: "تم حذف المجموعة",
    rgDeleteConfirm: "حذف هذه المجموعة؟",
    customKeysSectionTitle: "مفاتيح الوصول المعتمدة",
    customKeysSectionDesc: "تُقبل في ترويسات Authorization: Bearer و x-api-key و x-goog-api-key",
    thKeyName: "اسم المفتاح",
    thKeySecret: "المفتاح السري",
    thCreated: "تاريخ الإنشاء",
    thKeyStatus: "الحالة",
    customProvidersSectionTitle: "المزوّدات المخصصة",
    customProvidersSectionDesc: "ربط خدمات OpenAI-compatible مثل Ollama و DeepSeek و OpenRouter و Groq",
    modalAddKeyTitle: "إنشاء مفتاح API جديد",
    labelKeyName: "اسم المفتاح",
    phKeyName: "مثال: Cursor-Work أو ClaudeCode-Key",
    labelKeySecret: "المفتاح السري (اتركه فارغاً للتوليد التلقائي)",
    btnGenerateRandom: "توليد عشوائي",
    btnCancel: "إلغاء",
    btnSaveKey: "حفظ المفتاح",
    modalAddCpTitle: "إضافة مزود API مخصص",
    modalEditCpTitle: "إعدادات المزود: ",
    labelCpName: "اسم المزود",
    phCpName: "DeepSeek / Ollama / OpenRouter",
    labelCpUrl: "رابط نقطة النهاية (Base URL)",
    phCpUrl: "https://api.deepseek.com/v1 أو http://localhost:11434/v1",
    labelCpKey: "مفتاح API",
    toggleKeyVisibility: "إظهار / إخفاء المفتاح",
    btnFetchModelsAuto: "جلب النماذج",
    labelCpModelsManagement: "النماذج",
    cpFetchHint: "اجلب النماذج من الخادم أو أضفها يدوياً",
    labelCpModelsListSelect: "النماذج المتوفرة:",
    btnSelectAll: "تحديد الكل",
    btnDeselectAll: "إلغاء الكل",
    phCpManualSingle: "اسم النموذج (مثال: deepseek-reasoner)",
    btnAddManualModel: "+ إضافة",
    labelCpApprovedModels: "قائمة النماذج المعتمدة:",
    phCpModels: "deepseek-chat, deepseek-reasoner",
    btnSaveCustomProv: "إضافة المزود",
    modalAddAccTitle: "إضافة حساب جديد",
    labelSelectProvider: "المزود",
    labelAccountName: "اسم الحساب (اختياري)",
    phAccountName: "مثال: حساب العمل أو الحساب الشخصي",
    labelAccountEmail: "البريد الإلكتروني",
    btnSaveAccount: "حفظ الحساب",
    modalAccountDetailTitle: "تفاصيل الحساب",
    labelProvider: "المزود:",
    labelName: "الاسم:",
    labelEmail: "البريد:",
    labelLoginState: "حالة الدخول:",
    labelProfilePath: "مسار الملف الشخصي:",
    btnDelete: "حذف",
    btnSetAsActive: "تعيين كنشط",
    btnLogin: "تسجيل الدخول",
    toastCopiedBaseUrl: "تم نسخ Base URL",
    toastCopiedApiKey: "تم نسخ مفتاح API",
    toastSettingsCopied: "تم نسخ الإعدادات",
    toastCopied: "تم النسخ: ",
    toastFlowPulse: "تم فحص حالة مسارات الربط الحالية",
    toastServiceResumed: "تم تشغيل خدمة البوابة",
    toastServicePaused: "تم إيقاف خدمة البوابة مؤقتاً",
    toastServiceToggleFailed: "تعذر تغيير حالة الخدمة: ",
    toastLogCleared: "تم مسح سجل الطلبات",
    toastLogClearFailed: "تعذر مسح السجل: ",
    toastKeyCreated: "تم إنشاء مفتاح API الجديد",
    toastKeyDeleted: "تم حذف المفتاح",
    toastKeyActivated: "تم تفعيل المفتاح",
    toastKeyDeactivated: "تم تعطيل المفتاح",
    toastKeyCopied: "تم نسخ المفتاح",
    toastAccountAdded: "تمت إضافة الحساب",
    toastAccountDeleted: "تم حذف الحساب: ",
    toastAccountActivated: "تم تفعيل الحساب",
    statusRunning: "يعمل",
    statusStarting: "جارٍ البدء...",
    statusStopped: "متوقف",
    statusError: "خطأ",
    statusActive: "مفعل",
    statusDisabled: "معطل",
    statusLoggedIn: "مسجل الدخول",
    statusNotLoggedIn: "غير مسجل",
    statusActiveAccountBadge: "نشط",
    statusDormantAccountBadge: "احتياطي",
    statusDefaultKey: "المفتاح الافتراضي",
    statusSystemMasterKey: "مفتاح النظام",
    btnManage: "إدارة",
    btnActivate: "تفعيل",
    btnDeactivate: "تعطيل",
    btnEnable: "تفعيل",
    btnDisable: "تعطيل",
    btnStart: "تشغيل",
    btnStop: "إيقاف",
    btnSaveModels: "حفظ",
    btnRefreshModels: "تحديث النماذج",
    btnFetchModelsLive: "جلب النماذج",
    btnLoadCatalog: "إعادة تحميل القائمة",
    btnDiscoveryUnsupported: "غير مدعوم",
    btnTestConnection: "فحص الاتصال",
    btnTestConnectionUnsupported: "فحص الاتصال غير مدعوم",
    btnWorking: "جارٍ التنفيذ…",
    notifCenterTitle: "تغييرات النماذج",
    notifCenterSub: "تُبلّغ هنا كل التغييرات التي يكتشفها الفحص الحيّ",
    notifMarkAll: "تعليم الكل كمقروء",
    notifMarkRead: "تعليم كمقروء",
    notifEmpty: "لا توجد تغييرات في النماذج بعد.",
    notifUnread: "{count} غير مقروء",
    notifOpenCard: "فتح بطاقة المزوّد",
    notifDetectedAt: "وقت الاكتشاف: {ts}",
    notifSourceLabel: "المصدر",
    notifCardNotFound: "بطاقة المزوّد غير ظاهرة في الصفحة الحالية.",
    notifTypeModelAdded: "تم اكتشاف نموذج جديد",
    notifTypeModelRemoved: "تمت إزالة نموذج",
    notifTypeModelRenamed: "تغيّر اسم النموذج",
    notifTypeModelMetadata: "تغيّرت بيانات النموذج",
    notifTypeModelRestored: "عاد نموذج محذوف سابقًا",
    discoveryNeverScanned: "الاكتشاف الحيّ: لم يُفحص بعد",
    discoveryActive: "الاكتشاف الحيّ: يعمل",
    discoveryUnsupported: "الاكتشاف الحيّ: غير مدعوم",
    discoveryNeedsLogin: "الاكتشاف الحيّ: يلزم تسجيل الدخول",
    discoveryDeferred: "الاكتشاف الحيّ: مؤجّل",
    discoveryError: "الاكتشاف الحيّ: خطأ",
    discoveryModelsFound: "{count} نموذج مكتشف",
    discoveryNewModels: "+{count} جديد",
    discoveryLastScan: "آخر فحص ناجح: {ts}",
    modelsSourceLiveWebUi: "اكتشاف حيّ من موقع المزوّد",
    btnDiscoverModels: "اكتشاف النماذج",
    btnDiscoverModelsHint: "يقرأ قائمة النماذج من موقع المزوّد مباشرة",
    btnCheckChanges: "فحص التغييرات",
    btnViewChanges: "عرض التغييرات",
    toastDiscoveryDone: "تم اكتشاف {count} نموذج ({newCount} جديد)",
    toastDiscoveryChanges: "{count} تغيير في النماذج",
    toastDiscoveryFailed: "فشل الاكتشاف: {error}",
    toastDiscoveryDeferred: "أُجّل الاكتشاف: {reason}",
    toastNoChanges: "لا توجد تغييرات في النماذج.",
    modelsSourceLabel: "المصدر",
    modelsSourceConfiguredCatalog: "قائمة مُهيّأة — ليست اكتشافًا حيًّا",
    modelsSourceLiveApi: "اكتشاف حي عبر نقطة /models",
    modelsSourceNone: "لا يوجد مصدر",
    modelsLastRefreshAt: "آخر مزامنة: {ts}",
    modelsNeverRefreshed: "لم تتم المزامنة بعد",
    modelsStaleBadge: "غير متاح",
    modelsDiscoveryUnsupportedNote: "هذا المزوّد لا يدعم جلب النماذج — الزر معطّل.",
    modelsCatalogNotLiveNote: "القائمة مُهيّأة داخل المحوّل وليست اكتشافًا حيًّا من موقع المزوّد.",
    connStatusLabel: "الاتصال",
    connStatusConnected: "متصل",
    connStatusAuthenticationRequired: "يلزم تسجيل الدخول",
    connStatusRateLimited: "محدود المعدل",
    connStatusQuotaExhausted: "نفدت الحصة",
    connStatusProviderUnavailable: "المزوّد غير متاح",
    connStatusBrowserUnavailable: "المتصفح غير متاح",
    connStatusTimeout: "انتهت المهلة",
    connStatusUnsupported: "غير مدعوم",
    connStatusUnknown: "غير معروف",
    connStatusNeverChecked: "لم يُفحص بعد",
    connLastCheckAt: "آخر فحص: {ts}",
    connCheckWebProfile: "يفحص وصول موقع المزوّد وتوفّر المتصفح وجود جلسة محفوظة",
    connCheckApiHealth: "يفحص نقطة الفحص/النماذج في المزوّد (بدون طلب مدفوع)",
    connTestUnsupportedNote: "لا يتوفر فحص اتصال حقيقي لهذا النوع من المزوّدات.",
    toastModelsRefreshedCount: "تم تحديث {count} نموذج ({source})",
    toastModelsRefreshFailed: "فشل تحديث النماذج: {error}",
    toastModelsPruned: "تمت إزالة {count} نموذج محدَّد لم يعد متاحًا",
    toastConnectionResult: "فحص الاتصال: {status} ({ms}ms)",
    toastConnectionFailed: "فشل فحص الاتصال: {error}",
    btnCheckPing: "فحص الاتصال",
    btnOpenBrowser: "تسجيل الدخول",
    toggleHeadlessLabel: "وضع خفي",
    togglePrivacyLabel: "وضع الخصوصية",
    filterShowAll: "الكل",
    filterShowEnabled: "المفعّلة",
    filterProvidersHeader: "تصفية المزوّدات",
    filterProvidersSub: "اختر مزوداً أو أكثر للعرض",
    filterShownCountAll: "الكل",
    filterClear: "إلغاء التصفية",
    filterAccountsAll: "الكل",
    noAccountsFound: "لا توجد حسابات مضافة بعد.",
    noCustomProvidersFound: "لا توجد مزودات مخصصة مضافة بعد.",
    agentActive: "نشط",
    agentInstalled: "مثبت",
    agentGuide: "دليل",
    availableModelsCount: "النماذج المتاحة",
    registeredAccounts: "الحسابات:",
    noAccountsRegistered: "لا توجد حسابات مضافة",
    activeAccountPill: "(نشط)",
    addAccountBtnShort: "+ حساب",
    unnamedAccount: "حساب بدون اسم",
    customSettingsBtn: "الإعدادات",
    customEditKeyModels: "الإعدادات",
    customApiKeySaved: "مفتاح API محفوظ",
    customNoApiKey: "بدون مفتاح API",
    activeModelsListLabel: "النماذج المفعلة",
    typeStream: "بث",
    typeSync: "عادي",
    unknownClient: "غير محدد",
    pathLabel: "المسار:",
    editorReady: "جاهز للربط مع البوابة",
    filterPillTitle: "عرض أو إخفاء {name}",
    filterShownCount: "{shown} من {total}",
    chipSwitchTitle: "تفعيل هذا الحساب",
    chipDeleteTitle: "حذف هذا الحساب",
    agentPortTitle: "منفذ اتصال الوكيل",
    headlessHint: "تشغيل المتصفح في الخلفية بدون نافذة مرئية",
    privacyHint: "تفعيل المحادثات المؤقتة لمنع حفظ السجل لدى المزود",
    privacyModeNote: "الوضع الخاص = محادثة مؤقتة: الأدوات وتوليد الصور والميزات الخاصة لا تعمل فيه، ولن يُحفَظ السجل لدى المزود.",
    privacyModeNoteGeneric: "الوضع الخاص: لن يُحفَظ سجل المحادثة لدى المزود، وقد لا تعمل بعض الأدوات أو الميزات الخاصة فيه.",
    pingHint: "فحص الاتصال وسرعة الاستجابة",
    btnAllShort: "الكل",
    btnNoneShort: "إلغاء",
    noModelsYet: "لا توجد نماذج متاحة بعد.",
    toastHeadlessEnabled: "تم تفعيل الوضع الخفي لـ {id}",
    toastHeadlessDisabled: "تم إيقاف الوضع الخفي لـ {id}",
    toastPrivacyEnabled: "تم تفعيل وضع الخصوصية لـ {id}",
    toastPrivacyDisabled: "تم إيقاف وضع الخصوصية لـ {id}",
    toastAccSwitched: "تم التبديل إلى الحساب المحدد",
    toastProviderStarted: "تم تشغيل {id}",
    toastProviderStopped: "تم إيقاف {id}",
    toastModelsSaved: "تم حفظ النماذج لـ {id}",
    toastModelsRefreshed: "تم تحديث قائمة النماذج",
    toastBrowserOpening: "جارٍ فتح نافذة تسجيل الدخول...",
    toastLoginComplete: "اكتمل تسجيل الدخول",
    toastProviderEnabled: "تم تفعيل المزود",
    toastProviderDisabled: "تم تعطيل المزود",
    snipEnvSetup: "# 1. إعداد عنوان البوابة ومفتاح الوصول في الطرفية:",
    snipRunClaude: "# 2. تشغيل Claude Code مباشرة عبر البوابة المحلية:",
    snipCursorModels: "// في إعدادات {name} > Models > OpenAI API:",
    snipVsCode: "// في إعدادات VS Code (ملف settings.json أو إضافات Cline / Continue):",
    snipPythonOpenAI: "# بايثون مع بروتوكول OpenAI Standard:",
    snipPythonAnthropic: "# أو باستخدام مكتبة Anthropic SDK الرسمية مباشرة:",
    snipPythonHello: "مرحباً من كود بايثون!",
    snipHello: "مرحباً",
    snipGeminiSetup: "# إعداد بروتوكول Gemini الأصلي (/v1beta):",
    snipGeminiCurl: "# أو عبر cURL مع رأس x-goog-api-key:",
    snipGeminiHello: "مرحباً!",
    snipHermesSetup: "# إعداد Hermes Agent للاتصال بالبوابة المحلية:",
    snipCallAgent: "# استدعِ الوكيل مباشرة:",
    snipEnvVarsAlt: "# أو عبر متغيرات البيئة:",
    snipThenRun: "# ثم شغّل:",
    defaultKeyCreatedAt: "افتراضي",
    cpNoModelsYet: "لا توجد نماذج محددة — افتح الإعدادات لجلب النماذج أو إضافتها",
    cpVerifyHint: "فحص الاتصال وصلاحية مفتاح API مع الخادم",
    cpVerifyBtn: "التحقق من الاتصال",
    cpSettingsHint: "إعدادات المزود",
    keyNameRequired: "يرجى إدخال اسم المفتاح",
    cpVerifying: "جارٍ التحقق...",
    verifyServerOk: "الاتصال بالخادم ناجح",
    verifyServerFailed: "فشل الاتصال بالخادم",
    cpVerifyLoading: "جارٍ فحص الاتصال بالخادم...",
    verifyOk: "الاتصال ناجح",
    verifyFail: "فشل الاتصال",
    baseUrlRequiredVerify: "يرجى إدخال رابط Base URL أولاً",
    cpVerifyChecking: "جارٍ فحص الاتصال بالخادم...",
    cpVerifyCheckingShort: "جارٍ الفحص...",
    cpFetchedDuringVerify: "تم جلب {count} نموذج من الخادم",
    verifyCheckFailed: "فشل التحقق من الاتصال",
    baseUrlRequired: "يرجى إدخال رابط Base URL أولاً",
    cpFetchingBanner: "جارٍ جلب النماذج من الخادم...",
    cpFetchingLive: "جارٍ جلب النماذج...",
    cpFetchingShort: "جارٍ الجلب...",
    cpFetchedReal: "تم جلب {count} نموذج من الخادم",
    cpFetchFailed: "تعذر جلب النماذج من الخادم",
    btnFetchReal: "جلب النماذج",
    sourceServer: "",
    sourceManual: "",
    modelNameRequired: "أدخل اسم النموذج لإضافته",
    manualModelAdded: "تمت إضافة النموذج ({count})",
    cpSaveSettings: "حفظ الإعدادات",
    cpVerifyFetchHint: "اجلب النماذج من الخادم أو أضفها يدوياً",
    nameUrlRequired: "اسم المزود ورابط Base URL مطلوبان",
    cpSavedSettings: "تم حفظ إعدادات المزود ({count} نموذج مفعل)",
    cpAddedSuccess: "تمت إضافة المزود ({count} نموذج مفعل)",
    toastProviderDeleted: "تم حذف المزود",
    emailRequired: "البريد الإلكتروني مطلوب",
    manageAccountTitle: "إدارة الحساب: {name}",
    noNameLabel: "بدون اسم",
    defaultAccountName: "الحساب الافتراضي",
    activeBrowserSession: "جلسة متصفح نشطة",
    accountActiveNow: "الحساب نشط حالياً",
    toastLoginWindow: "جارٍ فتح نافذة تسجيل الدخول...",
    toastLoginDone: "اكتمل تسجيل الدخول",
    toastAccountDeletedShort: "تم حذف الحساب",
        btnSave: "حفظ",
    topoStreamSse: "بث SSE",
    topoNormal: "عادي",
    customModelsPart: "نماذج مخصصة",
    tokenUnit: "رمز",
    phRgName: "مثال: A",
    mcpAgentLabel: "الوكيل / المحرر",
    mcpTargetAuto: "تلقائي (حسب الوكيل)",
    mcpFixedServerName: "اسم الخادم ثابت:",
    mcpSectionDesc: "يعرض هذا القسم جميع الوكلاء والمحررات المتاحة في القائمة. اختر الوكيل والنموذج ليتم تضمينهما في إعداد MCP الناتج.",
    swarmSubtitle: "تنفيذ المهام عبر أدوار وكلاء محددة وتوليف النتائج، مع إدارة مجموعات توجيه النماذج.",
    btnRunTask: "تشغيل مهمة",
    swarmRolesTitle: "أدوار التنفيذ",
    swarmRolesSubtitle: "توزيع العمل حسب الاختصاص",
    swarmRoleArchitect: "المهندس المعماري",
    swarmRoleArchitectDesc: "تفكيك الهدف وتحديد البنية والخطوات.",
    swarmModelLabel: "مجموعة الراوتر لهذا الدور",
    swarmModelAuto: "تلقائي ذكي (auto)",
    swarmNoGroupsOption: "أنشئ مجموعة راوتر أولاً",
    swarmNeedGroup: "يجب إنشاء واختيار مجموعة راوتر للأدوار أولاً",
    swarmRoleCoder: "مهندس التنفيذ",
    swarmRoleCoderDesc: "تنفيذ التغييرات والكتابة البرمجية.",
    swarmRoleReviewer: "المراجع",
    swarmRoleReviewerDesc: "مراجعة الجودة والمخاطر والملاحظات.",
    swarmRoleTester: "مهندس الاختبارات",
    swarmRoleTesterDesc: "اقتراح حالات الاختبار والتحقق.",
    swarmExecTitle: "تنفيذ مهمة",
    swarmExecSubtitle: "إرسال تعليمات النظام إلى منسق الوكلاء",
    swarmGoalLabel: "تعليمات النظام",
    swarmGoalPlaceholder: "اكتب تعليمات النظام التي سيعمل وفقها جميع الوكلاء (السياق، القيود، أسلوب التنفيذ...)",
    swarmModeLabel: "نمط التشغيل",
    swarmModeAuto: "تلقائي (تسلسلي + متوازي)",
    swarmModePipeline: "تسلسلي",
    swarmModeParallel: "متوازي",
    btnExecute: "تشغيل",
    swarmModelLabel: "مجموعة الراوتر لهذا الدور",
    swarmModelAuto: "تلقائي ذكي (auto)",
    swarmGoalRequired: "يرجى كتابة تعليمات النظام أولاً",
    swarmExecuting: "جارٍ التنفيذ...",
    swarmDispatching: "جارٍ تنسيق المهمة وتوزيعها على الوكلاء...",
    swarmConnFailed: "فشل الاتصال بالخادم",
    langOptAr: "العربية (AR)",
    langOptEn: "English (EN)",
    langOptFr: "Français (FR)",
    langOptRu: "Русский (RU)",
    langOptEs: "Español (ES)",
    langOptZh: "中文 (ZH)",
    pulseLatency: "14ms"
  },
  en: {
    documentTitle: "EMO-AI Gateway — Dashboard",
    serviceToggleTitle: "Start or stop accepting requests on the gateway",
    clearLogHint: "Clear the displayed request log",
    baseUrlLabel: "Base URL:",
    apiKeyLabel: "API Key:",
    metricPromptShort: "Prompt:",
    metricComplShort: "| Compl:",
    labelOpenAiBaseUrl: "OpenAI Base URL (/v1)",
    labelAnthropicBaseUrl: "Anthropic Base URL (Claude Code)",
    labelGeminiBaseUrl: "Gemini Base URL (Gemini CLI)",
    labelDefaultApiKey: "Default API Key",
    topoWrapperAria: "Live connection topology: press Tab to move between nodes and highlight the flow paths",
    hubAriaLabel: "EMO-AI Gateway Core — multi-protocol central gateway",
    engineDesc: "",
    navOverview: "Dashboard",
    navUsage: "Request Log",
    navConnect: "Agent & IDE Connect",
    navProviders: "Providers & Models",
    navAccounts: "Accounts",
    navRouter: "Router Groups",
    navKeys: "API Keys & Providers",
    navSwarm: "Swarm Coordinator",
    sidebarToggleCollapse: "Collapse Sidebar",
    sidebarToggleExpand: "Expand Sidebar",
    langLabel: "Language",
    themeToggleTitle: "Toggle Theme (Dark / Light)",
    darkMode: "Dark Mode",
    lightMode: "Light Mode",
    settingsTitle: "Settings",
    settingsClose: "Close",
    appearanceLabel: "Appearance",
    langAndAppearance: "Language & Appearance",
    appUpdateLabel: "App Update",
    currentVersionLabel: "Current version",
    checkUpdateBtn: "Check for updates",
    connectionsLabel: "Connections",
    mcpConnection: "Agent Connection",
    toastCheckingUpdate: "Checking for updates...",
    toastAppUpToDate: "App is up to date ({version})",
    settingsPageSubtitle: "Manage language, appearance, app information, and agent connections",
    aboutAppLabel: "About App",
    latestVersionLabel: "Latest version",
    agentConnectionSection: "Agent Connections",
    agentConnectionSettingsDesc: "Manage agent connections including automatic, manual, and MCP setup.",
    openAgentConnectionBtn: "Agent Connection Settings",
    connectTabAuto: "Automatic",
    connectTabManual: "Manual",
    connectTabMcp: "MCP",
    mcpSetupTitle: "MCP Setup & Configuration",
    mcpSetupDesc: "Create MCP configuration for the selected agent, choose the integration target, then copy the generated config.",
    mcpTargetLabel: "MCP Target",
    mcpServerNameLabel: "MCP Server Name",
    mcpConfigTitle: "Generated MCP Configuration",
    mcpCopyConfig: "Copy MCP Config",
    mcpHintAgent: "Select an agent and model above to include them in the MCP configuration.",
    manualConfigTitle: "Manual Configuration (Snippet)",
    autoConfigSectionTitle: "Automatic Agent Connection",
    identifierLabel: "ID:",
    endpointLabel: "Endpoint:",
    gatewayConnected: "Gateway Online",
    gatewayDisconnected: "Disconnected",
    overviewTitle: "Dashboard",
    overviewSubtitle: "Gateway status, active routing topology, and live performance metrics",
    serviceRunning: "Service Active",
    serviceStopped: "Service Paused",
    btnStopService: "Stop Service",
    btnStartService: "Resume Service",
    btnQuickRefresh: "Refresh",
    btnQuickRefreshTitle: "Refresh data now",
    btnRefreshing: "Refreshing…",
    toastRefreshed: "Data refreshed",
    toastRefreshFailed: "Could not refresh data",
    btnCopy: "Copy",
    copied: "Copied",
    metricUptime: "Uptime",
    metricLive: "Live",
    metricSinceStart: "Since service start",
    metricTotalTokens: "Estimated Tokens",
    metricSuccessRate: "Success Rate",
    metricCompletedOfPart: "completed of",
    metricRequestsPart: "requests",
    metricActiveProviders: "Active Providers",
    metricActiveModelsPart: "enabled models",
    topoLiveFlow: "Connection Topology",
    topoLivePulse: "Online",
    topoFlowStopped: "Paused",
    topoAutoSync: "Auto-refresh every 3s",
    topoInboundChannels: "inbound channels",
    topoActiveProviders: "active providers",
    topoPrivacyPath: "Privacy Mode",
    topoPulseBtn: "Test Routes",
    topoPulsing: "Testing...",
    topoAgentsTitle: "Agents & Coding IDEs",
    topoAgentsScanning: "Scanning installed tools...",
    topoHubTitle: "Central Gateway",
    topoHubPortIn: "Inbound Receiver Port",
    topoHubPortOut: "Upstream Outbound Port",
    topoHubUptime: "Gateway uptime",
    topoHubReqRate: "Request rate (per minute)",
    topoHubReqRateUnit: "/m",
    topoHubLatency: "Response latency",
    topoProvidersTitle: "Active Providers",
    topoProvidersLoading: "Loading active providers...",
    topoNoActiveProviders: "No active providers",
    topoLiveNow: "Live now",
    topoRecent: "Recent",
    topoStandby: "Standby",
    topoInFlight: "Processing",
    topoRouteTo: "Route",
    topoLiveRequests: "Flowing Requests",
    topoServing: "Serving",
    topoNoLiveAgents: "No active channels — run a request through an agent to see the live flow node",
    requestInFlight: "In flight…",
    topoCustom: "Custom",
    topoNoLiveProvs: "No provider has a request in flight right now — a provider appears here only while it is actually serving one",
    topoWaitingRequests: "Waiting for Request Flow",
    topoWaitingRequestsSub: "Developer tools and agents appear here in real time when requests are sent",
    topoWaitingProvs: "Waiting for Upstream Providers",
    topoWaitingProvsSub: "The provider serving the request appears here in real time during processing",
    topoLastProv: "Last provider",
    topoInteractionHint: "Hover over any node to highlight its connection routes",
    topoLegendFlow: "Standard Flow",
    topoLegendPrivacy: "Privacy Route",
    topoLegendDormant: "Standby Route",
    quickModelsTitle: "Enabled Models",
    quickModelsSubtitle: "Click any model name to copy it",
    quickModelsEmpty: "No models enabled currently. Select models from the Providers tab and save.",
    consumptionTitle: "Request & Usage Log",
    consumptionSubtitle: "Inbound requests, response latency, and token consumption",
    btnClearLog: "Clear Log",
    metricPromptChars: "Prompt Characters",
    metricComplChars: "Completion Characters",
    metricStreamReq: "Streaming Requests",
    metricLifetimeReq: "Total Requests",
    thTimestamp: "Time",
    thAgent: "Agent",
    thModel: "Model",
    thType: "Type",
    thTokens: "Tokens",
    thLatency: "Latency",
    thStatus: "Status",
    noRequestsRecorded: "No requests recorded yet.",
    connectTitle: "Agent Connection",
    connectSubtitle: "Manage agent connections with automatic, manual, and MCP setup, including agent selection.",
    localAgentsListTitle: "Local Agents & IDEs",
    installedOnDevice: "Installed",
    setupGuide: "Setup Guide",
    selectSnippetModelLabel: "Default Model:",
    copyCodeBtn: "Copy Code",
    btnRescanAgents: "Rescan Agents",
    btnAddCustomAgent: "+ Add Agent",
    autoConnectTitle: "Auto-Configuration",
    autoConnectDesc: "Update this tool's configuration file automatically (.bak backup saved)",
    btnAutoConnect: "Apply Config",
    btnDeleteCustomAgent: "Delete Agent",
    modalAddCustomAgentTitle: "Add Custom Agent",
    labelAgentName: "Agent Name",
    phAgentName: "e.g. Pi Agent",
    labelAgentId: "Agent ID",
    phAgentId: "my-agent",
    labelAgentProtocol: "Connection Protocol",
    labelAgentIcon: "Icon",
    phAgentIcon: "AG",
    labelAgentCommand: "Command or Path",
    phAgentCommand: "my-agent or /path/to/agent",
    labelAgentConfigPath: "Config File Path",
    phAgentConfigPath: "~/.config/my-agent/config.json",
    labelAgentNotes: "Notes (optional)",
    phAgentNotes: "Additional instructions",
    btnSaveCustomAgent: "Save Agent",
    agentCustom: "Custom",
    agentConfigured: "Configured",
    scanningAgents: "Scanning...",
    scanningAgentsToast: "Scanning device for agents and editors...",
    agentsScanDone: "Found {count} installed agent(s)",
    autoConnecting: "Applying...",
    autoConnectSuccess: "Configuration applied successfully",
    autoConnectFailed: "Auto-configuration failed",
    agentNotInstalledMsg: "This agent is not installed on your device — install it first and try again",
    noAgentSelected: "Please select an agent first",
    agentNameRequired: "Agent name is required",
    agentSaved: "Custom agent saved",
    agentDeleted: "Custom agent deleted",
    notCustomAgent: "This agent is not custom",
    confirmDeleteAgent: "Are you sure you want to delete agent {name}?",
    providersTitle: "Providers & Models",
    providersSubtitle: "Start providers, select enabled models, and manage sessions",
    accountsTitle: "Account Management",
    accountsSubtitle: "Add and switch accounts across providers",
    btnAddAccount: "+ Add Account",
    thProvider: "Provider",
    thAccountName: "Account Name",
    thEmail: "Email",
    thLoginStatus: "Login Status",
    thActiveStatus: "Status",
    thActions: "Actions",
    keysTitle: "API Keys & Custom Providers",
    keysSubtitle: "Manage gateway access keys and connect external API providers",
    btnAddCustomKey: "+ New API Key",
    btnAddCustomProvider: "+ Add Provider",
    routerTitle: "Router Groups",
    routerSubtitle: "Group models from different providers and accounts under one name with failover or round-robin",
    routerHint: "The group name becomes the model name clients send. sequential tries targets in order on failure; round-robin distributes requests.",
    btnAddRouterGroup: "+ New Group",
    rgModalCreateTitle: "Create Router Group",
    rgModalEditTitle: "Edit Group",
    rgNameLabel: "Group name (model name)",
    rgIconLabel: "Icon",
    rgStrategyLabel: "Strategy",
    rgStrategySeq: "Sequential (failover)",
    rgStrategyRR: "Round-robin",
    rgTargetsLabel: "Targets (order = priority)",
    rgAddTarget: "+ Add target",
    rgTargetsHint: "Pinning an account switches the provider's active profile when needed. Avoid different accounts of the same provider in round-robin.",
    rgNoGroups: "No groups yet. Create one to bundle your favorite models.",
    rgTargetProvider: "Provider",
    rgTargetModel: "Model",
    rgTargetAccount: "Account",
    rgAccountActive: "Active account (default)",
    rgBtnTest: "Test",
    rgBtnEdit: "Edit",
    rgBtnDelete: "Delete",
    rgEnabled: "Enabled",
    rgDisabled: "Disabled",
    rgApiKeyLabel: "Group API key",
    rgApiKeyHint: "Use this key with an agent to route only to this group",
    rgNoApiKey: "No API key for this group",
    rgTestOk: "OK",
    rgTestFail: "Failed",
    rgSaved: "Group saved",
    rgDeleted: "Group deleted",
    rgDeleteConfirm: "Delete this group?",
    customKeysSectionTitle: "Authorized Access Keys",
    customKeysSectionDesc: "Accepted in Authorization: Bearer, x-api-key, and x-goog-api-key headers",
    thKeyName: "Key Name",
    thKeySecret: "Secret Key",
    thCreated: "Created",
    thKeyStatus: "Status",
    customProvidersSectionTitle: "Custom Providers",
    customProvidersSectionDesc: "Connect OpenAI-compatible services such as Ollama, DeepSeek, OpenRouter, and Groq",
    modalAddKeyTitle: "Create New API Key",
    labelKeyName: "Key Name",
    phKeyName: "e.g. Cursor-Work or ClaudeCode-Key",
    labelKeySecret: "Secret Key (Leave blank to auto-generate)",
    btnGenerateRandom: "Generate",
    btnCancel: "Cancel",
    btnSaveKey: "Save Key",
    modalAddCpTitle: "Add Custom API Provider",
    modalEditCpTitle: "Provider Settings: ",
    labelCpName: "Provider Name",
    phCpName: "DeepSeek / Ollama / OpenRouter",
    labelCpUrl: "Endpoint Base URL",
    phCpUrl: "https://api.deepseek.com/v1 or http://localhost:11434/v1",
    labelCpKey: "API Key",
    toggleKeyVisibility: "Show / Hide Key",
    btnFetchModelsAuto: "Fetch Models",
    labelCpModelsManagement: "Models",
    cpFetchHint: "Fetch models from the server or add them manually",
    labelCpModelsListSelect: "Available models:",
    btnSelectAll: "Select All",
    btnDeselectAll: "Deselect All",
    phCpManualSingle: "Model name (e.g. deepseek-reasoner)",
    btnAddManualModel: "+ Add",
    labelCpApprovedModels: "Approved models:",
    phCpModels: "deepseek-chat, deepseek-reasoner",
    btnSaveCustomProv: "Add Provider",
    modalAddAccTitle: "Add New Account",
    labelSelectProvider: "Provider",
    labelAccountName: "Account Name (Optional)",
    phAccountName: "e.g. Work or Personal",
    labelAccountEmail: "Email",
    btnSaveAccount: "Save Account",
    modalAccountDetailTitle: "Account Details",
    labelProvider: "Provider:",
    labelName: "Name:",
    labelEmail: "Email:",
    labelLoginState: "Login Status:",
    labelProfilePath: "Profile Path:",
    btnDelete: "Delete",
    btnSetAsActive: "Set as Active",
    btnLogin: "Sign In",
    toastCopiedBaseUrl: "Base URL copied",
    toastCopiedApiKey: "API Key copied",
    toastSettingsCopied: "Configuration copied",
    toastCopied: "Copied: ",
    toastFlowPulse: "Current connection routes checked",
    toastServiceResumed: "Gateway service resumed",
    toastServicePaused: "Gateway service paused",
    toastServiceToggleFailed: "Failed to toggle service: ",
    toastLogCleared: "Request log cleared",
    toastLogClearFailed: "Failed to clear log: ",
    toastKeyCreated: "API key created",
    toastKeyDeleted: "API key deleted",
    toastKeyActivated: "Key enabled",
    toastKeyDeactivated: "Key disabled",
    toastKeyCopied: "Key copied",
    toastAccountAdded: "Account added",
    toastAccountDeleted: "Account deleted: ",
    toastAccountActivated: "Account activated",
    statusRunning: "Running",
    statusStarting: "Starting...",
    statusStopped: "Stopped",
    statusError: "Error",
    statusActive: "Active",
    statusDisabled: "Disabled",
    statusLoggedIn: "Logged In",
    statusNotLoggedIn: "Not Logged In",
    statusActiveAccountBadge: "Active",
    statusDormantAccountBadge: "Standby",
    statusDefaultKey: "Default Key",
    statusSystemMasterKey: "System Key",
    btnManage: "Manage",
    btnActivate: "Activate",
    btnDeactivate: "Deactivate",
    btnEnable: "Enable",
    btnDisable: "Disable",
    btnStart: "Start",
    btnStop: "Stop",
    btnSaveModels: "Save",
    btnRefreshModels: "Refresh Models",
    btnFetchModelsLive: "Fetch Models",
    btnLoadCatalog: "Reload catalog",
    btnDiscoveryUnsupported: "Unsupported",
    btnTestConnection: "Test Connection",
    btnTestConnectionUnsupported: "Connection test unsupported",
    btnWorking: "Working…",
    notifCenterTitle: "Model changes",
    notifCenterSub: "Every change found by the live discovery scan is reported here",
    notifMarkAll: "Mark all read",
    notifMarkRead: "Mark read",
    notifEmpty: "No model changes yet.",
    notifUnread: "{count} unread",
    notifOpenCard: "Open provider card",
    notifDetectedAt: "Detected at: {ts}",
    notifSourceLabel: "Source",
    notifCardNotFound: "The provider card is not visible on the current page.",
    notifTypeModelAdded: "New model detected",
    notifTypeModelRemoved: "Model removed",
    notifTypeModelRenamed: "Model renamed",
    notifTypeModelMetadata: "Model metadata changed",
    notifTypeModelRestored: "Previously removed model restored",
    discoveryNeverScanned: "Live discovery: never scanned",
    discoveryActive: "Live discovery: active",
    discoveryUnsupported: "Live discovery: unsupported",
    discoveryNeedsLogin: "Live discovery: sign-in required",
    discoveryDeferred: "Live discovery: deferred",
    discoveryError: "Live discovery: error",
    discoveryModelsFound: "{count} models discovered",
    discoveryNewModels: "+{count} new",
    discoveryLastScan: "Last successful scan: {ts}",
    modelsSourceLiveWebUi: "Live discovery from the provider's own website",
    btnDiscoverModels: "Discover Models",
    btnDiscoverModelsHint: "Reads the model list from the provider's own website",
    btnCheckChanges: "Check for Changes",
    btnViewChanges: "View Changes",
    toastDiscoveryDone: "Discovered {count} model(s) ({newCount} new)",
    toastDiscoveryChanges: "{count} model change(s)",
    toastDiscoveryFailed: "Discovery failed: {error}",
    toastDiscoveryDeferred: "Discovery postponed: {reason}",
    toastNoChanges: "No model changes detected.",
    modelsSourceLabel: "Source",
    modelsSourceConfiguredCatalog: "Configured catalog — not live discovery",
    modelsSourceLiveApi: "Live discovery via the /models endpoint",
    modelsSourceNone: "No source",
    modelsLastRefreshAt: "Last synced: {ts}",
    modelsNeverRefreshed: "Never synced",
    modelsStaleBadge: "unavailable",
    modelsDiscoveryUnsupportedNote: "This provider does not support model discovery — the button is disabled.",
    modelsCatalogNotLiveNote: "The list is a catalog configured inside the gateway, not a live discovery from the provider site.",
    connStatusLabel: "Connection",
    connStatusConnected: "Connected",
    connStatusAuthenticationRequired: "Sign-in required",
    connStatusRateLimited: "Rate limited",
    connStatusQuotaExhausted: "Quota exhausted",
    connStatusProviderUnavailable: "Provider unavailable",
    connStatusBrowserUnavailable: "Browser unavailable",
    connStatusTimeout: "Timed out",
    connStatusUnsupported: "Unsupported",
    connStatusUnknown: "Unknown",
    connStatusNeverChecked: "Not checked yet",
    connLastCheckAt: "Last check: {ts}",
    connCheckWebProfile: "Checks provider site reachability, browser availability and the saved session",
    connCheckApiHealth: "Checks the provider health/models endpoint (no paid request)",
    connTestUnsupportedNote: "No real connection check is available for this provider type.",
    toastModelsRefreshedCount: "Updated {count} model(s) ({source})",
    toastModelsRefreshFailed: "Model refresh failed: {error}",
    toastModelsPruned: "Removed {count} selected model(s) that are no longer available",
    toastConnectionResult: "Connection check: {status} ({ms}ms)",
    toastConnectionFailed: "Connection check failed: {error}",
    btnCheckPing: "Test Connection",
    btnOpenBrowser: "Sign In",
    toggleHeadlessLabel: "Headless Mode",
    togglePrivacyLabel: "Privacy Mode",
    filterShowAll: "All",
    filterShowEnabled: "Enabled Providers",
    filterProvidersHeader: "Filter Providers",
    filterProvidersSub: "Select one or more providers to display, or use “All” or “Enabled Providers”",
    filterShownCountAll: "All",
    filterClear: "Clear Filter",
    filterAccountsAll: "All",
    noAccountsFound: "No accounts added yet.",
    noCustomProvidersFound: "No custom providers added yet.",
    agentActive: "Active",
    agentInstalled: "Installed",
    agentGuide: "Guide",
    availableModelsCount: "Available Models",
    registeredAccounts: "Accounts:",
    noAccountsRegistered: "No accounts added",
    activeAccountPill: "(Active)",
    addAccountBtnShort: "+ Account",
    unnamedAccount: "Unnamed Account",
    customSettingsBtn: "Settings",
    customEditKeyModels: "Settings",
    customApiKeySaved: "API Key Configured",
    customNoApiKey: "No API Key",
    activeModelsListLabel: "Enabled Models",
    typeStream: "Stream",
    typeSync: "Sync",
    unknownClient: "Unspecified",
    pathLabel: "Path:",
    editorReady: "Ready to connect through the gateway",
    filterPillTitle: "Show or hide {name}",
    filterShownCount: "{shown} of {total}",
    chipSwitchTitle: "Activate this account",
    chipDeleteTitle: "Delete this account",
    agentPortTitle: "Agent outbound port",
    headlessHint: "Run the browser in the background without a visible window",
    privacyHint: "Use ephemeral chats so history is not stored on provider servers",
    privacyModeNote: "Private mode = Temporary Chat: tools, image generation and special features do not work there, and no history is stored on the provider.",
    privacyModeNoteGeneric: "Private mode: conversation history is not stored on the provider, and some tools or special features may not work.",
    pingHint: "Test connection and response latency",
    btnAllShort: "All",
    btnNoneShort: "None",
    noModelsYet: "No models available yet.",
    toastHeadlessEnabled: "Headless mode enabled for {id}",
    toastHeadlessDisabled: "Headless mode disabled for {id}",
    toastPrivacyEnabled: "Privacy mode enabled for {id}",
    toastPrivacyDisabled: "Privacy mode disabled for {id}",
    toastAccSwitched: "Switched to selected account",
    toastProviderStarted: "Started {id}",
    toastProviderStopped: "Stopped {id}",
    toastModelsSaved: "Models saved for {id}",
    toastModelsRefreshed: "Model list updated",
    toastBrowserOpening: "Opening sign-in window...",
    toastLoginComplete: "Sign-in completed",
    toastProviderEnabled: "Provider enabled",
    toastProviderDisabled: "Provider disabled",
    snipEnvSetup: "# 1. Set the gateway URL and access key in your terminal:",
    snipRunClaude: "# 2. Launch Claude Code through the local gateway:",
    snipCursorModels: "// In {name} settings > Models > OpenAI API:",
    snipVsCode: "// In VS Code settings (settings.json or Cline / Continue extensions):",
    snipPythonOpenAI: "# Python with the OpenAI standard protocol:",
    snipPythonAnthropic: "# Or use the official Anthropic SDK directly:",
    snipPythonHello: "Hello from Python!",
    snipHello: "Hello",
    snipGeminiSetup: "# Configure the native Gemini protocol (/v1beta):",
    snipGeminiCurl: "# Or via cURL with the x-goog-api-key header:",
    snipGeminiHello: "Hello!",
    snipHermesSetup: "# Configure Hermes Agent to reach the local gateway:",
    snipCallAgent: "# Call the agent directly:",
    snipEnvVarsAlt: "# Or via environment variables:",
    snipThenRun: "# Then run:",
    defaultKeyCreatedAt: "Default",
    cpNoModelsYet: "No models selected — open Settings to fetch or add models",
    cpVerifyHint: "Test connection and API key against the server",
    cpVerifyBtn: "Verify Connection",
    cpSettingsHint: "Provider settings",
    keyNameRequired: "Please enter a key name",
    cpVerifying: "Verifying...",
    verifyServerOk: "Server connection successful",
    verifyServerFailed: "Server connection failed",
    cpVerifyLoading: "Testing connection to server...",
    verifyOk: "Connection successful",
    verifyFail: "Connection failed",
    baseUrlRequiredVerify: "Please enter the Base URL first",
    cpVerifyChecking: "Testing connection to server...",
    cpVerifyCheckingShort: "Testing...",
    cpFetchedDuringVerify: "Fetched {count} models from server",
    verifyCheckFailed: "Connection verification failed",
    baseUrlRequired: "Please enter the Base URL first",
    cpFetchingBanner: "Fetching models from server...",
    cpFetchingLive: "Fetching models...",
    cpFetchingShort: "Fetching...",
    cpFetchedReal: "Fetched {count} models from server",
    cpFetchFailed: "Could not fetch models from server",
    btnFetchReal: "Fetch Models",
    sourceServer: "",
    sourceManual: "",
    modelNameRequired: "Enter a model name to add it",
    manualModelAdded: "Model added ({count})",
    cpSaveSettings: "Save Settings",
    cpVerifyFetchHint: "Fetch models from the server or add them manually",
    nameUrlRequired: "Provider name and Base URL are required",
    cpSavedSettings: "Provider settings saved ({count} models enabled)",
    cpAddedSuccess: "Provider added ({count} models enabled)",
    toastProviderDeleted: "Provider deleted",
    emailRequired: "Email is required",
    manageAccountTitle: "Account: {name}",
    noNameLabel: "Unnamed",
    defaultAccountName: "Default Account",
    activeBrowserSession: "Active browser session",
    accountActiveNow: "Active Account",
    toastLoginWindow: "Opening sign-in window...",
    toastLoginDone: "Sign-in completed",
    toastAccountDeletedShort: "Account deleted",
        btnSave: "Save",
    topoStreamSse: "SSE Stream",
    topoNormal: "Standard",
    customModelsPart: "custom models",
    tokenUnit: "tokens",
    phRgName: "e.g. Group-A",
    mcpAgentLabel: "Agent / Editor",
    mcpTargetAuto: "Auto (by agent)",
    mcpFixedServerName: "Fixed server name:",
    mcpSectionDesc: "This section shows all available agents and editors. Select an agent and model to include them in the generated MCP configuration.",
    swarmSubtitle: "Execute tasks across specialized agent roles, synthesize results, and manage model router groups.",
    btnRunTask: "Run Task",
    swarmRolesTitle: "Execution Roles",
    swarmRolesSubtitle: "Work division by specialty",
    swarmRoleArchitect: "Architect",
    swarmRoleArchitectDesc: "Deconstruct goal, determine architecture and execution steps.",
    swarmModelLabel: "Router group for this role",
    swarmModelAuto: "Smart (auto)",
    swarmNoGroupsOption: "Create a router group first",
    swarmNeedGroup: "Create and select a router group for roles first",
    btnStopSwarm: "Stop",
    swarmAlreadyRunning: "A task is already running",
    swarmStopped: "Task stopped",
    btnStopSwarm: "Stop",
    swarmAlreadyRunning: "A task is already running",
    swarmStopped: "Task stopped",
    swarmRoleCoder: "Coder",
    swarmRoleCoderDesc: "Execute changes and write implementation code.",
    swarmRoleReviewer: "Reviewer",
    swarmRoleReviewerDesc: "Review code quality, assess risks, and suggest improvements.",
    swarmRoleTester: "Tester",
    swarmRoleTesterDesc: "Formulate test scenarios and verify functionality.",
    swarmExecTitle: "Task Execution",
    swarmExecSubtitle: "Send a goal to the multi-agent swarm coordinator",
    swarmGoalLabel: "System instructions",
    swarmGoalPlaceholder: "Write the system instructions all agents should follow (context, constraints, style...)",
    swarmModeLabel: "Execution Mode",
    swarmModeAuto: "Auto (Pipeline + Parallel)",
    swarmModePipeline: "Sequential",
    swarmModeParallel: "Parallel",
    btnExecute: "Execute",
    swarmModelLabel: "Role Model",
    swarmModelAuto: "Smart Auto (auto)",
    swarmGoalRequired: "Please enter system instructions first",
    swarmExecuting: "Executing...",
    swarmDispatching: "Dispatching and coordinating task across agents...",
    swarmConnFailed: "Failed to connect to server",
    langOptAr: "Arabic (AR)",
    langOptEn: "English (EN)",
    langOptFr: "French (FR)",
    langOptRu: "Russian (RU)",
    langOptEs: "Spanish (ES)",
    langOptZh: "Chinese (ZH)",
    pulseLatency: "14ms"
  },
  fr: {
    documentTitle: "EMO-AI Gateway — Tableau de bord et gestion des agents",
    serviceToggleTitle: "Démarrer ou arrêter la réception des requêtes sur la passerelle",
    clearLogHint: "Effacer le journal des requêtes affiché",
    baseUrlLabel: "URL de base :",
    apiKeyLabel: "Clé API :",
    metricPromptShort: "Invite :",
    metricComplShort: "| Réponse :",
    labelOpenAiBaseUrl: "URL de base OpenAI (/v1)",
    labelAnthropicBaseUrl: "URL de base Anthropic (Claude Code)",
    labelGeminiBaseUrl: "URL de base Gemini (Gemini CLI)",
    labelDefaultApiKey: "Clé API par défaut",
    topoWrapperAria: "Topologie de connexion en direct : appuyez sur Tab pour naviguer entre les nœuds et mettre en évidence les flux",
    hubAriaLabel: "EMO-AI Gateway Core — passerelle centrale multi-protocoles",
    engineDesc: "",
    navOverview: "Tableau de bord",
    navUsage: "Consommation & Télémétrie",
    navConnect: "Connexion Agents & IDE",
    navProviders: "Fournisseurs & Modèles",
    navAccounts: "Gestion des comptes",
    navRouter: "Groupes de routage",
    navKeys: "Clés API & Fournisseurs",
    navSwarm: "Coordinateur d'agents (Swarm)",
    sidebarToggleCollapse: "Réduire la barre latérale",
    sidebarToggleExpand: "Développer la barre latérale",
    langLabel: "Langue",
    themeToggleTitle: "Changer de thème (Sombre / Clair)",
    darkMode: "Mode sombre",
    lightMode: "Mode clair",
    settingsTitle: "Paramètres",
    settingsClose: "Fermer",
    appearanceLabel: "Apparence",
    langAndAppearance: "Langue et apparence",
    appUpdateLabel: "Mise à jour de l'application",
    currentVersionLabel: "Version actuelle",
    checkUpdateBtn: "Vérifier les mises à jour",
    connectionsLabel: "Connexions",
    mcpConnection: "Connexion des agents",
    toastCheckingUpdate: "Vérification des mises à jour...",
    toastAppUpToDate: "L'application est à jour ({version})",
    settingsPageSubtitle: "Gérez la langue, l'apparence, les informations de l'application et la connexion des agents",
    aboutAppLabel: "À propos de l'application",
    latestVersionLabel: "Dernière version",
    agentConnectionSection: "Connexion des agents",
    agentConnectionSettingsDesc: "Gérez la connexion des agents (automatique, manuelle et configuration MCP).",
    openAgentConnectionBtn: "Paramètres de connexion des agents",
    connectTabAuto: "Automatique",
    connectTabManual: "Manuel",
    connectTabMcp: "MCP",
    mcpSetupTitle: "Configuration MCP",
    mcpSetupDesc: "Créez la configuration MCP pour l'agent sélectionné, choisissez la cible, puis copiez la configuration générée.",
    mcpTargetLabel: "Cible MCP",
    mcpServerNameLabel: "Nom du serveur MCP",
    mcpConfigTitle: "Configuration MCP générée",
    mcpCopyConfig: "Copier la config MCP",
    mcpHintAgent: "Sélectionnez un agent et un modèle ci-dessus pour les inclure dans la configuration MCP.",
    manualConfigTitle: "Configuration manuelle (extrait)",
    autoConfigSectionTitle: "Connexion automatique de l'agent",
    identifierLabel: "Identifiant :",
    endpointLabel: "Point de terminaison :",
    gatewayConnected: "Passerelle connectée",
    gatewayDisconnected: "Erreur de connexion",
    overviewTitle: "Tableau de bord principal de la passerelle",
    overviewSubtitle: "Centre unifié d'administration de la passerelle, du routage en direct et de la télémétrie",
    serviceRunning: "Service de passerelle actif",
    serviceStopped: "Service de passerelle en pause",
    btnStopService: "⏹ Arrêter",
    btnStartService: "▶ Reprendre",
    btnQuickRefresh: "Actualiser",
    btnQuickRefreshTitle: "Actualiser les données maintenant",
    btnRefreshing: "Actualisation…",
    toastRefreshed: "Données actualisées",
    toastRefreshFailed: "Impossible d'actualiser les données",
    btnCopy: "Copier",
    copied: "Copié !",
    metricUptime: "Temps de fonctionnement",
    metricLive: "● Direct",
    metricSinceStart: "Depuis le démarrage",
    metricTotalTokens: "Total estimé des tokens",
    metricSuccessRate: "Taux de succès",
    metricCompletedOfPart: "réussis sur",
    metricRequestsPart: "requêtes",
    metricActiveProviders: "Fournisseurs & Comptes prêts",
    metricActiveModelsPart: "modèles en rotation",
    topoLiveFlow: "Topologie de connexion en direct",
    topoLivePulse: "Flux actif",
    topoFlowStopped: "Flux arrêté",
    topoAutoSync: "Synchronisé toutes les 3s",
    topoInboundChannels: "canaux entrants",
    topoActiveProviders: "fournisseurs actifs",
    topoPrivacyPath: "Chemin de confidentialité",
    topoPulseBtn: "Tester les routes",
    topoPulsing: "Vérification...",
    topoAgentsTitle: "Agents & IDEs",
    topoAgentsScanning: "Détection des outils installés...",
    topoHubTitle: "Passerelle centrale multi-protocoles",
    topoHubPortIn: "Port de réception entrant",
    topoHubPortOut: "Port de sortie amont",
    topoHubUptime: "Durée d'activité",
    topoHubReqRate: "Débit de requêtes (par minute)",
    topoHubReqRateUnit: "/min",
    topoHubLatency: "Latence & vitesse de réponse",
    topoProvidersTitle: "Fournisseurs & Points de terminaison actifs",
    topoProvidersLoading: "Chargement des fournisseurs...",
    topoNoActiveProviders: "Aucun fournisseur actif",
    topoLiveNow: "En direct",
    topoRecent: "Récent",
    topoStandby: "En attente",
    topoInFlight: "En cours",
    topoRouteTo: "Route",
    topoLiveRequests: "Requêtes actives",
    topoServing: "En service",
    topoNoLiveAgents: "Aucun canal actif — exécutez une requête pour afficher le nœud de flux",
    requestInFlight: "En cours…",
    topoCustom: "Personnalisé",
    topoNoLiveProvs: "Aucun fournisseur n'a de requête en cours — il n'apparaît ici que pendant qu'il en traite réellement une",
    topoWaitingRequests: "En attente de requêtes",
    topoWaitingRequestsSub: "Les outils de dev et agents apparaissent ici en temps réel lors des requêtes",
    topoWaitingProvs: "En attente de fournisseurs",
    topoWaitingProvsSub: "Le fournisseur traitant la requête apparaît ici en temps réel",
    topoLastProv: "Dernier fournisseur",
    topoInteractionHint: "Interactif : Survolez un nœud ou naviguez avec Tab pour mettre en évidence les flux.",
    topoLegendFlow: "Flux standard",
    topoLegendPrivacy: "Voie privée",
    topoLegendDormant: "Voie inactive",
    quickModelsTitle: "Modèles actifs disponibles dans vos outils",
    quickModelsSubtitle: "Cliquez sur un modèle pour copier son nom",
    quickModelsEmpty: "Aucun modèle actif. Sélectionnez des modèles dans l'onglet Fournisseurs et enregistrez.",
    consumptionTitle: "Télémétrie des requêtes et consommation en direct",
    consumptionSubtitle: "Surveillance granulaire de toutes les requêtes entrantes, latence, caractères et tokens",
    btnClearLog: "🗑 Effacer le journal",
    metricPromptChars: "Caractères d'invite",
    metricComplChars: "Caractères de réponse",
    metricStreamReq: "Requêtes en streaming",
    metricLifetimeReq: "Requêtes depuis le lancement",
    thTimestamp: "Heure",
    thAgent: "Agent client",
    thModel: "Modèle",
    thType: "Type",
    thTokens: "Tokens (est.)",
    thLatency: "Latence",
    thStatus: "Statut",
    noRequestsRecorded: "Aucune requête enregistrée. Envoyez une requête depuis votre éditeur (Cursor, Claude Code, OpenCode) pour voir la télémétrie.",
    connectTitle: "Connexion des agents",
    connectSubtitle: "Gérez la connexion des agents via la configuration automatique, manuelle et MCP avec sélection de l'agent.",
    localAgentsListTitle: "Agents & IDEs locaux",
    installedOnDevice: "✓ Installé sur votre machine",
    setupGuide: "Guide de configuration",
    selectSnippetModelLabel: "Modèle cible dans la configuration :",
    copyCodeBtn: "Copier le code",
    btnRescanAgents: "🔄 Rechercher les agents",
    btnAddCustomAgent: "+ Ajouter un agent manuel",
    autoConnectTitle: "Configuration automatique en un clic",
    autoConnectDesc: "Mettre à jour le fichier de config de cet agent avec une sauvegarde .bak",
    btnAutoConnect: "Configuration automatique",
    btnDeleteCustomAgent: "Supprimer l'agent",
    modalAddCustomAgentTitle: "Ajouter un agent manuel",
    labelAgentName: "Nom de l'agent",
    phAgentName: "ex : Pi Agent ou Agent personnalisé",
    labelAgentId: "ID de l'agent (Slug)",
    phAgentId: "mon-agent",
    labelAgentProtocol: "Protocole de connexion",
    labelAgentIcon: "Icône de l'agent (emoji ou SVG)",
    phAgentIcon: "🤖",
    labelAgentCommand: "Commande / Chemin",
    phAgentCommand: "mon-agent ou /chemin/vers/agent",
    labelAgentConfigPath: "Chemin du fichier de configuration",
    phAgentConfigPath: "~/.config/mon-agent/config.json",
    labelAgentNotes: "Notes (facultatif)",
    phAgentNotes: "Instructions supplémentaires pour exécuter cet agent",
    btnSaveCustomAgent: "Enregistrer l'agent",
    agentCustom: "Personnalisé",
    agentConfigured: "Configuré",
    scanningAgents: "Analyse...",
    scanningAgentsToast: "Analyse de l'appareil en cours...",
    agentsScanDone: "{count} agent(s) installé(s) trouvé(s)",
    autoConnecting: "Connexion...",
    autoConnectSuccess: "Configuration automatique réussie",
    autoConnectFailed: "Échec de la configuration automatique",
    agentNotInstalledMsg: "Cet agent n'est pas installé sur votre appareil — installez-le d'abord puis réessayez",
    noAgentSelected: "Veuillez d'abord sélectionner un agent",
    agentNameRequired: "Le nom de l'agent est requis",
    agentSaved: "Agent personnalisé enregistré avec succès",
    agentDeleted: "Agent personnalisé supprimé",
    notCustomAgent: "Cet agent n'est pas personnalisé",
    confirmDeleteAgent: "Voulez-vous vraiment supprimer l'agent {name} ?",
    providersTitle: "Gestion des fournisseurs et modèles",
    providersSubtitle: "Démarrer/arrêter les fournisseurs, tester la latence et basculer de compte",
    accountsTitle: "Gestion multi-comptes",
    accountsSubtitle: "Gérer les comptes par fournisseur, changer de session active et ajouter de nouveaux comptes",
    btnAddAccount: "+ Ajouter un compte",
    thProvider: "Fournisseur",
    thAccountName: "Nom du compte",
    thEmail: "Adresse e-mail",
    thLoginStatus: "État de connexion",
    thActiveStatus: "Compte actif",
    thActions: "Actions",
    keysTitle: "Clés API & Fournisseurs personnalisés",
    keysSubtitle: "Générez des jetons d'accès et connectez des points de terminaison LLM externes",
    btnAddCustomKey: "+ Nouvelle clé API",
    btnAddCustomProvider: "+ Ajouter fournisseur",
    routerTitle: "Groupes de routage",
    routerSubtitle: "Regroupez des modèles de différents fournisseurs et comptes sous un même nom avec basculement ou répartition",
    routerHint: "Le nom du groupe devient le nom du modèle envoyé par les clients. sequential teste les cibles dans l'ordre en cas d'échec ; round-robin répartit les requêtes.",
    btnAddRouterGroup: "+ Nouveau groupe",
    rgModalCreateTitle: "Créer un groupe de routage",
    rgModalEditTitle: "Modifier le groupe",
    rgNameLabel: "Nom du groupe (nom du modèle)",
    rgIconLabel: "Icône",
    rgStrategyLabel: "Stratégie",
    rgStrategySeq: "Séquentiel (failover)",
    rgStrategyRR: "Round-robin (alternance)",
    rgTargetsLabel: "Cibles (ordre = priorité)",
    rgAddTarget: "+ Ajouter une cible",
    rgTargetsHint: "Fixer un compte bascule le profil actif du fournisseur au besoin. Évitez deux comptes différents du même fournisseur en round-robin.",
    rgNoGroups: "Aucun groupe pour l'instant. Créez-en un pour regrouper vos modèles favoris.",
    rgTargetProvider: "Fournisseur",
    rgTargetModel: "Modèle",
    rgTargetAccount: "Compte",
    rgAccountActive: "Compte actif (par défaut)",
    rgBtnTest: "Tester",
    rgBtnEdit: "Modifier",
    rgBtnDelete: "Supprimer",
    rgEnabled: "Activé",
    rgDisabled: "Désactivé",
    rgTestOk: "Opérationnel",
    rgTestFail: "Échec",
    rgSaved: "Groupe enregistré",
    rgDeleted: "Groupe supprimé",
    rgDeleteConfirm: "Supprimer ce groupe ?",
    customKeysSectionTitle: "Clés d'accès autorisées pour la passerelle",
    customKeysSectionDesc: "Acceptées dans les en-têtes Authorization: Bearer, x-api-key et x-goog-api-key",
    thKeyName: "Nom de la clé",
    thKeySecret: "Clé secrète",
    thCreated: "Créé le",
    thKeyStatus: "Statut",
    customProvidersSectionTitle: "Points de terminaison et fournisseurs amont personnalisés",
    customProvidersSectionDesc: "Intégrez DeepSeek, Ollama, OpenRouter, Groq directement dans la passerelle",
    modalAddKeyTitle: "Créer une nouvelle clé API",
    labelKeyName: "Nom / Libellé de la clé",
    phKeyName: "ex : Cursor-Work ou ClaudeCode-Key",
    labelKeySecret: "Clé secrète (Laisser vide pour génération automatique)",
    btnGenerateRandom: "Générer aléatoirement",
    btnCancel: "Annuler",
    btnSaveKey: "Enregistrer & Activer",
    modalAddCpTitle: "Ajouter un fournisseur API personnalisé",
    modalEditCpTitle: "⚙️ Paramètres et modification : ",
    labelCpName: "Nom du fournisseur (Nom du service)",
    phCpName: "ex : DeepSeek, Ollama Local ou OpenRouter",
    labelCpUrl: "URL de base de l'endpoint (récupération auto des modèles)",
    phCpUrl: "https://api.deepseek.com/v1 ou http://localhost:11434/v1",
    labelCpKey: "Clé API du fournisseur (requêtes et récupération des modèles)",
    toggleKeyVisibility: "Afficher / Masquer la clé",
    btnFetchModelsAuto: "🔄 Récupérer",
    labelCpModelsManagement: "Gestion des modèles (Auto + Manuel)",
    cpFetchHint: "Entrez l'URL et la clé pour charger les modèles ou ajoutez manuellement",
    labelCpModelsListSelect: "Modèles découverts (Cochez pour activer) :",
    btnSelectAll: "Tout sélectionner",
    btnDeselectAll: "Tout désélectionner",
    phCpManualSingle: "Ajouter un modèle manuellement (ex : deepseek-reasoner)",
    btnAddManualModel: "+ Ajouter",
    labelCpApprovedModels: "Liste des modèles approuvés (séparés par des virgules) :",
    phCpModels: "deepseek-chat, deepseek-reasoner",
    btnSaveCustomProv: "Enregistrer",
    modalAddAccTitle: "Ajouter un compte au fournisseur",
    labelSelectProvider: "Fournisseur cible",
    labelAccountName: "Nom / Libellé du compte (Optionnel)",
    phAccountName: "ex : Compte pro ou personnel",
    labelAccountEmail: "Adresse e-mail",
    btnSaveAccount: "Enregistrer le compte",
    modalAccountDetailTitle: "Détails du compte",
    labelProvider: "Fournisseur :",
    labelName: "Nom :",
    labelEmail: "E-mail :",
    labelLoginState: "État de connexion :",
    labelProfilePath: "Chemin du profil :",
    btnDelete: "Supprimer",
    btnSetAsActive: "Définir comme actif",
    btnLogin: "Se connecter",
    toastCopiedBaseUrl: "Base URL copiée",
    toastCopiedApiKey: "Clé API copiée",
    toastSettingsCopied: "Configuration copiée avec succès",
    toastCopied: "Copié : ",
    toastFlowPulse: "État des routes de connexion vérifié",
    toastServiceResumed: "Service de passerelle réactivé avec succès",
    toastServicePaused: "Service de passerelle temporairement en pause",
    toastServiceToggleFailed: "Échec du changement d'état du service : ",
    toastLogCleared: "Journal des requêtes effacé avec succès",
    toastLogClearFailed: "Échec de l'effacement du journal : ",
    toastKeyCreated: "Nouvelle clé API créée avec succès",
    toastKeyDeleted: "Clé API supprimée",
    toastKeyActivated: "Clé activée",
    toastKeyDeactivated: "Clé désactivée",
    toastKeyCopied: "Clé copiée avec succès",
    toastAccountAdded: "Compte ajouté avec succès",
    toastAccountDeleted: "Compte supprimé : ",
    toastAccountActivated: "Compte activé avec succès",
    statusRunning: "En cours",
    statusStarting: "Démarrage...",
    statusStopped: "Arrêté",
    statusError: "Erreur",
    statusActive: "Actif",
    statusDisabled: "Désactivé",
    statusLoggedIn: "Connecté",
    statusNotLoggedIn: "Non connecté",
    statusActiveAccountBadge: "✓ Compte actif routé",
    statusDormantAccountBadge: "Inactif",
    statusDefaultKey: "Clé par défaut",
    statusSystemMasterKey: "Clé principale système",
    btnManage: "Gérer",
    btnActivate: "Activer",
    btnDeactivate: "Désactiver",
    btnEnable: "Activer",
    btnDisable: "Désactiver",
    btnStart: "▶ Lancer",
    btnStop: "⏹ Arrêter",
    btnSaveModels: "💾 Enregistrer",
    btnRefreshModels: "🔄 Récupérer",
    btnFetchModelsLive: "Récupérer les modèles",
    btnLoadCatalog: "Recharger le catalogue",
    btnDiscoveryUnsupported: "Non pris en charge",
    btnTestConnection: "Tester la connexion",
    btnTestConnectionUnsupported: "Test de connexion non pris en charge",
    btnWorking: "En cours…",
    notifCenterTitle: "Changements de modèles",
    notifCenterSub: "Chaque changement détecté par l'analyse en direct est signalé ici",
    notifMarkAll: "Tout marquer comme lu",
    notifMarkRead: "Marquer comme lu",
    notifEmpty: "Aucun changement de modèle pour l'instant.",
    notifUnread: "{count} non lus",
    notifOpenCard: "Ouvrir la carte du fournisseur",
    notifDetectedAt: "Détecté le : {ts}",
    notifSourceLabel: "Source",
    notifCardNotFound: "La carte du fournisseur n'est pas visible sur la page actuelle.",
    notifTypeModelAdded: "Nouveau modèle détecté",
    notifTypeModelRemoved: "Modèle supprimé",
    notifTypeModelRenamed: "Modèle renommé",
    notifTypeModelMetadata: "Métadonnées du modèle modifiées",
    notifTypeModelRestored: "Modèle supprimé précédemment rétabli",
    discoveryNeverScanned: "Découverte en direct : jamais analysée",
    discoveryActive: "Découverte en direct : active",
    discoveryUnsupported: "Découverte en direct : non prise en charge",
    discoveryNeedsLogin: "Découverte en direct : authentification requise",
    discoveryDeferred: "Découverte en direct : reportée",
    discoveryError: "Découverte en direct : erreur",
    discoveryModelsFound: "{count} modèles détectés",
    discoveryNewModels: "+{count} nouveau(x)",
    discoveryLastScan: "Dernière analyse réussie : {ts}",
    modelsSourceLiveWebUi: "Découverte en direct sur le site du fournisseur",
    btnDiscoverModels: "Découvrir les modèles",
    btnDiscoverModelsHint: "Lit la liste des modèles sur le site du fournisseur",
    btnCheckChanges: "Vérifier les changements",
    btnViewChanges: "Voir les changements",
    toastDiscoveryDone: "{count} modèle(s) détecté(s) ({newCount} nouveau(x))",
    toastDiscoveryChanges: "{count} changement(s) de modèle",
    toastDiscoveryFailed: "Échec de la découverte : {error}",
    toastDiscoveryDeferred: "Découverte reportée : {reason}",
    toastNoChanges: "Aucun changement de modèle détecté.",
    modelsSourceLabel: "Source",
    modelsSourceConfiguredCatalog: "Catalogue configuré — pas de découverte en direct",
    modelsSourceLiveApi: "Découverte en direct via le point /models",
    modelsSourceNone: "Aucune source",
    modelsLastRefreshAt: "Dernière synchro : {ts}",
    modelsNeverRefreshed: "Jamais synchronisé",
    modelsStaleBadge: "indisponible",
    modelsDiscoveryUnsupportedNote: "Ce fournisseur ne prend pas en charge la découverte des modèles — le bouton est désactivé.",
    modelsCatalogNotLiveNote: "La liste est un catalogue configuré dans la passerelle, pas une découverte en direct du site du fournisseur.",
    connStatusLabel: "Connexion",
    connStatusConnected: "Connecté",
    connStatusAuthenticationRequired: "Authentification requise",
    connStatusRateLimited: "Limité en débit",
    connStatusQuotaExhausted: "Quota épuisé",
    connStatusProviderUnavailable: "Fournisseur indisponible",
    connStatusBrowserUnavailable: "Navigateur indisponible",
    connStatusTimeout: "Délai dépassé",
    connStatusUnsupported: "Non pris en charge",
    connStatusUnknown: "Inconnu",
    connStatusNeverChecked: "Pas encore vérifié",
    connLastCheckAt: "Dernière vérification : {ts}",
    connCheckWebProfile: "Vérifie l'accessibilité du site, la disponibilité du navigateur et la session enregistrée",
    connCheckApiHealth: "Vérifie le point health/models du fournisseur (aucune requête payante)",
    connTestUnsupportedNote: "Aucun test de connexion réel n'est disponible pour ce type de fournisseur.",
    toastModelsRefreshedCount: "{count} modèle(s) mis à jour ({source})",
    toastModelsRefreshFailed: "Échec de l'actualisation des modèles : {error}",
    toastModelsPruned: "{count} modèle(s) sélectionné(s) supprimés car indisponibles",
    toastConnectionResult: "Test de connexion : {status} ({ms} ms)",
    toastConnectionFailed: "Échec du test de connexion : {error}",
    btnCheckPing: "⚡ Test ping",
    btnOpenBrowser: "🔑 Ouvrir le navigateur",
    toggleHeadlessLabel: "🖥️ Navigateur headless",
    togglePrivacyLabel: "🛡️ Mode privé (Privacy)",
    filterShowAll: "🌐 Tout afficher",
    filterShowEnabled: "Fournisseurs activés",
    filterProvidersHeader: "Sélection des fournisseurs :",
    filterProvidersSub: "Sélectionnez un ou plusieurs fournisseurs, ou cliquez sur \\\"Tout afficher\\\" ou \\\"Fournisseurs activés\\\"",
    filterShownCountAll: "Affichage : Tous",
    filterClear: "✕ Effacer le filtre (Tout afficher)",
    filterAccountsAll: "Tous les fournisseurs",
    noAccountsFound: "Aucun compte pour ce fournisseur. Cliquez sur '+ Ajouter un compte'.",
    noCustomProvidersFound: "Aucun fournisseur personnalisé. Cliquez sur '+ Ajouter fournisseur' pour connecter DeepSeek, Ollama ou OpenRouter.",
    agentActive: "Actif",
    agentInstalled: "Installé",
    agentGuide: "Guide",
    availableModelsCount: "Modèles disponibles",
    registeredAccounts: "Comptes enregistrés :",
    noAccountsRegistered: "Aucun compte ajouté",
    activeAccountPill: "(Actif)",
    addAccountBtnShort: "+ Compte",
    unnamedAccount: "Compte sans nom",
    customSettingsBtn: "Paramètres",
    customEditKeyModels: "Modifier clé / modèles",
    customApiKeySaved: "🔑 Clé API enregistrée",
    customNoApiKey: "Sans clé API",
    activeModelsListLabel: "Modèles activés",
    typeStream: "Flux",
    typeSync: "Synchrone",
    unknownClient: "Client non spécifié",
    pathLabel: "Chemin :",
    editorReady: "Éditeur prêt à se connecter via la passerelle",
    filterPillTitle: "Cliquez pour afficher ou ajouter {name} à la vue actuelle",
    filterShownCount: "Affichage : {shown} sur {total} fournisseurs",
    chipSwitchTitle: "Cliquez pour activer ce compte",
    chipDeleteTitle: "Supprimer ce compte",
    agentPortTitle: "Port de sortie de l'agent",
    headlessHint: "Exécuter le navigateur en arrière-plan sans fenêtre visible pour économiser les ressources",
    privacyHint: "Activer le mode confidentialité avec conversations éphémères pour ne rien stocker chez le fournisseur",
    privacyModeNote: "Mode privé = chat temporaire : les outils, la génération d'images et les fonctions spéciales n'y fonctionnent pas, et aucun historique n'est enregistré chez le fournisseur.",
    privacyModeNoteGeneric: "Mode privé : l'historique n'est pas enregistré chez le fournisseur, et certains outils ou fonctions spéciales peuvent ne pas fonctionner.",
    pingHint: "Tester la connexion et la vitesse de réponse de ce fournisseur",
    btnAllShort: "Tout",
    btnNoneShort: "Aucun",
    noModelsYet: "Aucun modèle. Connectez-vous ou cliquez sur Récupérer pour charger les modèles.",
    toastHeadlessEnabled: "Mode headless activé pour {id}",
    toastHeadlessDisabled: "Mode headless désactivé pour {id}",
    toastPrivacyEnabled: "Mode confidentialité activé pour {id}",
    toastPrivacyDisabled: "Mode confidentialité désactivé pour {id}",
    toastAccSwitched: "Compte sélectionné activé avec succès",
    toastProviderStarted: "{id} démarré",
    toastProviderStopped: "{id} arrêté",
    toastModelsSaved: "Modèles enregistrés pour {id}",
    toastModelsRefreshed: "Liste des modèles actualisée",
    toastBrowserOpening: "Ouverture du navigateur pour la connexion...",
    toastLoginComplete: "Session de connexion terminée",
    toastProviderEnabled: "Fournisseur activé",
    toastProviderDisabled: "Fournisseur désactivé",
    snipEnvSetup: "# 1. Définir l'URL de la passerelle et la clé d'accès dans le terminal :",
    snipRunClaude: "# 2. Lancer Claude Code via la passerelle locale :",
    snipCursorModels: "// Dans les paramètres de {name} > Models > OpenAI API :",
    snipVsCode: "// Dans les paramètres VS Code (settings.json ou extensions Cline / Continue) :",
    snipPythonOpenAI: "# Python avec le protocole standard OpenAI :",
    snipPythonAnthropic: "# Ou avec le SDK officiel Anthropic directement :",
    snipPythonHello: "Bonjour depuis du code Python !",
    snipHello: "Bonjour",
    snipGeminiSetup: "# Configurer le protocole Gemini natif (/v1beta) :",
    snipGeminiCurl: "# Ou via cURL avec l'en-tête x-goog-api-key :",
    snipGeminiHello: "Bonjour !",
    snipHermesSetup: "# Configurer Hermes Agent pour joindre la passerelle locale :",
    snipCallAgent: "# Appeler l'agent directement :",
    snipEnvVarsAlt: "# Ou via les variables d'environnement :",
    snipThenRun: "# Puis lancer :",
    defaultKeyCreatedAt: "Par défaut",
    cpNoModelsYet: "Aucun modèle sélectionné — ouvrez les paramètres pour récupérer les modèles ou les ajouter",
    cpVerifyHint: "Tester la connexion réelle et valider la clé API auprès du serveur",
    cpVerifyBtn: "🔌 Vérifier la connexion",
    cpSettingsHint: "Paramètres du fournisseur : modifier la clé et l'URL, récupérer ou ajouter des modèles",
    keyNameRequired: "Veuillez saisir un nom pour identifier la clé",
    cpVerifying: "⏳ Vérification...",
    verifyServerOk: "Connexion au serveur réussie",
    verifyServerFailed: "Échec de la connexion au serveur",
    cpVerifyLoading: "Connexion réelle au serveur et validation de la clé API...",
    verifyOk: "Connexion réussie",
    verifyFail: "Échec de la connexion",
    baseUrlRequiredVerify: "Veuillez d'abord saisir l'URL de base pour vérifier la connexion",
    cpVerifyChecking: "Test de la connexion réelle au serveur et validation de la clé API...",
    cpVerifyCheckingShort: "⏳ Test de connexion...",
    cpFetchedDuringVerify: "{count} modèles réels récupérés du serveur pendant le test",
    verifyCheckFailed: "Échec de la vérification de la connexion",
    baseUrlRequired: "Veuillez d'abord saisir l'URL de base",
    cpFetchingBanner: "Connexion à l'endpoint /models du serveur pour récupérer les modèles réels...",
    cpFetchingLive: "⏳ Récupération des modèles réels depuis le serveur...",
    cpFetchingShort: "⏳ Récupération depuis le serveur...",
    cpFetchedReal: "{count} modèles réels récupérés directement du serveur",
    cpFetchFailed: "Impossible de joindre le serveur pour récupérer les modèles",
    btnFetchReal: "🔄 Récupérer depuis le serveur",
    sourceServer: "🌐 du serveur",
    sourceManual: "✍️ ajouté",
    modelNameRequired: "Saisissez un nom de modèle à ajouter",
    manualModelAdded: "Modèle ajouté manuellement ({count} sélectionnés)",
    cpSaveSettings: "💾 Enregistrer les paramètres",
    cpVerifyFetchHint: "Utilisez le bouton Vérifier la connexion ou Récupérer depuis le serveur",
    nameUrlRequired: "Le nom et l'URL de base sont requis",
    cpSavedSettings: "Paramètres du fournisseur enregistrés ({count} modèles activés)",
    cpAddedSuccess: "Fournisseur personnalisé ajouté avec succès ({count} modèles activés)",
    toastProviderDeleted: "Fournisseur supprimé",
    emailRequired: "L'adresse e-mail est requise",
    manageAccountTitle: "Gérer {name}",
    noNameLabel: "Sans nom",
    defaultAccountName: "Compte par défaut",
    activeBrowserSession: "Session de navigateur active",
    accountActiveNow: "✓ Compte actuellement actif",
    toastLoginWindow: "Ouverture de la fenêtre de connexion pour ce compte...",
    toastLoginDone: "Connexion terminée",
    toastAccountDeletedShort: "Compte supprimé",
        btnSave: "Enregistrer",
    topoStreamSse: "Flux SSE",
    topoNormal: "Standard",
    customModelsPart: "modèles personnalisés",
    tokenUnit: "jetons",
    phRgName: "ex. Groupe-A",
    mcpAgentLabel: "Agent / Éditeur",
    mcpTargetAuto: "Automatique (selon l'agent)",
    mcpFixedServerName: "Nom de serveur fixe :",
    mcpSectionDesc: "Cette section répertorie tous les agents et éditeurs. Choisissez un agent et un modèle à inclure dans la configuration MCP.",
    swarmSubtitle: "Exécuter des tâches via des rôles d'agents spécialisés, synthétiser les résultats et gérer les groupes de routage.",
    btnRunTask: "Exécuter une tâche",
    swarmRolesTitle: "Rôles d'exécution",
    swarmRolesSubtitle: "Répartition du travail par spécialité",
    swarmRoleArchitect: "Architecte",
    swarmRoleArchitectDesc: "Décomposer l'objectif, définir l'architecture et les étapes.",
    swarmRoleCoder: "Développeur",
    swarmRoleCoderDesc: "Appliquer les modifications et rédiger le code source.",
    swarmRoleReviewer: "Réviseur",
    swarmRoleReviewerDesc: "Vérifier la qualité du code, évaluer les risques et réviser.",
    swarmRoleTester: "Testeur",
    swarmRoleTesterDesc: "Proposer des cas de test et vérifier le fonctionnement.",
    swarmExecTitle: "Exécution de tâche",
    swarmExecSubtitle: "Transmettre un objectif au coordinateur d'agents",
    swarmGoalLabel: "Objectif",
    swarmGoalPlaceholder: "Décrivez l'objectif à réaliser, avec contexte et contraintes.",
    swarmModeLabel: "Mode d'exécution",
    swarmModeAuto: "Automatique (Pipeline + Parallèle)",
    swarmModePipeline: "Séquentiel",
    swarmModeParallel: "Parallèle",
    btnExecute: "Lancer",
    swarmModelLabel: "Modèle de ce rôle",
    swarmModelAuto: "Auto intelligent (auto)",
    swarmGoalRequired: "Veuillez d'abord saisir un objectif ou une tâche",
    swarmExecuting: "Exécution en cours...",
    swarmDispatching: "Coordination et distribution de la tâche aux agents...",
    swarmConnFailed: "Échec de la connexion au serveur",
    langOptAr: "Arabe (AR)",
    langOptEn: "Anglais (EN)",
    langOptFr: "Français (FR)",
    langOptRu: "Russe (RU)",
    langOptEs: "Espagnol (ES)",
    langOptZh: "Chinois (ZH)",
    pulseLatency: "14ms (impulsion instantanée)"
  },
  ru: {
    documentTitle: "EMO-AI Gateway — Панель управления и управление агентами",
    serviceToggleTitle: "Запустить или остановить приём запросов на шлюзе",
    clearLogHint: "Очистить отображаемый журнал запросов",
    baseUrlLabel: "Базовый URL:",
    apiKeyLabel: "API-ключ:",
    metricPromptShort: "Запрос:",
    metricComplShort: "| Ответ:",
    labelOpenAiBaseUrl: "Базовый URL OpenAI (/v1)",
    labelAnthropicBaseUrl: "Базовый URL Anthropic (Claude Code)",
    labelGeminiBaseUrl: "Базовый URL Gemini (Gemini CLI)",
    labelDefaultApiKey: "API-ключ по умолчанию",
    topoWrapperAria: "Топология подключений в реальном времени: переключайтесь между узлами клавишей Tab для подсветки маршрутов",
    hubAriaLabel: "EMO-AI Gateway Core — центральный мультипротокольный шлюз",
    engineDesc: "",
    navOverview: "Общая панель",
    navUsage: "Потребление и запросы",
    navConnect: "Подключение агентов и IDE",
    navProviders: "Провайдеры и модели",
    navAccounts: "Управление аккаунтами",
    navRouter: "Группы роутера",
    navKeys: "API ключи и апстримы",
    navSwarm: "Координатор агентов (Swarm)",
    sidebarToggleCollapse: "Свернуть боковую панель",
    sidebarToggleExpand: "Развернуть боковую панель",
    langLabel: "Язык",
    themeToggleTitle: "Переключить тему (Темная / Светлая)",
    darkMode: "Темная тема",
    lightMode: "Светлая тема",
    settingsTitle: "Настройки",
    settingsClose: "Закрыть",
    appearanceLabel: "Оформление",
    langAndAppearance: "Язык и оформление",
    appUpdateLabel: "Обновление приложения",
    currentVersionLabel: "Текущая версия",
    checkUpdateBtn: "Проверить обновления",
    connectionsLabel: "Подключения",
    mcpConnection: "Подключение агентов",
    toastCheckingUpdate: "Проверка обновлений...",
    toastAppUpToDate: "Приложение обновлено ({version})",
    settingsPageSubtitle: "Управление языком, оформлением, сведениями о приложении и подключением агентов",
    aboutAppLabel: "О приложении",
    latestVersionLabel: "Последняя версия",
    agentConnectionSection: "Подключение агентов",
    agentConnectionSettingsDesc: "Управление подключением агентов: автоматическая, ручная настройка и MCP.",
    openAgentConnectionBtn: "Настройки подключения агентов",
    connectTabAuto: "Автоматически",
    connectTabManual: "Вручную",
    connectTabMcp: "MCP",
    mcpSetupTitle: "Настройка MCP",
    mcpSetupDesc: "Создайте конфигурацию MCP для выбранного агента, выберите цель интеграции и скопируйте готовую конфигурацию.",
    mcpTargetLabel: "Цель MCP",
    mcpServerNameLabel: "Имя MCP-сервера",
    mcpConfigTitle: "Сгенерированная конфигурация MCP",
    mcpCopyConfig: "Копировать конфигурацию MCP",
    mcpHintAgent: "Выберите агента и модель выше, чтобы включить их в конфигурацию MCP.",
    manualConfigTitle: "Ручная настройка (фрагмент)",
    autoConfigSectionTitle: "Автоматическое подключение агента",
    identifierLabel: "Идентификатор:",
    endpointLabel: "Эндпоинт:",
    gatewayConnected: "Шлюз в сети",
    gatewayDisconnected: "Ошибка соединения",
    overviewTitle: "Главная панель управления шлюзом",
    overviewSubtitle: "Единый центр управления состоянием шлюза, маршрутизацией агентов и телеметрией",
    serviceRunning: "Служба шлюза активна",
    serviceStopped: "Служба шлюза приостановлена",
    btnStopService: "⏹ Остановить",
    btnStartService: "▶ Возобновить",
    btnQuickRefresh: "Обновить",
    btnQuickRefreshTitle: "Обновить данные сейчас",
    btnRefreshing: "Обновление…",
    toastRefreshed: "Данные обновлены",
    toastRefreshFailed: "Не удалось обновить данные",
    btnCopy: "Копировать",
    copied: "Готово!",
    metricUptime: "Время работы",
    metricLive: "● В реальном времени",
    metricSinceStart: "С момента запуска",
    metricTotalTokens: "Всего токенов (расчет)",
    metricSuccessRate: "Успешность запросов",
    metricCompletedOfPart: "выполнено из",
    metricRequestsPart: "запросов",
    metricActiveProviders: "Активные провайдеры и аккаунты",
    metricActiveModelsPart: "моделей в ротации",
    topoLiveFlow: "Топология живых соединений",
    topoLivePulse: "Живой поток",
    topoFlowStopped: "Поток остановлен",
    topoAutoSync: "Автосинхронизация каждые 3с",
    topoInboundChannels: "входящих каналов",
    topoActiveProviders: "активных провайдеров",
    topoPrivacyPath: "Приватный маршрут",
    topoPulseBtn: "Проверить маршруты",
    topoPulsing: "Проверка...",
    topoAgentsTitle: "Агенты и редакторы кода",
    topoAgentsScanning: "Поиск установленных инструментов...",
    topoHubTitle: "Мультипротокольный центральный хаб",
    topoHubPortIn: "Входящий порт приема",
    topoHubPortOut: "Исходящий порт к провайдерам",
    topoHubUptime: "Время работы шлюза",
    topoHubReqRate: "Частота запросов (в минуту)",
    topoHubReqRateUnit: "/мин",
    topoHubLatency: "Задержка и скорость сети",
    topoProvidersTitle: "Активные провайдеры и эндпоинты",
    topoProvidersLoading: "Загрузка активных провайдеров...",
    topoNoActiveProviders: "Нет активных провайдеров",
    topoLiveNow: "Прямой эфир",
    topoRecent: "Недавний",
    topoStandby: "В ожидании",
    topoInFlight: "Обработка",
    topoRouteTo: "Маршрут",
    topoLiveRequests: "Потоки запросов",
    topoServing: "Обслуживает",
    topoNoLiveAgents: "Нет активных каналов — выполните запрос для отображения узла потока",
    requestInFlight: "В процессе…",
    topoCustom: "Свой",
    topoNoLiveProvs: "Сейчас ни один провайдер не выполняет запрос — провайдер появляется здесь только пока он действительно его обслуживает",
    topoWaitingRequests: "В ожидании потока запросов",
    topoWaitingRequestsSub: "Инструменты разработки и агенты появляются здесь в реальном времени при отправке запросов",
    topoWaitingProvs: "В ожидании провайдеров",
    topoWaitingProvsSub: "Провайдер, обрабатывающий запрос, появляется здесь в реальном времени",
    topoLastProv: "Последний провайдер",
    topoInteractionHint: "Интерактивно: Наведите на узел или используйте Tab для подсветки маршрутов.",
    topoLegendFlow: "Стандартный поток",
    topoLegendPrivacy: "Приватный путь",
    topoLegendDormant: "Неактивный путь",
    quickModelsTitle: "Активные модели, доступные для ваших инструментов",
    quickModelsSubtitle: "Нажмите на модель, чтобы скопировать имя",
    quickModelsEmpty: "Нет активных моделей. Выберите модели во вкладке Провайдеры и сохраните.",
    consumptionTitle: "Журнал потребления и телеметрия запросов",
    consumptionSubtitle: "Детальный мониторинг всех входящих запросов, задержек, символов и токенов",
    btnClearLog: "🗑 Очистить журнал",
    metricPromptChars: "Символы запроса (Prompt)",
    metricComplChars: "Символы ответа (Completion)",
    metricStreamReq: "Потоковые запросы",
    metricLifetimeReq: "Всего запросов за все время",
    thTimestamp: "Время",
    thAgent: "Клиент-агент",
    thModel: "Модель",
    thType: "Тип",
    thTokens: "Токены (расч.)",
    thLatency: "Задержка",
    thStatus: "Статус",
    noRequestsRecorded: "Запросов пока нет. Отправьте запрос из редактора или агента (Cursor, Claude Code, OpenCode) для отображения телеметрии.",
    connectTitle: "Подключение агентов",
    connectSubtitle: "Управление подключением агентов: автоматическая, ручная настройка и MCP с выбором агента.",
    localAgentsListTitle: "Локальные агенты и IDE",
    installedOnDevice: "✓ Установлено на устройстве",
    setupGuide: "Руководство по настройке",
    selectSnippetModelLabel: "Целевая модель в конфигурации:",
    copyCodeBtn: "Копировать код",
    btnRescanAgents: "🔄 Поиск агентов на устройстве",
    btnAddCustomAgent: "+ Добавить агента вручную",
    autoConnectTitle: "Автонастройка в один клик",
    autoConnectDesc: "Автоматическое обновление файла конфигурации агента с резервной копией .bak",
    btnAutoConnect: "Автонастройка",
    btnDeleteCustomAgent: "Удалить агента",
    modalAddCustomAgentTitle: "Добавить агента вручную",
    labelAgentName: "Имя агента",
    phAgentName: "например: Pi Agent или Пользовательский агент",
    labelAgentId: "ID агента (Slug)",
    phAgentId: "my-agent",
    labelAgentProtocol: "Протокол подключения",
    labelAgentIcon: "Иконка агента (emoji или SVG)",
    phAgentIcon: "🤖",
    labelAgentCommand: "Команда / Путь",
    phAgentCommand: "my-agent или /path/to/agent",
    labelAgentConfigPath: "Путь к файлу конфигурации",
    phAgentConfigPath: "~/.config/my-agent/config.json",
    labelAgentNotes: "Заметки (необязательно)",
    phAgentNotes: "Дополнительные инструкции для запуска этого агента",
    btnSaveCustomAgent: "Сохранить агента",
    agentCustom: "Пользовательский",
    agentConfigured: "Настроен",
    scanningAgents: "Сканирование...",
    scanningAgentsToast: "Сканирование устройства на наличие агентов...",
    agentsScanDone: "Найдено установленных агентов: {count}",
    autoConnecting: "Подключение...",
    autoConnectSuccess: "Автонастройка выполнена успешно",
    autoConnectFailed: "Ошибка автонастройки",
    agentNotInstalledMsg: "Этот агент не установлен на устройстве — сначала установите его и повторите",
    noAgentSelected: "Сначала выберите агента",
    agentNameRequired: "Укажите имя агента",
    agentSaved: "Пользовательский агент успешно сохранён",
    agentDeleted: "Пользовательский агент удалён",
    notCustomAgent: "Этот агент не является пользовательским",
    confirmDeleteAgent: "Вы уверены, что хотите удалить агента {name}?",
    providersTitle: "Управление провайдерами и моделями",
    providersSubtitle: "Запуск/остановка провайдеров, проверка задержки и переключение аккаунтов",
    accountsTitle: "Управление мульти-аккаунтами",
    accountsSubtitle: "Управление аккаунтами для каждого провайдера, переключение сессий и добавление новых",
    btnAddAccount: "+ Добавить аккаунт",
    thProvider: "Провайдер",
    thAccountName: "Имя аккаунта",
    thEmail: "Электронная почта",
    thLoginStatus: "Вход выполнен",
    thActiveStatus: "Активный аккаунт",
    thActions: "Действия",
    keysTitle: "API ключи и настраиваемые апстримы",
    keysSubtitle: "Создание токенов доступа и подключение внешних LLM-эндпоинтов к шлюзу",
    btnAddCustomKey: "+ Создать API ключ",
    btnAddCustomProvider: "+ Добавить апстрим",
    routerTitle: "Группы маршрутизатора",
    routerSubtitle: "Объединяйте модели разных провайдеров и аккаунтов под одним именем с отказоустойчивостью или round-robin",
    routerHint: "Имя группы становится именем модели для клиентов. sequential пробует цели по порядку при сбое; round-robin распределяет запросы.",
    btnAddRouterGroup: "+ Новая группа",
    rgModalCreateTitle: "Создать группу маршрутизатора",
    rgModalEditTitle: "Редактировать группу",
    rgNameLabel: "Имя группы (имя модели)",
    rgIconLabel: "Иконка",
    rgStrategyLabel: "Стратегия",
    rgStrategySeq: "Последовательно (failover)",
    rgStrategyRR: "Поочередно (round-robin)",
    rgTargetsLabel: "Цели (порядок = приоритет)",
    rgAddTarget: "+ Добавить цель",
    rgTargetsHint: "Привязка аккаунта при необходимости переключает активный профиль провайдера. Избегайте разных аккаунтов одного провайдера в round-robin.",
    rgNoGroups: "Групп пока нет. Создайте группу для объединения избранных моделей.",
    rgTargetProvider: "Провайдер",
    rgTargetModel: "Модель",
    rgTargetAccount: "Аккаунт",
    rgAccountActive: "Активный аккаунт (по умолч.)",
    rgBtnTest: "Тест",
    rgBtnEdit: "Изменить",
    rgBtnDelete: "Удалить",
    rgEnabled: "Включено",
    rgDisabled: "Отключено",
    rgTestOk: "Успешно",
    rgTestFail: "Ошибка",
    rgSaved: "Группа сохранена",
    rgDeleted: "Группа удалена",
    rgDeleteConfirm: "Удалить эту группу?",
    customKeysSectionTitle: "Авторизованные ключи доступа к шлюзу",
    customKeysSectionDesc: "Поддерживаются в заголовках Authorization: Bearer, x-api-key и x-goog-api-key",
    thKeyName: "Имя ключа",
    thKeySecret: "Секретный ключ",
    thCreated: "Создан",
    thKeyStatus: "Статус",
    customProvidersSectionTitle: "Настраиваемые апстримы и внешние провайдеры",
    customProvidersSectionDesc: "Прямая интеграция DeepSeek, Ollama, OpenRouter, Groq в шлюз",
    modalAddKeyTitle: "Создать новый API ключ для шлюза",
    labelKeyName: "Имя / Метка ключа",
    phKeyName: "например: Cursor-Work или ClaudeCode-Key",
    labelKeySecret: "Секретный ключ (Оставьте пустым для автогенерации)",
    btnGenerateRandom: "Случайный ключ",
    btnCancel: "Отмена",
    btnSaveKey: "Сохранить и активировать",
    modalAddCpTitle: "Добавить настраиваемый API провайдер",
    modalEditCpTitle: "⚙️ Настройки и редактирование: ",
    labelCpName: "Имя провайдера (Имя службы)",
    phCpName: "например: DeepSeek, Ollama Local или OpenRouter",
    labelCpUrl: "Base URL эндпоинта (автозагрузка моделей при вводе URL и ключа)",
    phCpUrl: "https://api.deepseek.com/v1 или http://localhost:11434/v1",
    labelCpKey: "API ключ провайдера (для запросов и загрузки списка моделей)",
    toggleKeyVisibility: "Показать / скрыть ключ",
    btnFetchModelsAuto: "🔄 Загрузить модели",
    labelCpModelsManagement: "Управление моделями (Авто + Вручную)",
    cpFetchHint: "Введите URL и ключ для загрузки моделей или добавьте вручную",
    labelCpModelsListSelect: "Обнаруженные модели (Отметьте нужные для включения):",
    btnSelectAll: "Выбрать все",
    btnDeselectAll: "Снять все",
    phCpManualSingle: "Добавить модель вручную (напр. deepseek-reasoner)",
    btnAddManualModel: "+ Добавить",
    labelCpApprovedModels: "Список одобренных моделей (через запятую):",
    phCpModels: "deepseek-chat, deepseek-reasoner",
    btnSaveCustomProv: "Сохранить",
    modalAddAccTitle: "Добавить аккаунт к провайдеру",
    labelSelectProvider: "Целевой провайдер",
    labelAccountName: "Имя аккаунта (Опционально)",
    phAccountName: "например: Рабочий или Личный",
    labelAccountEmail: "Электронная почта",
    btnSaveAccount: "Сохранить аккаунт",
    modalAccountDetailTitle: "Детали аккаунта",
    labelProvider: "Провайдер:",
    labelName: "Имя:",
    labelEmail: "Почта:",
    labelLoginState: "Статус входа:",
    labelProfilePath: "Путь профиля:",
    btnDelete: "Удалить",
    btnSetAsActive: "Сделать активным",
    btnLogin: "Войти",
    toastCopiedBaseUrl: "Base URL скопирован",
    toastCopiedApiKey: "API ключ скопирован",
    toastSettingsCopied: "Настройки успешно скопированы",
    toastCopied: "Скопировано: ",
    toastFlowPulse: "Текущие маршруты подключения проверены",
    toastServiceResumed: "Служба шлюза успешно возобновлена",
    toastServicePaused: "Служба шлюза временно остановлена",
    toastServiceToggleFailed: "Не удалось переключить службу: ",
    toastLogCleared: "Журнал запросов успешно очищен",
    toastLogClearFailed: "Не удалось очистить журнал: ",
    toastKeyCreated: "Новый API ключ успешно создан",
    toastKeyDeleted: "Ключ удален",
    toastKeyActivated: "Ключ активирован",
    toastKeyDeactivated: "Ключ отключен",
    toastKeyCopied: "Ключ скопирован",
    toastAccountAdded: "Аккаунт успешно добавлен",
    toastAccountDeleted: "Аккаунт удален: ",
    toastAccountActivated: "Аккаунт успешно активирован",
    statusRunning: "Работает",
    statusStarting: "Запуск...",
    statusStopped: "Остановлен",
    statusError: "Ошибка",
    statusActive: "Активен",
    statusDisabled: "Отключен",
    statusLoggedIn: "Вход выполнен",
    statusNotLoggedIn: "Не авторизован",
    statusActiveAccountBadge: "✓ Текущий активный аккаунт",
    statusDormantAccountBadge: "Неактивен",
    statusDefaultKey: "Ключ по умолчанию",
    statusSystemMasterKey: "Системный мастер-ключ",
    btnManage: "Управление",
    btnActivate: "Активировать",
    btnDeactivate: "Отключить",
    btnEnable: "Включить",
    btnDisable: "Отключить",
    btnStart: "▶ Запуск",
    btnStop: "⏹ Остановить",
    btnSaveModels: "💾 Сохранить",
    btnRefreshModels: "🔄 Обновить",
    btnFetchModelsLive: "Загрузить модели",
    btnLoadCatalog: "Перезагрузить каталог",
    btnDiscoveryUnsupported: "Не поддерживается",
    btnTestConnection: "Проверить подключение",
    btnTestConnectionUnsupported: "Проверка подключения не поддерживается",
    btnWorking: "Выполняется…",
    notifCenterTitle: "Изменения моделей",
    notifCenterSub: "Здесь сообщается о каждом изменении, найденном живым сканированием",
    notifMarkAll: "Отметить все прочитанными",
    notifMarkRead: "Отметить прочитанным",
    notifEmpty: "Изменений моделей пока нет.",
    notifUnread: "{count} не прочитано",
    notifOpenCard: "Открыть карточку провайдера",
    notifDetectedAt: "Обнаружено: {ts}",
    notifSourceLabel: "Источник",
    notifCardNotFound: "Карточка провайдера не видна на текущей странице.",
    notifTypeModelAdded: "Обнаружена новая модель",
    notifTypeModelRemoved: "Модель удалена",
    notifTypeModelRenamed: "Модель переименована",
    notifTypeModelMetadata: "Метаданные модели изменены",
    notifTypeModelRestored: "Ранее удалённая модель восстановлена",
    discoveryNeverScanned: "Живое обнаружение: ещё не проверялось",
    discoveryActive: "Живое обнаружение: работает",
    discoveryUnsupported: "Живое обнаружение: не поддерживается",
    discoveryNeedsLogin: "Живое обнаружение: требуется вход",
    discoveryDeferred: "Живое обнаружение: отложено",
    discoveryError: "Живое обнаружение: ошибка",
    discoveryModelsFound: "Обнаружено моделей: {count}",
    discoveryNewModels: "+{count} новых",
    discoveryLastScan: "Последняя успешная проверка: {ts}",
    modelsSourceLiveWebUi: "Живое обнаружение на сайте провайдера",
    btnDiscoverModels: "Найти модели",
    btnDiscoverModelsHint: "Читает список моделей на сайте провайдера",
    btnCheckChanges: "Проверить изменения",
    btnViewChanges: "Показать изменения",
    toastDiscoveryDone: "Обнаружено моделей: {count} (новых: {newCount})",
    toastDiscoveryChanges: "Изменений моделей: {count}",
    toastDiscoveryFailed: "Не удалось выполнить обнаружение: {error}",
    toastDiscoveryDeferred: "Обнаружение отложено: {reason}",
    toastNoChanges: "Изменений моделей не обнаружено.",
    modelsSourceLabel: "Источник",
    modelsSourceConfiguredCatalog: "Настроенный каталог — не живое обнаружение",
    modelsSourceLiveApi: "Живое обнаружение через точку /models",
    modelsSourceNone: "Нет источника",
    modelsLastRefreshAt: "Последняя синхронизация: {ts}",
    modelsNeverRefreshed: "Ни разу не синхронизировано",
    modelsStaleBadge: "недоступно",
    modelsDiscoveryUnsupportedNote: "Этот провайдер не поддерживает получение списка моделей — кнопка отключена.",
    modelsCatalogNotLiveNote: "Список — настроенный каталог внутри шлюза, а не живое обнаружение на сайте провайдера.",
    connStatusLabel: "Подключение",
    connStatusConnected: "Подключено",
    connStatusAuthenticationRequired: "Требуется вход",
    connStatusRateLimited: "Ограничение частоты",
    connStatusQuotaExhausted: "Квота исчерпана",
    connStatusProviderUnavailable: "Провайдер недоступен",
    connStatusBrowserUnavailable: "Браузер недоступен",
    connStatusTimeout: "Тайм-аут",
    connStatusUnsupported: "Не поддерживается",
    connStatusUnknown: "Неизвестно",
    connStatusNeverChecked: "Ещё не проверялось",
    connLastCheckAt: "Последняя проверка: {ts}",
    connCheckWebProfile: "Проверяет доступность сайта, наличие браузера и сохранённую сессию",
    connCheckApiHealth: "Проверяет health/models endpoint провайдера (без платного запроса)",
    connTestUnsupportedNote: "Реальная проверка подключения для этого типа провайдера недоступна.",
    toastModelsRefreshedCount: "Обновлено моделей: {count} ({source})",
    toastModelsRefreshFailed: "Не удалось обновить модели: {error}",
    toastModelsPruned: "Удалено выбранных моделей: {count} (недоступны)",
    toastConnectionResult: "Проверка подключения: {status} ({ms} мс)",
    toastConnectionFailed: "Проверка подключения не удалась: {error}",
    btnCheckPing: "⚡ Пинг",
    btnOpenBrowser: "🔑 Открыть браузер",
    toggleHeadlessLabel: "🖥️ Фоновый браузер (Headless)",
    togglePrivacyLabel: "🛡️ Режим приватности",
    filterShowAll: "🌐 Показать все",
    filterShowEnabled: "Включённые провайдеры",
    filterProvidersHeader: "Фильтр провайдеров:",
    filterProvidersSub: "Выберите одного или нескольких провайдеров, либо нажмите \\\"Показать все\\\" или \\\"Включённые провайдеры\\\"",
    filterShownCountAll: "Показано: Все",
    filterClear: "✕ Сбросить фильтр (Показать все)",
    filterAccountsAll: "Все провайдеры",
    noAccountsFound: "Нет аккаунтов для этого провайдера. Нажмите '+ Добавить аккаунт'.",
    noCustomProvidersFound: "Нет настраиваемых провайдеров. Нажмите '+ Добавить апстрим' для подключения DeepSeek, Ollama или OpenRouter.",
    agentActive: "Активен",
    agentInstalled: "Установлен",
    agentGuide: "Гид",
    availableModelsCount: "Доступные модели",
    registeredAccounts: "Зарегистрированные аккаунты:",
    noAccountsRegistered: "Нет добавленных аккаунтов",
    activeAccountPill: "(Активен)",
    addAccountBtnShort: "+ Аккаунт",
    unnamedAccount: "Безымянный аккаунт",
    customSettingsBtn: "Настройки",
    customEditKeyModels: "Изменить ключ / модели",
    customApiKeySaved: "🔑 API ключ сохранен",
    customNoApiKey: "Без API ключа",
    activeModelsListLabel: "Активные модели",
    typeStream: "Поток",
    typeSync: "Синхронно",
    unknownClient: "Клиент не указан",
    pathLabel: "Путь:",
    editorReady: "Редактор готов к подключению через шлюз",
    filterPillTitle: "Нажмите, чтобы показать или добавить {name} в текущий вид",
    filterShownCount: "Показано: {shown} из {total} провайдеров",
    chipSwitchTitle: "Нажмите, чтобы активировать этот аккаунт",
    chipDeleteTitle: "Удалить этот аккаунт",
    agentPortTitle: "Исходящий порт агента",
    headlessHint: "Запуск браузера в фоне без окна для экономии ресурсов",
    privacyHint: "Режим приватности с временными чатами: история не сохраняется на серверах провайдера",
    privacyModeNote: "Приватный режим = временный чат: инструменты, генерация изображений и особые функции в нём не работают, история не сохраняется у провайдера.",
    privacyModeNoteGeneric: "Приватный режим: история переписки не сохраняется у провайдера, а некоторые инструменты и особые функции могут не работать.",
    pingHint: "Проверить соединение и скорость ответа провайдера",
    btnAllShort: "Все",
    btnNoneShort: "Сброс",
    noModelsYet: "Моделей пока нет. Войдите или нажмите Обновить.",
    toastHeadlessEnabled: "Фоновый режим включен для {id}",
    toastHeadlessDisabled: "Фоновый режим выключен для {id}",
    toastPrivacyEnabled: "Режим приватности включен для {id}",
    toastPrivacyDisabled: "Режим приватности выключен для {id}",
    toastAccSwitched: "Выбранный аккаунт успешно активирован",
    toastProviderStarted: "{id} запущен",
    toastProviderStopped: "{id} остановлен",
    toastModelsSaved: "Модели сохранены для {id}",
    toastModelsRefreshed: "Список моделей обновлен",
    toastBrowserOpening: "Открытие браузера для входа...",
    toastLoginComplete: "Сессия входа завершена",
    toastProviderEnabled: "Провайдер включен",
    toastProviderDisabled: "Провайдер отключен",
    snipEnvSetup: "# 1. Задайте адрес шлюза и ключ доступа в терминале:",
    snipRunClaude: "# 2. Запустите Claude Code через локальный шлюз:",
    snipCursorModels: "// В настройках {name} > Models > OpenAI API:",
    snipVsCode: "// В настройках VS Code (settings.json или расширения Cline / Continue):",
    snipPythonOpenAI: "# Python со стандартным протоколом OpenAI:",
    snipPythonAnthropic: "# Или напрямую через официальный Anthropic SDK:",
    snipPythonHello: "Привет из кода Python!",
    snipHello: "Привет",
    snipGeminiSetup: "# Настройка нативного протокола Gemini (/v1beta):",
    snipGeminiCurl: "# Или через cURL с заголовком x-goog-api-key:",
    snipGeminiHello: "Привет!",
    snipHermesSetup: "# Настройка Hermes Agent для работы с локальным шлюзом:",
    snipCallAgent: "# Вызовите агент напрямую:",
    snipEnvVarsAlt: "# Или через переменные окружения:",
    snipThenRun: "# Затем запустите:",
    defaultKeyCreatedAt: "По умолчанию",
    cpNoModelsYet: "Модели пока не выбраны — откройте настройки, чтобы загрузить их с сервера или добавить вручную",
    cpVerifyHint: "Реальная проверка соединения и валидация API ключа на сервере",
    cpVerifyBtn: "🔌 Проверить соединение",
    cpSettingsHint: "Настройки провайдера: изменить ключ и URL, загрузить или добавить модели",
    keyNameRequired: "Введите имя для обозначения ключа",
    cpVerifying: "⏳ Проверка...",
    verifyServerOk: "Соединение с сервером успешно",
    verifyServerFailed: "Не удалось соединиться с сервером",
    cpVerifyLoading: "Подключение к серверу и проверка API ключа...",
    verifyOk: "Соединение успешно",
    verifyFail: "Соединение не удалось",
    baseUrlRequiredVerify: "Сначала введите Base URL для проверки соединения",
    cpVerifyChecking: "Проверка реального соединения с сервером и API ключа...",
    cpVerifyCheckingShort: "⏳ Проверка соединения...",
    cpFetchedDuringVerify: "Во время проверки получено {count} реальных моделей с сервера",
    verifyCheckFailed: "Не удалось проверить соединение",
    baseUrlRequired: "Сначала введите Base URL",
    cpFetchingBanner: "Подключение к эндпоинту /models сервера для загрузки реальных моделей...",
    cpFetchingLive: "⏳ Загрузка реальных моделей с сервера...",
    cpFetchingShort: "⏳ Загрузка с сервера...",
    cpFetchedReal: "Получено {count} реальных моделей напрямую с сервера",
    cpFetchFailed: "Не удалось обратиться к серверу за моделями",
    btnFetchReal: "🔄 Загрузить модели с сервера",
    sourceServer: "🌐 с сервера",
    sourceManual: "✍️ добавлено",
    modelNameRequired: "Введите имя модели для добавления",
    manualModelAdded: "Модель добавлена вручную (выбрано {count})",
    cpSaveSettings: "💾 Сохранить настройки",
    cpVerifyFetchHint: "Используйте кнопку Проверить соединение или Загрузить модели с сервера",
    nameUrlRequired: "Имя и Base URL обязательны",
    cpSavedSettings: "Настройки провайдера сохранены (активировано моделей: {count})",
    cpAddedSuccess: "Пользовательский провайдер успешно добавлен (активировано моделей: {count})",
    toastProviderDeleted: "Провайдер удален",
    emailRequired: "Требуется адрес электронной почты",
    manageAccountTitle: "Управление {name}",
    noNameLabel: "Без имени",
    defaultAccountName: "Аккаунт по умолчанию",
    activeBrowserSession: "Активный сеанс браузера",
    accountActiveNow: "✓ Аккаунт уже активен",
    toastLoginWindow: "Открытие окна входа для этого аккаунта...",
    toastLoginDone: "Вход завершен",
    toastAccountDeletedShort: "Аккаунт удален",
        btnSave: "Сохранить",
    topoStreamSse: "SSE поток",
    topoNormal: "Обычный",
    customModelsPart: "польз. моделей",
    tokenUnit: "токенов",
    phRgName: "напр. Группа-A",
    mcpAgentLabel: "Агент / Редактор",
    mcpTargetAuto: "Автоматически (по агенту)",
    mcpFixedServerName: "Фиксированное имя сервера:",
    mcpSectionDesc: "В этом разделе показаны все доступные агенты и редакторы. Выберите агента и модель для включения в конфигурацию MCP.",
    swarmSubtitle: "Выполнение задач через специализированные роли агентов, синтез результатов и управление маршрутизатором.",
    btnRunTask: "Запустить задачу",
    swarmRolesTitle: "Роли исполнения",
    swarmRolesSubtitle: "Разделение работы по специализациям",
    swarmRoleArchitect: "Архитектор",
    swarmRoleArchitectDesc: "Декомпозиция цели, определение структуры и этапов.",
    swarmRoleCoder: "Разработчик",
    swarmRoleCoderDesc: "Внесение изменений и написание программного кода.",
    swarmRoleReviewer: "Ревьюер",
    swarmRoleReviewerDesc: "Контроль качества кода, оценка рисков и замечания.",
    swarmRoleTester: "Тестировщик",
    swarmRoleTesterDesc: "Формирование тест-кейсов и проверка функционала.",
    swarmExecTitle: "Исполнение задачи",
    swarmExecSubtitle: "Отправка цели координатору мульти-агентов",
    swarmGoalLabel: "Цель",
    swarmGoalPlaceholder: "Опишите требуемую цель с контекстом или ограничениями.",
    swarmModeLabel: "Режим исполнения",
    swarmModeAuto: "Авто (Последовательно + Параллельно)",
    swarmModePipeline: "Последовательный",
    swarmModeParallel: "Параллельный",
    btnExecute: "Запустить",
    swarmModelLabel: "Модель этой роли",
    swarmModelAuto: "Умный авто (auto)",
    swarmGoalRequired: "Сначала укажите цель или задачу",
    swarmExecuting: "Выполняется...",
    swarmDispatching: "Координация и распределение задачи по агентам...",
    swarmConnFailed: "Не удалось подключиться к серверу",
    langOptAr: "Арабский (AR)",
    langOptEn: "Английский (EN)",
    langOptFr: "Французский (FR)",
    langOptRu: "Русский (RU)",
    langOptEs: "Испанский (ES)",
    langOptZh: "Китайский (ZH)",
    pulseLatency: "14ms (мгновенный импульс)"
  },
  es: {
    documentTitle: "EMO-AI Gateway — Panel de control y gestión de agentes",
    serviceToggleTitle: "Iniciar o detener la recepción de solicitudes en la pasarela",
    clearLogHint: "Borrar el registro de solicitudes mostrado",
    baseUrlLabel: "URL base:",
    apiKeyLabel: "Clave API:",
    metricPromptShort: "Entrada:",
    metricComplShort: "| Respuesta:",
    labelOpenAiBaseUrl: "URL base de OpenAI (/v1)",
    labelAnthropicBaseUrl: "URL base de Anthropic (Claude Code)",
    labelGeminiBaseUrl: "URL base de Gemini (Gemini CLI)",
    labelDefaultApiKey: "Clave API predeterminada",
    topoWrapperAria: "Topología de conexión en vivo: pulsa Tab para moverte entre nodos y resaltar las rutas de flujo",
    hubAriaLabel: "EMO-AI Gateway Core — pasarela central multiprotocolo",
    engineDesc: "",
    navOverview: "Panel general",
    navUsage: "Consumo y telemetría",
    navConnect: "Conectar agentes e IDEs",
    navProviders: "Proveedores y modelos",
    navAccounts: "Gestión de cuentas",
    navRouter: "Grupos de router",
    navKeys: "Claves API y proveedores",
    navSwarm: "Coordinador de agentes (Swarm)",
    sidebarToggleCollapse: "Contraer barra lateral",
    sidebarToggleExpand: "Expandir barra lateral",
    langLabel: "Idioma",
    themeToggleTitle: "Cambiar tema (Oscuro / Claro)",
    darkMode: "Modo oscuro",
    lightMode: "Modo claro",
    settingsTitle: "Ajustes",
    settingsClose: "Cerrar",
    appearanceLabel: "Apariencia",
    langAndAppearance: "Idioma y apariencia",
    appUpdateLabel: "Actualización de la app",
    currentVersionLabel: "Versión actual",
    checkUpdateBtn: "Buscar actualizaciones",
    connectionsLabel: "Conexiones",
    mcpConnection: "Conexión de agentes",
    toastCheckingUpdate: "Buscando actualizaciones...",
    toastAppUpToDate: "La aplicación está actualizada ({version})",
    settingsPageSubtitle: "Administra el idioma, la apariencia, la información de la app y la conexión de agentes",
    aboutAppLabel: "Acerca de la app",
    latestVersionLabel: "Última versión",
    agentConnectionSection: "Conexión de agentes",
    agentConnectionSettingsDesc: "Gestiona la conexión de agentes, incluida la configuración automática, manual y MCP.",
    openAgentConnectionBtn: "Configuración de conexión de agentes",
    connectTabAuto: "Automático",
    connectTabManual: "Manual",
    connectTabMcp: "MCP",
    mcpSetupTitle: "Configuración de MCP",
    mcpSetupDesc: "Crea la configuración MCP para el agente seleccionado, elige el destino y copia la configuración generada.",
    mcpTargetLabel: "Destino MCP",
    mcpServerNameLabel: "Nombre del servidor MCP",
    mcpConfigTitle: "Configuración MCP generada",
    mcpCopyConfig: "Copiar config MCP",
    mcpHintAgent: "Selecciona un agente y un modelo arriba para incluirlos en la configuración MCP.",
    manualConfigTitle: "Configuración manual (fragmento)",
    autoConfigSectionTitle: "Conexión automática del agente",
    identifierLabel: "Identificador:",
    endpointLabel: "Punto de enlace:",
    gatewayConnected: "Pasarela conectada",
    gatewayDisconnected: "Error de conexión",
    overviewTitle: "Panel maestro de control de pasarela",
    overviewSubtitle: "Centro unificado de control de estado de la pasarela, enrutamiento directo y telemetría",
    serviceRunning: "Servicio de pasarela activo",
    serviceStopped: "Servicio de pasarela pausado",
    btnStopService: "⏹ Detener",
    btnStartService: "▶ Reanudar",
    btnQuickRefresh: "Actualizar",
    btnQuickRefreshTitle: "Actualizar los datos ahora",
    btnRefreshing: "Actualizando…",
    toastRefreshed: "Datos actualizados",
    toastRefreshFailed: "No se pudieron actualizar los datos",
    btnCopy: "Copiar",
    copied: "¡Listo!",
    metricUptime: "Tiempo de actividad",
    metricLive: "● En vivo",
    metricSinceStart: "Desde el inicio del servicio",
    metricTotalTokens: "Tokens totales estimados",
    metricSuccessRate: "Tasa de éxito",
    metricCompletedOfPart: "completadas de",
    metricRequestsPart: "solicitudes",
    metricActiveProviders: "Proveedores y cuentas listos",
    metricActiveModelsPart: "modelos en rotación",
    topoLiveFlow: "Topología de conexiones en vivo",
    topoLivePulse: "Flujo activo",
    topoFlowStopped: "Flujo detenido",
    topoAutoSync: "Sincronizado cada 3s",
    topoInboundChannels: "canales entrantes",
    topoActiveProviders: "proveedores activos",
    topoPrivacyPath: "Ruta de privacidad efímera",
    topoPulseBtn: "Probar rutas",
    topoPulsing: "Comprobando...",
    topoAgentsTitle: "Agentes e IDEs de código",
    topoAgentsScanning: "Buscando herramientas instaladas...",
    topoHubTitle: "Núcleo central multiprotocolo",
    topoHubPortIn: "Puerto de recepción entrante",
    topoHubPortOut: "Puerto de salida a proveedores",
    topoHubUptime: "Tiempo de actividad de la pasarela",
    topoHubReqRate: "Tasa de solicitudes (por minuto)",
    topoHubReqRateUnit: "/m",
    topoHubLatency: "Latencia de respuesta y velocidad de red",
    topoProvidersTitle: "Proveedores y endpoints activos",
    topoProvidersLoading: "Cargando proveedores activos...",
    topoNoActiveProviders: "No hay proveedores activos actualmente",
    topoLiveNow: "En vivo",
    topoRecent: "Reciente",
    topoStandby: "En espera",
    topoInFlight: "En proceso",
    topoRouteTo: "Ruta",
    topoLiveRequests: "Solicitudes activas",
    topoServing: "Sirviendo",
    topoNoLiveAgents: "No hay canales activos — envíe una solicitud para visualizar el nodo de flujo",
    requestInFlight: "En curso…",
    topoCustom: "Personalizado",
    topoNoLiveProvs: "Ningún proveedor tiene una solicitud en curso — un proveedor aparece aquí solo mientras la está atendiendo realmente",
    topoWaitingRequests: "En espera de solicitudes",
    topoWaitingRequestsSub: "Las herramientas de desarrollo y agentes aparecen aquí en tiempo real al enviar solicitudes",
    topoWaitingProvs: "En espera de proveedores",
    topoWaitingProvsSub: "El proveedor que atiende la solicitud aparece aquí en tiempo real",
    topoLastProv: "Último proveedor",
    topoInteractionHint: "Interactivo: Pasa el cursor sobre cualquier nodo o usa Tab para resaltar los flujos.",
    topoLegendFlow: "Flujo estándar",
    topoLegendPrivacy: "Ruta de privacidad",
    topoLegendDormant: "Ruta inactiva",
    quickModelsTitle: "Modelos activos disponibles para tus herramientas",
    quickModelsSubtitle: "Haz clic en cualquier modelo para copiar su identificador",
    quickModelsEmpty: "No hay modelos activos. Selecciona modelos en la pestaña Proveedores y guarda.",
    consumptionTitle: "Telemetría de consumo y solicitudes en tiempo real",
    consumptionSubtitle: "Monitoreo granular de solicitudes entrantes, latencia, caracteres y tokens estimados",
    btnClearLog: "🗑 Limpiar registro",
    metricPromptChars: "Caracteres de prompt",
    metricComplChars: "Caracteres de respuesta",
    metricStreamReq: "Solicitudes en streaming",
    metricLifetimeReq: "Solicitudes totales desde el inicio",
    thTimestamp: "Hora",
    thAgent: "Agente cliente",
    thModel: "Modelo",
    thType: "Tipo",
    thTokens: "Tokens (est.)",
    thLatency: "Latencia",
    thStatus: "Estado",
    noRequestsRecorded: "No hay solicitudes registradas aún. Envía una consulta desde tu editor o agente (Cursor, Claude Code, OpenCode) para verla aquí en tiempo real.",
    connectTitle: "Conexión de agentes",
    connectSubtitle: "Gestiona la conexión de agentes con configuración automática, manual y MCP, incluyendo la selección del agente.",
    localAgentsListTitle: "Agentes e IDEs locales",
    installedOnDevice: "✓ Instalado en tu equipo",
    setupGuide: "Guía de configuración",
    selectSnippetModelLabel: "Modelo de destino en la configuración:",
    copyCodeBtn: "Copiar código",
    btnRescanAgents: "🔄 Buscar agentes en el dispositivo",
    btnAddCustomAgent: "+ Añadir agente manual",
    autoConnectTitle: "Configuración automática en un clic",
    autoConnectDesc: "Actualiza automáticamente el archivo de configuración de este agente con una copia de seguridad .bak",
    btnAutoConnect: "Configuración automática",
    btnDeleteCustomAgent: "Eliminar agente",
    modalAddCustomAgentTitle: "Añadir agente manualmente",
    labelAgentName: "Nombre del agente",
    phAgentName: "ej: Pi Agent o Agente personalizado",
    labelAgentId: "ID del agente (Slug)",
    phAgentId: "mi-agente",
    labelAgentProtocol: "Protocolo de conexión",
    labelAgentIcon: "Icono del agente (emoji o SVG)",
    phAgentIcon: "🤖",
    labelAgentCommand: "Comando / Ruta",
    phAgentCommand: "mi-agente o /ruta/al/agente",
    labelAgentConfigPath: "Ruta del archivo de configuración",
    phAgentConfigPath: "~/.config/mi-agente/config.json",
    labelAgentNotes: "Notas (opcional)",
    phAgentNotes: "Instrucciones adicionales para ejecutar este agente",
    btnSaveCustomAgent: "Guardar agente",
    agentCustom: "Personalizado",
    agentConfigured: "Configurado",
    scanningAgents: "Buscando...",
    scanningAgentsToast: "Buscando agentes y editores en el dispositivo...",
    agentsScanDone: "{count} agente(s) instalado(s) encontrado(s)",
    autoConnecting: "Conectando...",
    autoConnectSuccess: "Configuración automática exitosa",
    autoConnectFailed: "Error en la configuración automática",
    agentNotInstalledMsg: "Este agente no está instalado en tu dispositivo — instálalo primero e inténtalo de nuevo",
    noAgentSelected: "Por favor selecciona un agente primero",
    agentNameRequired: "El nombre del agente es obligatorio",
    agentSaved: "Agente personalizado guardado correctamente",
    agentDeleted: "Agente personalizado eliminado",
    notCustomAgent: "Este agente no es personalizado",
    confirmDeleteAgent: "¿Estás seguro de que deseas eliminar el agente {name}?",
    providersTitle: "Gestión de proveedores y modelos",
    providersSubtitle: "Iniciar/detener proveedores, comprobar latencia y cambiar cuentas",
    accountsTitle: "Gestión de múltiples cuentas",
    accountsSubtitle: "Administra cuentas por proveedor, cambia la sesión activa y añade nuevas cuentas",
    btnAddAccount: "+ Añadir nueva cuenta",
    thProvider: "Proveedor",
    thAccountName: "Nombre de cuenta",
    thEmail: "Correo electrónico",
    thLoginStatus: "Estado de acceso",
    thActiveStatus: "Cuenta activa",
    thActions: "Acciones",
    keysTitle: "Claves API y proveedores personalizados",
    keysSubtitle: "Genera tokens de acceso y conecta endpoints LLM externos a la pasarela",
    btnAddCustomKey: "+ Crear clave API",
    btnAddCustomProvider: "+ Añadir proveedor",
    routerTitle: "Grupos de enrutamiento",
    routerSubtitle: "Agrupa modelos de diferentes proveedores y cuentas bajo un mismo nombre con tolerancia a fallos o round-robin",
    routerHint: "El nombre del grupo se convierte en el nombre del modelo que envían los clientes. sequential prueba los destinos en orden ante fallos; round-robin distribuye las peticiones.",
    btnAddRouterGroup: "+ Nuevo grupo",
    rgModalCreateTitle: "Crear grupo de enrutamiento",
    rgModalEditTitle: "Editar grupo",
    rgNameLabel: "Nombre del grupo (nombre del modelo)",
    rgIconLabel: "Icono",
    rgStrategyLabel: "Estrategia",
    rgStrategySeq: "Secuencial (failover)",
    rgStrategyRR: "Round-robin (rotación)",
    rgTargetsLabel: "Destinos (orden = prioridad)",
    rgAddTarget: "+ Añadir destino",
    rgTargetsHint: "Fijar una cuenta cambia el perfil activo del proveedor si es necesario. Evita cuentas diferentes del mismo proveedor en round-robin.",
    rgNoGroups: "Aún no hay grupos. Crea uno para agrupar tus modelos favoritos.",
    rgTargetProvider: "Proveedor",
    rgTargetModel: "Modelo",
    rgTargetAccount: "Cuenta",
    rgAccountActive: "Cuenta activa (por defecto)",
    rgBtnTest: "Probar",
    rgBtnEdit: "Editar",
    rgBtnDelete: "Eliminar",
    rgEnabled: "Habilitado",
    rgDisabled: "Deshabilitado",
    rgTestOk: "Correcto",
    rgTestFail: "Error",
    rgSaved: "Grupo guardado",
    rgDeleted: "Grupo eliminado",
    rgDeleteConfirm: "¿Eliminar este grupo?",
    customKeysSectionTitle: "Claves de acceso autorizadas de la pasarela",
    customKeysSectionDesc: "Aceptadas en encabezados Authorization: Bearer, x-api-key y x-goog-api-key",
    thKeyName: "Nombre de la clave",
    thKeySecret: "Clave secreta",
    thCreated: "Creado el",
    thKeyStatus: "Estado",
    customProvidersSectionTitle: "Proveedores y endpoints upstream personalizados",
    customProvidersSectionDesc: "Integra DeepSeek, Ollama, OpenRouter, Groq directamente en la pasarela",
    modalAddKeyTitle: "Crear nueva clave API de pasarela",
    labelKeyName: "Nombre / Etiqueta de la clave",
    phKeyName: "ej.: Cursor-Work o ClaudeCode-Key",
    labelKeySecret: "Clave secreta (Dejar en blanco para autogenerar)",
    btnGenerateRandom: "Generar aleatorio",
    btnCancel: "Cancelar",
    btnSaveKey: "Guardar y activar clave",
    modalAddCpTitle: "Añadir proveedor API personalizado",
    modalEditCpTitle: "⚙️ Configuración y edición: ",
    labelCpName: "Nombre del proveedor (Nombre de servicio)",
    phCpName: "ej.: DeepSeek, Ollama Local u OpenRouter",
    labelCpUrl: "Base URL del endpoint (obtiene modelos automáticamente al ingresar URL y clave)",
    phCpUrl: "https://api.deepseek.com/v1 o http://localhost:11434/v1",
    labelCpKey: "Clave API del proveedor (para peticiones y consulta de modelos)",
    toggleKeyVisibility: "Mostrar / Ocultar clave",
    btnFetchModelsAuto: "🔄 Obtener modelos",
    labelCpModelsManagement: "Gestión de modelos (Automático + Manual)",
    cpFetchHint: "Ingresa la URL y la clave para obtener modelos o agrégalos manualmente",
    labelCpModelsListSelect: "Modelos descubiertos (Marca los que deseas activar):",
    btnSelectAll: "Seleccionar todo",
    btnDeselectAll: "Deseleccionar todo",
    phCpManualSingle: "Añadir modelo manualmente (ej. deepseek-reasoner)",
    btnAddManualModel: "+ Añadir",
    labelCpApprovedModels: "Lista de modelos aprobados (separados por coma):",
    phCpModels: "deepseek-chat, deepseek-reasoner",
    btnSaveCustomProv: "Guardar proveedor",
    modalAddAccTitle: "Añadir nueva cuenta al proveedor",
    labelSelectProvider: "Proveedor de destino",
    labelAccountName: "Nombre de la cuenta (Opcional)",
    phAccountName: "ej.: Cuenta de trabajo o Personal",
    labelAccountEmail: "Correo electrónico",
    btnSaveAccount: "Guardar cuenta",
    modalAccountDetailTitle: "Detalles de la cuenta",
    labelProvider: "Proveedor:",
    labelName: "Nombre:",
    labelEmail: "Correo:",
    labelLoginState: "Estado de inicio:",
    labelProfilePath: "Ruta del perfil:",
    btnDelete: "Eliminar",
    btnSetAsActive: "Establecer como activa",
    btnLogin: "Iniciar sesión",
    toastCopiedBaseUrl: "Base URL copiada",
    toastCopiedApiKey: "Clave API copiada",
    toastSettingsCopied: "Configuración copiada con éxito",
    toastCopied: "Copiado: ",
    toastFlowPulse: "Rutas de conexión actuales comprobadas",
    toastServiceResumed: "Servicio de pasarela reanudado con éxito",
    toastServicePaused: "Servicio de pasarela pausado temporalmente",
    toastServiceToggleFailed: "Error al cambiar estado del servicio: ",
    toastLogCleared: "Registro de solicitudes limpiado con éxito",
    toastLogClearFailed: "Error al limpiar registro: ",
    toastKeyCreated: "Nueva clave API creada con éxito",
    toastKeyDeleted: "Clave eliminada",
    toastKeyActivated: "Clave activada",
    toastKeyDeactivated: "Clave desactivada",
    toastKeyCopied: "Clave copiada con éxito",
    toastAccountAdded: "Cuenta añadida con éxito",
    toastAccountDeleted: "Cuenta eliminada: ",
    toastAccountActivated: "Cuenta activada con éxito",
    statusRunning: "En ejecución",
    statusStarting: "Iniciando...",
    statusStopped: "Detenido",
    statusError: "Error",
    statusActive: "Activo",
    statusDisabled: "Desactivado",
    statusLoggedIn: "Conectado",
    statusNotLoggedIn: "No conectado",
    statusActiveAccountBadge: "✓ Cuenta activa actual",
    statusDormantAccountBadge: "Inactivo",
    statusDefaultKey: "Clave por defecto",
    statusSystemMasterKey: "Clave maestra del sistema",
    btnManage: "Gestionar",
    btnActivate: "Activar",
    btnDeactivate: "Desactivar",
    btnEnable: "Activar",
    btnDisable: "Desactivar",
    btnStart: "▶ Iniciar",
    btnStop: "⏹ Detener",
    btnSaveModels: "💾 Guardar modelos",
    btnRefreshModels: "🔄 Actualizar",
    btnFetchModelsLive: "Obtener modelos",
    btnLoadCatalog: "Recargar catálogo",
    btnDiscoveryUnsupported: "No compatible",
    btnTestConnection: "Probar conexión",
    btnTestConnectionUnsupported: "Prueba de conexión no compatible",
    btnWorking: "Trabajando…",
    notifCenterTitle: "Cambios de modelos",
    notifCenterSub: "Aquí se informa de cada cambio detectado por el escaneo en vivo",
    notifMarkAll: "Marcar todo como leído",
    notifMarkRead: "Marcar leído",
    notifEmpty: "Aún no hay cambios de modelos.",
    notifUnread: "{count} sin leer",
    notifOpenCard: "Abrir la tarjeta del proveedor",
    notifDetectedAt: "Detectado el: {ts}",
    notifSourceLabel: "Fuente",
    notifCardNotFound: "La tarjeta del proveedor no está visible en la página actual.",
    notifTypeModelAdded: "Nuevo modelo detectado",
    notifTypeModelRemoved: "Modelo eliminado",
    notifTypeModelRenamed: "Modelo renombrado",
    notifTypeModelMetadata: "Metadatos del modelo modificados",
    notifTypeModelRestored: "Modelo eliminado anteriormente restaurado",
    discoveryNeverScanned: "Descubrimiento en vivo: nunca analizado",
    discoveryActive: "Descubrimiento en vivo: activo",
    discoveryUnsupported: "Descubrimiento en vivo: no compatible",
    discoveryNeedsLogin: "Descubrimiento en vivo: requiere iniciar sesión",
    discoveryDeferred: "Descubrimiento en vivo: aplazado",
    discoveryError: "Descubrimiento en vivo: error",
    discoveryModelsFound: "{count} modelos detectados",
    discoveryNewModels: "+{count} nuevo(s)",
    discoveryLastScan: "Último análisis correcto: {ts}",
    modelsSourceLiveWebUi: "Descubrimiento en vivo en el sitio del proveedor",
    btnDiscoverModels: "Obtener modelos",
    btnDiscoverModelsHint: "Lee la lista de modelos del sitio del proveedor",
    btnCheckChanges: "Comprobar cambios",
    btnViewChanges: "Ver cambios",
    toastDiscoveryDone: "Se detectaron {count} modelo(s) ({newCount} nuevo(s))",
    toastDiscoveryChanges: "{count} cambio(s) de modelo",
    toastDiscoveryFailed: "Error en el descubrimiento: {error}",
    toastDiscoveryDeferred: "Descubrimiento aplazado: {reason}",
    toastNoChanges: "No se detectaron cambios de modelos.",
    modelsSourceLabel: "Fuente",
    modelsSourceConfiguredCatalog: "Catálogo configurado — no es descubrimiento en vivo",
    modelsSourceLiveApi: "Descubrimiento en vivo vía el endpoint /models",
    modelsSourceNone: "Sin fuente",
    modelsLastRefreshAt: "Última sincronización: {ts}",
    modelsNeverRefreshed: "Nunca sincronizado",
    modelsStaleBadge: "no disponible",
    modelsDiscoveryUnsupportedNote: "Este proveedor no admite descubrimiento de modelos: el botón está desactivado.",
    modelsCatalogNotLiveNote: "La lista es un catálogo configurado en la pasarela, no un descubrimiento en vivo del sitio del proveedor.",
    connStatusLabel: "Conexión",
    connStatusConnected: "Conectado",
    connStatusAuthenticationRequired: "Requiere iniciar sesión",
    connStatusRateLimited: "Limitado por tasa",
    connStatusQuotaExhausted: "Cuota agotada",
    connStatusProviderUnavailable: "Proveedor no disponible",
    connStatusBrowserUnavailable: "Navegador no disponible",
    connStatusTimeout: "Tiempo agotado",
    connStatusUnsupported: "No compatible",
    connStatusUnknown: "Desconocido",
    connStatusNeverChecked: "Aún no comprobado",
    connLastCheckAt: "Última comprobación: {ts}",
    connCheckWebProfile: "Comprueba la disponibilidad del sitio, del navegador y la sesión guardada",
    connCheckApiHealth: "Comprueba el endpoint health/models del proveedor (sin peticiones de pago)",
    connTestUnsupportedNote: "No hay una comprobación de conexión real para este tipo de proveedor.",
    toastModelsRefreshedCount: "Se actualizaron {count} modelo(s) ({source})",
    toastModelsRefreshFailed: "Error al actualizar los modelos: {error}",
    toastModelsPruned: "Se eliminaron {count} modelo(s) seleccionados no disponibles",
    toastConnectionResult: "Prueba de conexión: {status} ({ms}ms)",
    toastConnectionFailed: "Error en la prueba de conexión: {error}",
    btnCheckPing: "⚡ Probar ping",
    btnOpenBrowser: "🔑 Abrir navegador",
    toggleHeadlessLabel: "🖥️ Navegador invisible (Headless)",
    togglePrivacyLabel: "🛡️ Modo privacidad",
    filterShowAll: "🌐 Ver todos",
    filterShowEnabled: "Proveedores activados",
    filterProvidersHeader: "Filtro de proveedores:",
    filterProvidersSub: "Selecciona uno o más proveedores o haz clic en \\\"Ver todos\\\" o \\\"Proveedores activados\\\"",
    filterShownCountAll: "Mostrando: Todos",
    filterClear: "✕ Borrar filtro (Ver todos)",
    filterAccountsAll: "Todos los proveedores",
    noAccountsFound: "No hay cuentas añadidas para este proveedor. Haz clic en '+ Añadir nueva cuenta'.",
    noCustomProvidersFound: "No hay proveedores personalizados aún. Haz clic en '+ Añadir proveedor' para conectar DeepSeek, Ollama u OpenRouter.",
    agentActive: "Activo",
    agentInstalled: "Instalado",
    agentGuide: "Guía",
    availableModelsCount: "Modelos disponibles",
    registeredAccounts: "Cuentas registradas:",
    noAccountsRegistered: "Sin cuentas añadidas",
    activeAccountPill: "(Activo)",
    addAccountBtnShort: "+ Cuenta",
    unnamedAccount: "Cuenta sin nombre",
    customSettingsBtn: "Ajustes",
    customEditKeyModels: "Editar clave / modelos",
    customApiKeySaved: "🔑 Clave API guardada",
    customNoApiKey: "Sin clave API",
    activeModelsListLabel: "Modelos activos",
    typeStream: "Stream",
    typeSync: "Síncrono",
    unknownClient: "Cliente no especificado",
    pathLabel: "Ruta:",
    editorReady: "Editor listo para conectar con la pasarela",
    filterPillTitle: "Haz clic para mostrar o añadir {name} a la vista actual",
    filterShownCount: "Mostrando {shown} de {total} proveedores",
    chipSwitchTitle: "Haz clic para activar esta cuenta",
    chipDeleteTitle: "Eliminar esta cuenta",
    agentPortTitle: "Puerto de salida del agente",
    headlessHint: "Ejecutar el navegador en segundo plano sin ventana visible para ahorrar recursos",
    privacyHint: "Activar modo privacidad con chats efímeros para no guardar historial en los servidores del proveedor",
    privacyModeNote: "Modo privado = chat temporal: las herramientas, la generación de imágenes y las funciones especiales no funcionan allí, y no se guarda historial en el proveedor.",
    privacyModeNoteGeneric: "Modo privado: el historial no se guarda en el proveedor y algunas herramientas o funciones especiales pueden no funcionar.",
    pingHint: "Probar la conexión y la velocidad de respuesta de este proveedor",
    btnAllShort: "Todos",
    btnNoneShort: "Ninguno",
    noModelsYet: "Aún no hay modelos. Inicia sesión o pulsa Obtener para cargarlos.",
    toastHeadlessEnabled: "Modo headless activado para {id}",
    toastHeadlessDisabled: "Modo headless desactivado para {id}",
    toastPrivacyEnabled: "Modo privacidad activado para {id}",
    toastPrivacyDisabled: "Modo privacidad desactivado para {id}",
    toastAccSwitched: "Cuenta seleccionada activada con éxito",
    toastProviderStarted: "{id} iniciado",
    toastProviderStopped: "{id} detenido",
    toastModelsSaved: "Modelos guardados para {id}",
    toastModelsRefreshed: "Lista de modelos actualizada",
    toastBrowserOpening: "Abriendo el navegador para iniciar sesión...",
    toastLoginComplete: "Sesión de acceso completada",
    toastProviderEnabled: "Proveedor activado",
    toastProviderDisabled: "Proveedor desactivado",
    snipEnvSetup: "# 1. Define la URL de la pasarela y la clave de acceso en la terminal:",
    snipRunClaude: "# 2. Ejecuta Claude Code a través de la pasarela local:",
    snipCursorModels: "// En los ajustes de {name} > Models > OpenAI API:",
    snipVsCode: "// En los ajustes de VS Code (settings.json o extensiones Cline / Continue):",
    snipPythonOpenAI: "# Python con el protocolo estándar OpenAI:",
    snipPythonAnthropic: "# O usa directamente el SDK oficial de Anthropic:",
    snipPythonHello: "¡Hola desde código Python!",
    snipHello: "Hola",
    snipGeminiSetup: "# Configurar el protocolo nativo Gemini (/v1beta):",
    snipGeminiCurl: "# O mediante cURL con la cabecera x-goog-api-key:",
    snipGeminiHello: "¡Hola!",
    snipHermesSetup: "# Configurar Hermes Agent para usar la pasarela local:",
    snipCallAgent: "# Llama al agente directamente:",
    snipEnvVarsAlt: "# O mediante variables de entorno:",
    snipThenRun: "# Luego ejecuta:",
    defaultKeyCreatedAt: "Predeterminado",
    cpNoModelsYet: "Aún no hay modelos seleccionados: abre los ajustes para obtenerlos del servidor o añadirlos manualmente",
    cpVerifyHint: "Prueba real de conexión y validación de la clave API con el servidor",
    cpVerifyBtn: "🔌 Verificar conexión",
    cpSettingsHint: "Ajustes del proveedor: editar la clave y la URL, obtener o añadir modelos",
    keyNameRequired: "Introduce un nombre para identificar la clave",
    cpVerifying: "⏳ Verificando...",
    verifyServerOk: "Conexión con el servidor correcta",
    verifyServerFailed: "Error de conexión con el servidor",
    cpVerifyLoading: "Conectando con el servidor y validando la clave API...",
    verifyOk: "Conexión correcta",
    verifyFail: "Conexión fallida",
    baseUrlRequiredVerify: "Introduce primero la Base URL para verificar la conexión",
    cpVerifyChecking: "Comprobando la conexión real con el servidor y validando la clave API...",
    cpVerifyCheckingShort: "⏳ Comprobando conexión...",
    cpFetchedDuringVerify: "Se obtuvieron {count} modelos reales del servidor durante la comprobación",
    verifyCheckFailed: "Error al verificar la conexión",
    baseUrlRequired: "Introduce primero la Base URL",
    cpFetchingBanner: "Conectando con el endpoint /models del servidor para obtener modelos reales...",
    cpFetchingLive: "⏳ Obteniendo modelos reales del servidor...",
    cpFetchingShort: "⏳ Obteniendo del servidor...",
    cpFetchedReal: "Se obtuvieron {count} modelos reales directamente del servidor",
    cpFetchFailed: "No se pudo contactar con el servidor para obtener modelos",
    btnFetchReal: "🔄 Obtener modelos del servidor",
    sourceServer: "🌐 del servidor",
    sourceManual: "✍️ añadido",
    modelNameRequired: "Escribe un nombre de modelo para añadirlo",
    manualModelAdded: "Modelo añadido manualmente ({count} seleccionados)",
    cpSaveSettings: "💾 Guardar ajustes",
    cpVerifyFetchHint: "Usa el botón Verificar conexión o el botón Obtener modelos del servidor",
    nameUrlRequired: "El nombre y la Base URL son obligatorios",
    cpSavedSettings: "Ajustes del proveedor guardados ({count} modelos activados)",
    cpAddedSuccess: "Proveedor personalizado añadido con éxito ({count} modelos activados)",
    toastProviderDeleted: "Proveedor eliminado",
    emailRequired: "El correo electrónico es obligatorio",
    manageAccountTitle: "Gestionar {name}",
    noNameLabel: "Sin nombre",
    defaultAccountName: "Cuenta predeterminada",
    activeBrowserSession: "Sesión de navegador activa",
    accountActiveNow: "✓ La cuenta ya está activa",
    toastLoginWindow: "Abriendo la ventana de acceso para esta cuenta...",
    toastLoginDone: "Acceso completado",
    toastAccountDeletedShort: "Cuenta eliminada",
        btnSave: "Guardar",
    topoStreamSse: "Flujo SSE",
    topoNormal: "Estándar",
    customModelsPart: "modelos personalizados",
    tokenUnit: "tokens",
    phRgName: "ej. Grupo-A",
    mcpAgentLabel: "Agente / Editor",
    mcpTargetAuto: "Automático (por agente)",
    mcpFixedServerName: "Nombre de servidor fijo:",
    mcpSectionDesc: "Esta sección muestra todos los agentes y editores disponibles. Selecciona un agente y modelo para incluirlos en la configuración MCP.",
    swarmSubtitle: "Ejecución de tareas mediante roles especializados de agentes, síntesis de resultados y gestión de grupos de enrutamiento.",
    btnRunTask: "Ejecutar tarea",
    swarmRolesTitle: "Roles de ejecución",
    swarmRolesSubtitle: "División del trabajo por especialidad",
    swarmRoleArchitect: "Arquitecto",
    swarmRoleArchitectDesc: "Descomponer el objetivo y definir la arquitectura y los pasos.",
    swarmRoleCoder: "Programador",
    swarmRoleCoderDesc: "Aplicar cambios y escribir código fuente.",
    swarmRoleReviewer: "Revisor",
    swarmRoleReviewerDesc: "Revisión de calidad de código, riesgos y observaciones.",
    swarmRoleTester: "Tester",
    swarmRoleTesterDesc: "Proponer casos de prueba y verificar el funcionamiento.",
    swarmExecTitle: "Ejecución de tarea",
    swarmExecSubtitle: "Enviar un objetivo al coordinador de agentes",
    swarmGoalLabel: "Objetivo",
    swarmGoalPlaceholder: "Describe el objetivo a ejecutar, con contexto o restricciones.",
    swarmModeLabel: "Modo de ejecución",
    swarmModeAuto: "Automático (Secuencial + Paralelo)",
    swarmModePipeline: "Secuencial",
    swarmModeParallel: "Paralelo",
    btnExecute: "Ejecutar",
    swarmModelLabel: "Modelo de este rol",
    swarmModelAuto: "Auto inteligente (auto)",
    swarmGoalRequired: "Por favor escribe un objetivo o tarea primero",
    swarmExecuting: "Ejecutando...",
    swarmDispatching: "Coordinando y distribuyendo la tarea entre agentes...",
    swarmConnFailed: "Error al conectar con el servidor",
    langOptAr: "Árabe (AR)",
    langOptEn: "Inglés (EN)",
    langOptFr: "Francés (FR)",
    langOptRu: "Ruso (RU)",
    langOptEs: "Español (ES)",
    langOptZh: "Chino (ZH)",
    pulseLatency: "14ms (pulso instantáneo)"
  },
  zh: {
    documentTitle: "EMO-AI Gateway — 控制面板与智能体管理",
    serviceToggleTitle: "启动或停止网关接收请求",
    clearLogHint: "清空当前显示的请求日志",
    baseUrlLabel: "Base URL：",
    apiKeyLabel: "API 密钥：",
    metricPromptShort: "输入：",
    metricComplShort: "| 输出：",
    labelOpenAiBaseUrl: "OpenAI Base URL（/v1）",
    labelAnthropicBaseUrl: "Anthropic Base URL（Claude Code）",
    labelGeminiBaseUrl: "Gemini Base URL（Gemini CLI）",
    labelDefaultApiKey: "默认 API 密钥",
    topoWrapperAria: "实时连接拓扑：使用 Tab 在节点间移动并高亮数据流路径",
    hubAriaLabel: "EMO-AI Gateway Core — 多协议中央网关",
    engineDesc: "",
    navOverview: "总览仪表盘",
    navUsage: "用量与请求遥测",
    navConnect: "智能体与编辑器连接",
    navProviders: "提供商与模型",
    navAccounts: "多账号管理",
    navRouter: "路由组",
    navKeys: "API 密钥与自定义网关",
    navSwarm: "代理群调度器 (Swarm)",
    sidebarToggleCollapse: "折叠侧边栏",
    sidebarToggleExpand: "展开侧边栏",
    langLabel: "语言",
    themeToggleTitle: "切换主题（深色 / 浅色）",
    darkMode: "深色模式",
    lightMode: "浅色模式",
    settingsTitle: "设置",
    settingsClose: "关闭",
    appearanceLabel: "外观",
    langAndAppearance: "语言和外观",
    appUpdateLabel: "应用更新",
    currentVersionLabel: "当前版本",
    checkUpdateBtn: "检查更新",
    connectionsLabel: "连接",
    mcpConnection: "连接智能体",
    toastCheckingUpdate: "正在检查更新...",
    toastAppUpToDate: "应用已是最新版本 ({version})",
    settingsPageSubtitle: "管理语言、外观、应用信息和智能体连接",
    aboutAppLabel: "关于应用",
    latestVersionLabel: "最新版本",
    agentConnectionSection: "智能体连接",
    agentConnectionSettingsDesc: "管理智能体连接，包括自动、手动和 MCP 配置。",
    openAgentConnectionBtn: "智能体连接设置",
    connectTabAuto: "自动连接",
    connectTabManual: "手动连接",
    connectTabMcp: "MCP 连接",
    mcpSetupTitle: "MCP 设置与配置",
    mcpSetupDesc: "为所选智能体创建 MCP 配置，选择集成目标，然后复制生成的配置。",
    mcpTargetLabel: "MCP 目标",
    mcpServerNameLabel: "MCP 服务器名称",
    mcpConfigTitle: "生成的 MCP 配置",
    mcpCopyConfig: "复制 MCP 配置",
    mcpHintAgent: "请在上方选择智能体和模型，以将其包含在 MCP 配置中。",
    manualConfigTitle: "手动配置（代码片段）",
    autoConfigSectionTitle: "智能体自动连接",
    identifierLabel: "标识符：",
    endpointLabel: "端点：",
    gatewayConnected: "网关在线",
    gatewayDisconnected: "连接错误",
    overviewTitle: "网关综合管理总览",
    overviewSubtitle: "网关服务状态、智能体与提供商直连路由以及实时用量遥测的统一管理中心",
    serviceRunning: "网关服务运行正常",
    serviceStopped: "网关服务已暂停",
    btnStopService: "⏹ 停止服务",
    btnStartService: "▶ 恢复服务",
    btnQuickRefresh: "即时刷新",
    btnQuickRefreshTitle: "立即刷新数据",
    btnRefreshing: "正在刷新…",
    toastRefreshed: "数据已刷新",
    toastRefreshFailed: "无法刷新数据",
    btnCopy: "复制",
    copied: "已复制!",
    metricUptime: "运行时间 (Uptime)",
    metricLive: "● 实时",
    metricSinceStart: "自服务启动以来",
    metricTotalTokens: "预估总 Token",
    metricSuccessRate: "请求成功率 (Success Rate)",
    metricCompletedOfPart: "完成 / 共",
    metricRequestsPart: "次请求",
    metricActiveProviders: "就绪的提供商与账号",
    metricActiveModelsPart: "个轮换中模型",
    topoLiveFlow: "实时连接拓扑流 (Connection Topology Flow)",
    topoLivePulse: "实时流",
    topoFlowStopped: "拓扑流停止",
    topoAutoSync: "每 3 秒自动同步",
    topoInboundChannels: "入站通道",
    topoActiveProviders: "活跃提供商",
    topoPrivacyPath: "临时隐私通道",
    topoPulseBtn: "检查路由",
    topoPulsing: "检查中...",
    topoAgentsTitle: "智能体与代码编辑器",
    topoAgentsScanning: "正在扫描已安装的工具...",
    topoHubTitle: "多协议中心路由网关",
    topoHubPortIn: "入站接收端口",
    topoHubPortOut: "出站提供商端口",
    topoHubUptime: "网关运行时间",
    topoHubReqRate: "请求速率（每分钟）",
    topoHubReqRateUnit: "/分",
    topoHubLatency: "响应延迟与网络速度",
    topoProvidersTitle: "活跃的上游提供商与端点",
    topoProvidersLoading: "正在加载活跃提供商...",
    topoNoActiveProviders: "当前没有启用的提供商",
    topoLiveNow: "实时中",
    topoRecent: "最近活跃",
    topoStandby: "待命就绪",
    topoInFlight: "正在处理",
    topoRouteTo: "路由至",
    topoLiveRequests: "流动请求",
    topoServing: "正在服务",
    topoNoLiveAgents: "当前没有活跃通道 — 请通过客户端发送请求以显示实时流节点",
    requestInFlight: "进行中…",
    topoCustom: "自定义",
    topoNoLiveProvs: "当前没有提供商正在处理进行中的请求 — 只有在真正处理请求时，提供商才会显示在此处",
    topoWaitingRequests: "等待请求流量",
    topoWaitingRequestsSub: "发送AI请求时，开发工具和智能体将在此实时呈现",
    topoWaitingProvs: "等待上游提供商",
    topoWaitingProvsSub: "处理请求的服务商将在流式处理期间实时显示在此处",
    topoLastProv: "最近提供商",
    topoInteractionHint: "交互：鼠标悬停或使用 Tab 键导航任何节点以高亮连线路径。",
    topoLegendFlow: "标准流",
    topoLegendPrivacy: "隐私流",
    topoLegendDormant: "休眠流",
    quickModelsTitle: "工具中立即可调用的已启用模型",
    quickModelsSubtitle: "点击任意模型可精准复制名称",
    quickModelsEmpty: "当前无活跃模型。请在“提供商”标签中勾选模型并点击保存。",
    consumptionTitle: "用量日志与实时请求遥测",
    consumptionSubtitle: "精准监控所有入站请求、响应延迟、字符用量与预估 Token",
    btnClearLog: "🗑 清空日志",
    metricPromptChars: "提示词字符 (Prompt Chars)",
    metricComplChars: "生成补全字符 (Completion Chars)",
    metricStreamReq: "流式传输请求 (Streaming)",
    metricLifetimeReq: "启动以来的历史总请求数",
    thTimestamp: "时间",
    thAgent: "发起客户端/智能体",
    thModel: "模型",
    thType: "类型",
    thTokens: "预估 Token",
    thLatency: "处理耗时",
    thStatus: "状态",
    noRequestsRecorded: "暂无记录的请求。请从编辑器或智能体（Cursor、Claude Code、OpenCode）发送请求以在此查看实时遥测。",
    connectTitle: "连接智能体",
    connectSubtitle: "通过自动、手动和 MCP 方式管理智能体连接，并支持选择智能体进行配置。",
    localAgentsListTitle: "本地智能体与编辑器",
    installedOnDevice: "✓ 已安装于本机",
    setupGuide: "配置指南",
    selectSnippetModelLabel: "配置片段中的目标模型：",
    copyCodeBtn: "复制代码",
    btnRescanAgents: "🔄 搜索设备上的代理",
    btnAddCustomAgent: "+ 手动添加代理",
    autoConnectTitle: "一键自动连接",
    autoConnectDesc: "自动更新此代理的配置文件，并创建 .bak 备份",
    btnAutoConnect: "自动连接",
    btnDeleteCustomAgent: "删除代理",
    modalAddCustomAgentTitle: "手动添加代理",
    labelAgentName: "代理名称",
    phAgentName: "例如：Pi Agent 或自定义代理",
    labelAgentId: "代理 ID (Slug)",
    phAgentId: "my-agent",
    labelAgentProtocol: "连接协议",
    labelAgentIcon: "代理图标 (emoji 或 SVG)",
    phAgentIcon: "🤖",
    labelAgentCommand: "命令 / 路径",
    phAgentCommand: "my-agent 或 /path/to/agent",
    labelAgentConfigPath: "配置文件路径",
    phAgentConfigPath: "~/.config/my-agent/config.json",
    labelAgentNotes: "备注（可选）",
    phAgentNotes: "运行此代理的其他说明",
    btnSaveCustomAgent: "保存代理",
    agentCustom: "自定义",
    agentConfigured: "已配置",
    scanningAgents: "正在搜索...",
    scanningAgentsToast: "正在设备上搜索代理和编辑器...",
    agentsScanDone: "找到 {count} 个已安装的代理",
    autoConnecting: "正在连接...",
    autoConnectSuccess: "自动连接成功",
    autoConnectFailed: "自动连接失败",
    agentNotInstalledMsg: "该智能体未安装在您的设备上 — 请先安装后再尝试连接",
    noAgentSelected: "请先选择一个代理",
    agentNameRequired: "代理名称必填",
    agentSaved: "自定义代理保存成功",
    agentDeleted: "自定义代理已删除",
    notCustomAgent: "此代理不是自定义代理",
    confirmDeleteAgent: "确定要删除代理 {name} 吗？",
    providersTitle: "提供商与模型管理",
    providersSubtitle: "启停提供商、即时连接测速与多账号热切换",
    accountsTitle: "多账号集成管理",
    accountsSubtitle: "为各提供商管理账号、无缝切换活跃身份并随时绑定新账号",
    btnAddAccount: "+ 添加新账号",
    thProvider: "提供商",
    thAccountName: "账号名称",
    thEmail: "电子邮件",
    thLoginStatus: "登录状态",
    thActiveStatus: "当前生效账号",
    thActions: "操作",
    keysTitle: "API 密钥与自定义网关管理",
    keysSubtitle: "生成网关访问密钥，并手动直连接入外部第三方 LLM 服务端点",
    btnAddCustomKey: "+ 创建新 API 密钥",
    btnAddCustomProvider: "+ 添加自定义上游",
    routerTitle: "路由组管理",
    routerSubtitle: "将不同提供商和账户的模型整合在唯一定义下，支持故障转移（Failover）或轮询调度",
    routerHint: "组名称将作为客户端调用的 model 参数。sequential 在遇到错误时按顺序顺延；round-robin 则按请求轮流分发。",
    btnAddRouterGroup: "+ 新建路由组",
    rgModalCreateTitle: "创建路由组",
    rgModalEditTitle: "编辑路由组",
    rgNameLabel: "组名称（模型名）",
    rgIconLabel: "图标",
    rgStrategyLabel: "分发策略",
    rgStrategySeq: "按顺序故障转移（Sequential）",
    rgStrategyRR: "轮询调度（Round-robin）",
    rgTargetsLabel: "目标列表（顺序即优先级）",
    rgAddTarget: "+ 添加目标",
    rgTargetsHint: "固定特定账户将在需要时自动切换提供商活动配置。在 round-robin 模式下尽量避免为同一提供商配置多个不同账户。",
    rgNoGroups: "暂无路由组。创建一个以组合您常用的模型。",
    rgTargetProvider: "提供商",
    rgTargetModel: "模型",
    rgTargetAccount: "账户",
    rgAccountActive: "当前活动账户（默认）",
    rgBtnTest: "测试",
    rgBtnEdit: "编辑",
    rgBtnDelete: "删除",
    rgEnabled: "已启用",
    rgDisabled: "已禁用",
    rgTestOk: "正常",
    rgTestFail: "失败",
    rgSaved: "路由组已保存",
    rgDeleted: "路由组已删除",
    rgDeleteConfirm: "确定要删除此路由组吗？",
    customKeysSectionTitle: "网关授权访问密钥 (Authorized Access Keys)",
    customKeysSectionDesc: "支持 Authorization: Bearer、x-api-key 及 x-goog-api-key 请求头",
    thKeyName: "密钥名称",
    thKeySecret: "密钥值",
    thCreated: "创建时间",
    thKeyStatus: "状态",
    customProvidersSectionTitle: "手动配置的自定义上游提供商 (Custom Upstreams)",
    customProvidersSectionDesc: "将 DeepSeek、Ollama、OpenRouter、Groq 等直接汇聚至网关中",
    modalAddKeyTitle: "创建网关新 API 密钥",
    labelKeyName: "密钥名称 / 标识标签",
    phKeyName: "例如：Cursor-Work 或 ClaudeCode-Key",
    labelKeySecret: "密钥值（留空则自动生成）",
    btnGenerateRandom: "随机生成",
    btnCancel: "取消",
    btnSaveKey: "保存并激活密钥",
    modalAddCpTitle: "手动添加自定义 API 提供商",
    modalEditCpTitle: "⚙️ 提供商设置与修改：",
    labelCpName: "提供商名称 (Service Name)",
    phCpName: "例如：DeepSeek、Ollama Local 或 OpenRouter",
    labelCpUrl: "服务端点 Base URL（输入链接与密钥后将自动拉取模型列表）",
    phCpUrl: "https://api.deepseek.com/v1 或 http://localhost:11434/v1",
    labelCpKey: "提供商 API 密钥（用于请求转发及自动获取可用模型）",
    toggleKeyVisibility: "显示 / 隐藏密钥",
    btnFetchModelsAuto: "🔄 获取模型",
    labelCpModelsManagement: "模型管理（自动抓取 + 手动输入）",
    cpFetchHint: "输入 Base URL 和 API 密钥以拉取模型列表，或手动添加模型",
    labelCpModelsListSelect: "发现的模型列表（勾选需要启用的模型）：",
    btnSelectAll: "全选",
    btnDeselectAll: "取消全选",
    phCpManualSingle: "手动输入单个模型（例如：deepseek-reasoner）",
    btnAddManualModel: "+ 手动添加",
    labelCpApprovedModels: "最终生效的模型列表（以逗号分隔）：",
    phCpModels: "deepseek-chat, deepseek-reasoner",
    btnSaveCustomProv: "保存提供商",
    modalAddAccTitle: "为提供商添加新账号",
    labelSelectProvider: "目标提供商",
    labelAccountName: "账号备注名称（选填）",
    phAccountName: "例如：工作账号或个人备用账号",
    labelAccountEmail: "电子邮箱",
    btnSaveAccount: "保存账号",
    modalAccountDetailTitle: "账号详细信息",
    labelProvider: "提供商：",
    labelName: "名称：",
    labelEmail: "邮箱：",
    labelLoginState: "登录状态：",
    labelProfilePath: "用户数据目录：",
    btnDelete: "删除",
    btnSetAsActive: "设为当前生效账号",
    btnLogin: "登录账号",
    toastCopiedBaseUrl: "已复制 Base URL",
    toastCopiedApiKey: "已复制 API 密钥",
    toastSettingsCopied: "配置代码已成功复制",
    toastCopied: "已复制: ",
    toastFlowPulse: "已检查当前连接路由",
    toastServiceResumed: "网关服务已成功恢复运行",
    toastServicePaused: "网关服务已暂停",
    toastServiceToggleFailed: "切换服务状态失败：",
    toastLogCleared: "已成功清空请求记录",
    toastLogClearFailed: "清空日志失败：",
    toastKeyCreated: "新 API 密钥创建成功",
    toastKeyDeleted: "已删除密钥",
    toastKeyActivated: "密钥已启用",
    toastKeyDeactivated: "密钥已禁用",
    toastKeyCopied: "密钥已成功复制",
    toastAccountAdded: "账号添加成功",
    toastAccountDeleted: "已删除账号：",
    toastAccountActivated: "账号已激活生效",
    statusRunning: "运行中",
    statusStarting: "正在启动...",
    statusStopped: "已停止",
    statusError: "错误",
    statusActive: "已启用",
    statusDisabled: "已禁用",
    statusLoggedIn: "已登录",
    statusNotLoggedIn: "未登录",
    statusActiveAccountBadge: "✓ 当前路由目标",
    statusDormantAccountBadge: "待命",
    statusDefaultKey: "默认主密钥 (Default Key)",
    statusSystemMasterKey: "系统主密钥",
    btnManage: "管理",
    btnActivate: "激活",
    btnDeactivate: "停用",
    btnEnable: "启用",
    btnDisable: "禁用",
    btnStart: "▶ 启动",
    btnStop: "⏹ 停止",
    btnSaveModels: "💾 保存模型",
    btnRefreshModels: "🔄 拉取",
    btnFetchModelsLive: "获取模型",
    btnLoadCatalog: "重新加载目录",
    btnDiscoveryUnsupported: "不支持",
    btnTestConnection: "测试连接",
    btnTestConnectionUnsupported: "不支持连接测试",
    btnWorking: "执行中…",
    notifCenterTitle: "模型变更",
    notifCenterSub: "实时扫描发现的每一项变更都会在此报告",
    notifMarkAll: "全部标为已读",
    notifMarkRead: "标为已读",
    notifEmpty: "暂无模型变更。",
    notifUnread: "{count} 条未读",
    notifOpenCard: "打开提供方卡片",
    notifDetectedAt: "发现时间：{ts}",
    notifSourceLabel: "来源",
    notifCardNotFound: "当前页面看不到该提供方卡片。",
    notifTypeModelAdded: "检测到新模型",
    notifTypeModelRemoved: "模型已移除",
    notifTypeModelRenamed: "模型已重命名",
    notifTypeModelMetadata: "模型元数据已变更",
    notifTypeModelRestored: "此前移除的模型已恢复",
    discoveryNeverScanned: "实时发现：尚未检测",
    discoveryActive: "实时发现：运行中",
    discoveryUnsupported: "实时发现：不支持",
    discoveryNeedsLogin: "实时发现：需要登录",
    discoveryDeferred: "实时发现：已延后",
    discoveryError: "实时发现：错误",
    discoveryModelsFound: "已发现 {count} 个模型",
    discoveryNewModels: "+{count} 个新增",
    discoveryLastScan: "上次成功检测：{ts}",
    modelsSourceLiveWebUi: "来自提供方站点的实时发现",
    btnDiscoverModels: "发现模型",
    btnDiscoverModelsHint: "直接从提供方站点读取模型列表",
    btnCheckChanges: "检查变更",
    btnViewChanges: "查看变更",
    toastDiscoveryDone: "已发现 {count} 个模型（{newCount} 个新增）",
    toastDiscoveryChanges: "{count} 项模型变更",
    toastDiscoveryFailed: "发现失败：{error}",
    toastDiscoveryDeferred: "发现已延后：{reason}",
    toastNoChanges: "未检测到模型变更。",
    modelsSourceLabel: "来源",
    modelsSourceConfiguredCatalog: "已配置目录 — 非实时发现",
    modelsSourceLiveApi: "通过 /models 接口实时发现",
    modelsSourceNone: "无来源",
    modelsLastRefreshAt: "上次同步：{ts}",
    modelsNeverRefreshed: "从未同步",
    modelsStaleBadge: "不可用",
    modelsDiscoveryUnsupportedNote: "该提供方不支持获取模型列表，按钮已禁用。",
    modelsCatalogNotLiveNote: "该列表是网关内配置的目录，并非来自提供方站点的实时发现。",
    connStatusLabel: "连接",
    connStatusConnected: "已连接",
    connStatusAuthenticationRequired: "需要登录",
    connStatusRateLimited: "速率受限",
    connStatusQuotaExhausted: "配额耗尽",
    connStatusProviderUnavailable: "提供方不可用",
    connStatusBrowserUnavailable: "浏览器不可用",
    connStatusTimeout: "已超时",
    connStatusUnsupported: "不支持",
    connStatusUnknown: "未知",
    connStatusNeverChecked: "尚未检测",
    connLastCheckAt: "上次检测：{ts}",
    connCheckWebProfile: "检查提供方网站可达性、浏览器可用性与已保存会话",
    connCheckApiHealth: "检查提供方 health/models 接口（不产生付费请求）",
    connTestUnsupportedNote: "该类型提供方没有可用的真实连接检测。",
    toastModelsRefreshedCount: "已更新 {count} 个模型（{source}）",
    toastModelsRefreshFailed: "更新模型失败：{error}",
    toastModelsPruned: "已移除 {count} 个不再可用的已选模型",
    toastConnectionResult: "连接检测：{status}（{ms}ms）",
    toastConnectionFailed: "连接检测失败：{error}",
    btnCheckPing: "⚡ 测速",
    btnOpenBrowser: "🔑 打开浏览器",
    toggleHeadlessLabel: "🖥️ 无头浏览器 (Headless)",
    togglePrivacyLabel: "🛡️ 隐私会话模式 (Privacy)",
    filterShowAll: "🌐 查看全部",
    filterShowEnabled: "已启用的提供商",
    filterProvidersHeader: "提供商多选过滤：",
    filterProvidersSub: "选择一个或多个提供商并排对比显示，或点击“查看全部”或“已启用的提供商”",
    filterShownCountAll: "显示：全部",
    filterClear: "✕ 清除筛选（显示全部）",
    filterAccountsAll: "所有提供商 (全部)",
    noAccountsFound: "该提供商下暂无账号。请点击“+ 添加新账号”。",
    noCustomProvidersFound: "尚未配置自定义上游服务。点击“+ 添加自定义上游”即可无缝集成 DeepSeek、Ollama 或 OpenRouter。",
    agentActive: "活跃",
    agentInstalled: "已安装",
    agentGuide: "指南",
    availableModelsCount: "可用模型",
    registeredAccounts: "已绑定账号：",
    noAccountsRegistered: "无绑定账号",
    activeAccountPill: "(当前活跃)",
    addAccountBtnShort: "+ 账号",
    unnamedAccount: "未命名账号",
    customSettingsBtn: "设置",
    customEditKeyModels: "修改密钥与模型",
    customApiKeySaved: "🔑 已配置 API 密钥",
    customNoApiKey: "无需 API 密钥",
    activeModelsListLabel: "已启用模型",
    typeStream: "流式",
    typeSync: "同步",
    unknownClient: "未指定客户端",
    pathLabel: "路径：",
    editorReady: "编辑器已可连接到网关",
    filterPillTitle: "点击可将 {name} 加入当前视图",
    filterShownCount: "显示 {shown} / {total} 个提供商",
    chipSwitchTitle: "点击启用此账号",
    chipDeleteTitle: "删除此账号",
    agentPortTitle: "智能体出口端口",
    headlessHint: "在后台无界面运行浏览器以节省资源并避免窗口堆积",
    privacyHint: "启用隐私模式与临时会话，避免对话记录保存在提供商服务器",
    privacyModeNote: "隐私模式 = 临时会话：工具、图片生成和特殊功能在该模式下不可用，对话记录也不会保存在提供商服务器。",
    privacyModeNoteGeneric: "隐私模式：对话记录不会保存在提供商服务器，部分工具或特殊功能可能无法使用。",
    pingHint: "测试该提供商的连接与响应速度",
    btnAllShort: "全部",
    btnNoneShort: "清空",
    noModelsYet: "暂无模型。请登录或点击拉取以获取模型。",
    toastHeadlessEnabled: "已为 {id} 启用无头模式",
    toastHeadlessDisabled: "已为 {id} 关闭无头模式",
    toastPrivacyEnabled: "已为 {id} 启用隐私模式",
    toastPrivacyDisabled: "已为 {id} 关闭隐私模式",
    toastAccSwitched: "所选账号已成功激活",
    toastProviderStarted: "已启动 {id}",
    toastProviderStopped: "已停止 {id}",
    toastModelsSaved: "已保存 {id} 的模型",
    toastModelsRefreshed: "模型列表已更新",
    toastBrowserOpening: "正在打开浏览器登录...",
    toastLoginComplete: "登录会话已完成",
    toastProviderEnabled: "提供商已启用",
    toastProviderDisabled: "提供商已禁用",
    snipEnvSetup: "# 1. 在终端中设置网关地址与访问密钥：",
    snipRunClaude: "# 2. 通过本地网关直接运行 Claude Code：",
    snipCursorModels: "// 在 {name} 设置 > Models > OpenAI API 中：",
    snipVsCode: "// 在 VS Code 设置中（settings.json 或 Cline / Continue 扩展）：",
    snipPythonOpenAI: "# 使用 OpenAI 标准协议的 Python 示例：",
    snipPythonAnthropic: "# 或直接使用官方 Anthropic SDK：",
    snipPythonHello: "你好，来自 Python 代码！",
    snipHello: "你好",
    snipGeminiSetup: "# 配置 Gemini 原生协议（/v1beta）：",
    snipGeminiCurl: "# 或使用 cURL 与 x-goog-api-key 请求头：",
    snipGeminiHello: "你好！",
    snipHermesSetup: "# 配置 Hermes Agent 连接本地网关：",
    snipCallAgent: "# 直接调用智能体：",
    snipEnvVarsAlt: "# 或使用环境变量：",
    snipThenRun: "# 然后运行：",
    defaultKeyCreatedAt: "默认",
    cpNoModelsYet: "尚未选择模型 — 打开设置从服务器获取或手动添加",
    cpVerifyHint: "对服务器进行真实连接测试并校验 API 密钥",
    cpVerifyBtn: "🔌 验证连接",
    cpSettingsHint: "提供商设置：修改密钥与链接、获取或手动添加模型",
    keyNameRequired: "请输入用于识别密钥的名称",
    cpVerifying: "⏳ 正在验证...",
    verifyServerOk: "服务器连接成功",
    verifyServerFailed: "服务器连接失败",
    cpVerifyLoading: "正在真实连接服务器并校验 API 密钥...",
    verifyOk: "连接成功",
    verifyFail: "连接失败",
    baseUrlRequiredVerify: "请先输入 Base URL 以验证连接",
    cpVerifyChecking: "正在检测真实服务器连接并校验 API 密钥...",
    cpVerifyCheckingShort: "⏳ 正在检测连接...",
    cpFetchedDuringVerify: "验证连接时已从服务器获取 {count} 个真实模型",
    verifyCheckFailed: "连接验证失败",
    baseUrlRequired: "请先输入 Base URL",
    cpFetchingBanner: "正在连接服务器 /models 端点以获取真实模型...",
    cpFetchingLive: "⏳ 正在从服务器获取真实模型...",
    cpFetchingShort: "⏳ 正在从服务器获取...",
    cpFetchedReal: "已直接从服务器获取 {count} 个真实模型",
    cpFetchFailed: "无法连接服务器获取模型",
    btnFetchReal: "🔄 从服务器获取模型",
    sourceServer: "🌐 来自服务器",
    sourceManual: "✍️ 已添加",
    modelNameRequired: "请输入要添加的模型名称",
    manualModelAdded: "已手动添加模型（已选 {count} 个）",
    cpSaveSettings: "💾 保存设置",
    cpVerifyFetchHint: "请使用验证连接按钮或从服务器获取模型按钮",
    nameUrlRequired: "名称和 Base URL 为必填项",
    cpSavedSettings: "提供商设置已保存（已启用 {count} 个模型）",
    cpAddedSuccess: "自定义提供商添加成功（已启用 {count} 个模型）",
    toastProviderDeleted: "提供商已删除",
    emailRequired: "电子邮箱为必填项",
    manageAccountTitle: "管理 {name}",
    noNameLabel: "未命名",
    defaultAccountName: "默认账号",
    activeBrowserSession: "活动浏览器会话",
    accountActiveNow: "✓ 账号当前已激活",
    toastLoginWindow: "正在打开该账号的登录窗口...",
    toastLoginDone: "登录已完成",
    toastAccountDeletedShort: "账号已删除",
        btnSave: "保存",
    topoStreamSse: "SSE流式",
    topoNormal: "标准",
    customModelsPart: "个自定义模型",
    tokenUnit: "标记",
    phRgName: "例如：Group-A",
    mcpAgentLabel: "智能体 / 编辑器",
    mcpTargetAuto: "自动（按智能体）",
    mcpFixedServerName: "固定服务器名称：",
    mcpSectionDesc: "此部分展示所有可用智能体与编辑器。选择智能体和模型以将其包含在生成的 MCP 配置中。",
    swarmSubtitle: "通过专职智能体角色协同执行任务、合成产出并管理模型路由组。",
    btnRunTask: "运行任务",
    swarmRolesTitle: "执行角色",
    swarmRolesSubtitle: "按专业分工协作",
    swarmRoleArchitect: "架构师",
    swarmRoleArchitectDesc: "拆解目标，确定系统架构与分步流程。",
    swarmRoleCoder: "研发工程师",
    swarmRoleCoderDesc: "实施具体变更并编写代码。",
    swarmRoleReviewer: "评审员",
    swarmRoleReviewerDesc: "审查代码质量、把控潜在风险并提出建议。",
    swarmRoleTester: "测试工程师",
    swarmRoleTesterDesc: "拟定测试用例并验证功能正确性。",
    swarmExecTitle: "任务执行",
    swarmExecSubtitle: "向多智能体协调中心提交目标",
    swarmGoalLabel: "目标",
    swarmGoalPlaceholder: "输入需要执行的任务目标，包含上下文或约束条件。",
    swarmModeLabel: "运行模式",
    swarmModeAuto: "自动（流水线 + 并行）",
    swarmModePipeline: "流水线（串行）",
    swarmModeParallel: "并行",
    btnExecute: "执行",
    swarmModelLabel: "该角色模型",
    swarmModelAuto: "智能自动（auto）",
    swarmGoalRequired: "请先输入目标或任务内容",
    swarmExecuting: "正在执行...",
    swarmDispatching: "正在协调任务并派发至各智能体...",
    swarmConnFailed: "连接服务器失败",
    langOptAr: "阿拉伯语 (AR)",
    langOptEn: "英语 (EN)",
    langOptFr: "法语 (FR)",
    langOptRu: "俄语 (RU)",
    langOptEs: "西班牙语 (ES)",
    langOptZh: "中文 (ZH)",
    pulseLatency: "14ms（即时脉冲）"
  }
};

function getStoredLang(){
  try{
    return localStorage.getItem('emo-gateway-lang') || 'ar';
  }catch(e){
    return 'ar';
  }
}

let currentLang = getStoredLang();

function t(key, params){
  const dict = I18N[currentLang] || I18N['ar'];
  let val = dict[key] !== undefined ? dict[key] : (I18N['ar'][key] !== undefined ? I18N['ar'][key] : key);
  if(typeof val === 'string' && params && typeof params === 'object'){
    for(const k in params){
      val = val.split('{' + k + '}').join(String(params[k]));
    }
  }
  return val;
}

function applyLanguage(lang){
  if(!I18N[lang]) lang = 'ar';
  currentLang = lang;
  try{
    localStorage.setItem('emo-gateway-lang', lang);
  }catch(e){}

  const isRtl = lang === 'ar';
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('dir', isRtl ? 'rtl' : 'ltr');

  const langSel = document.getElementById('langSelect');
  if(langSel && langSel.value !== lang) langSel.value = lang;

  document.title = t('documentTitle');

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if(k && I18N[lang] && I18N[lang][k] !== undefined){
      el.textContent = I18N[lang][k];
    }
  });

  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const k = el.dataset.i18nPh;
    if(k && I18N[lang] && I18N[lang][k] !== undefined){
      el.placeholder = I18N[lang][k];
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const k = el.dataset.i18nTitle;
    if(k && I18N[lang] && I18N[lang][k] !== undefined){
      el.title = I18N[lang][k];
    }
  });

  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const k = el.dataset.i18nAria;
    if(k && I18N[lang] && I18N[lang][k] !== undefined){
      el.setAttribute('aria-label', I18N[lang][k]);
    }
  });

  document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
    const k = el.dataset.i18nTooltip;
    if(k && I18N[lang] && I18N[lang][k] !== undefined){
      el.setAttribute('data-tooltip', I18N[lang][k]);
    }
  });
  if(typeof updateSidebarToggleBtnText === 'function') updateSidebarToggleBtnText();

  const curTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const statusLabel = document.getElementById('themeStatusLabel');
  if(statusLabel) statusLabel.textContent = curTheme === 'light' ? t('lightMode') : t('darkMode');

  if(stateData){
    renderProvidersGrid(stateData.providers, true);
    renderAccountsView(stateData.providers, true);
    renderRecentRequests(stateData.recentRequests || []);
  }
  if(typeof renderRouterGroups === 'function') renderRouterGroups();
  renderApiKeysTable();
  renderCustomProvidersList();
  renderAgentsList();
  renderTopologyAgentNodes();
  updateSnippetDisplay();
  // Pull a fresh state so the topology provider cards, live badges and the
  // sidebar status text are re-rendered in the new language immediately
  // instead of waiting for the 3s auto-refresh tick.
  refreshData();
  setTimeout(updateTopologyFlowLines, 60);
}

function changeLanguage(lang){
  applyLanguage(lang);
}

function openMcpConnection(){
  navigate('connect', null);
}

function checkAppUpdate(btn){
  const version = (document.getElementById('appVersionText')?.textContent || 'v0.1.0').trim();
  const statusEl = document.getElementById('appUpdateStatus');
  const triggerBtn = btn || document.getElementById('btnCheckAppUpdate');
  const originalText = triggerBtn ? (triggerBtn.dataset.originalText || triggerBtn.textContent || '') : '';
  if(triggerBtn){
    triggerBtn.dataset.originalText = originalText;
    triggerBtn.disabled = true;
    triggerBtn.textContent = t('toastCheckingUpdate');
  }
  if(statusEl){
    statusEl.textContent = t('toastCheckingUpdate');
    statusEl.style.color = 'var(--text-muted)';
  }
  setTimeout(()=>{
    const latestEl = document.getElementById('latestVersionText');
    if(latestEl) latestEl.textContent = version;
    if(statusEl){
      statusEl.textContent = t('toastAppUpToDate', { version });
      statusEl.style.color = 'var(--success)';
    }
    if(triggerBtn){
      triggerBtn.disabled = false;
      triggerBtn.textContent = triggerBtn.dataset.originalText || originalText || t('checkUpdateBtn');
    }
  }, 700);
}

// Theme handling
function getStoredTheme(){
  try{
    return localStorage.getItem('emo-gateway-theme') || 'dark';
  }catch(e){
    return 'dark';
  }
}

function applyTheme(theme){
  document.documentElement.setAttribute('data-theme', theme);
  try{
    localStorage.setItem('emo-gateway-theme', theme);
  }catch(e){}
  
  const icon = document.getElementById('themeToggleIcon');
  if(icon) icon.textContent = theme === 'light' ? '☀️' : '🌙';
  
  const statusIcon = document.getElementById('themeStatusIcon');
  if(statusIcon) statusIcon.textContent = theme === 'light' ? '☀️' : '🌙';
  
  const statusLabel = document.getElementById('themeStatusLabel');
  if(statusLabel) statusLabel.textContent = theme === 'light' ? t('lightMode') : t('darkMode');
  setTimeout(updateTopologyFlowLines, 50);
}

function toggleTheme(){
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

// Collapsible Sidebar Controller
function toggleSidebarCollapse(){
  const sb = document.getElementById('appSidebar');
  if(!sb) return;
  const isCollapsed = sb.classList.toggle('collapsed');
  try{
    localStorage.setItem('emo-gateway-sidebar-collapsed', isCollapsed ? 'true' : 'false');
  }catch(e){}
  
  updateSidebarToggleBtnText();

  // Trigger resize and topology flow lines recalculation after animation completes
  setTimeout(() => {
    if(typeof updateTopologyFlowLines === 'function') updateTopologyFlowLines();
    window.dispatchEvent(new Event('resize'));
  }, 230);
}

function updateSidebarToggleBtnText(){
  const sb = document.getElementById('appSidebar');
  const btn = document.getElementById('sidebarToggleBtn');
  if(!btn || !sb) return;
  const isCol = sb.classList.contains('collapsed');
  const title = isCol ? (t('sidebarToggleExpand') || 'توسيع القائمة الجانبية') : (t('sidebarToggleCollapse') || 'طي القائمة الجانبية');
  btn.title = title;
  btn.setAttribute('data-tooltip', title);
  btn.setAttribute('aria-label', title);
}

function initSidebarState(){
  try{
    const isCol = localStorage.getItem('emo-gateway-sidebar-collapsed') === 'true';
    const sb = document.getElementById('appSidebar');
    if(sb){
      if(isCol){
        sb.classList.add('collapsed');
      } else {
        sb.classList.remove('collapsed');
      }
    }
  }catch(e){}
  document.documentElement.classList.remove('sidebar-collapsed-init');
  updateSidebarToggleBtnText();
}

function initSidebarTooltips(){
  const tooltipEl = document.getElementById('sidebarFloatingTooltip');
  if(!tooltipEl) return;
  const sb = document.getElementById('appSidebar');
  if(!sb) return;

  sb.addEventListener('mouseover', (e) => {
    if(!sb.classList.contains('collapsed')){
      tooltipEl.style.opacity = '0';
      return;
    }
    const target = e.target.closest('[data-tooltip]');
    if(!target || !sb.contains(target)){
      tooltipEl.style.opacity = '0';
      return;
    }
    let text = target.getAttribute('data-tooltip') || '';
    const badgeEl = target.querySelector('.nav-badge');
    if(badgeEl){
      const badgeVal = badgeEl.textContent.trim();
      if(badgeVal && badgeVal !== '0'){
        text += ' (' + badgeVal + ')';
      }
    }
    if(!text){
      tooltipEl.style.opacity = '0';
      return;
    }

    tooltipEl.textContent = text;
    const rect = target.getBoundingClientRect();
    const isRtl = document.documentElement.getAttribute('dir') === 'rtl';

    tooltipEl.style.top = (rect.top + rect.height / 2) + 'px';
    if(isRtl){
      tooltipEl.style.right = (window.innerWidth - rect.left + 10) + 'px';
      tooltipEl.style.left = 'auto';
    } else {
      tooltipEl.style.left = (rect.right + 10) + 'px';
      tooltipEl.style.right = 'auto';
    }
    tooltipEl.style.transform = 'translateY(-50%)';
    tooltipEl.style.opacity = '1';
  });

  sb.addEventListener('mouseout', (e) => {
    const related = e.relatedTarget;
    if(!related || !sb.contains(related)){
      tooltipEl.style.opacity = '0';
    } else {
      const target = related.closest('[data-tooltip]');
      if(!target) tooltipEl.style.opacity = '0';
    }
  });

  window.addEventListener('keydown', (e) => {
    if((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')){
      const activeEl = document.activeElement;
      if(activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)){
        return;
      }
      e.preventDefault();
      toggleSidebarCollapse();
    }
  });
}

// Shared gateway state (declared before initial theme/language sync below,
// which re-renders views that read it)
let stateData = null;

// Initial theme & language sync — deferred to a microtask because the
// re-render chain (applyLanguage → renderApiKeysTable → …) reads more state
// variables declared further down this script; running it synchronously here
// would hit TDZ errors on those.
queueMicrotask(() => {
  applyTheme(getStoredTheme());
  applyLanguage(getStoredLang());
  initSidebarState();
  initSidebarTooltips();
});

let currentAccountFilter = 'all';
let selectedProviderFilters = new Set();
let detectedAgents = [];
let selectedAgentId = 'opencode';
let currentApiKeys = [];
let currentCustomProviders = [];
let connectMode = 'auto';
let routerGroups = [];
// In-flight provider card operations, keyed by "<providerId>:<action>".
// Guarantees a single operation per card and survives grid re-renders.
let providerCardBusy = new Set();
// Last error per card action, so a failed operation stays visible after the
// grid is re-rendered by the status poll.
let providerCardErrors = new Map();

/** Extracts a secret-free, human-readable message from a failed API call. */
function providerErrorMessage(e){
  if(!e) return 'unknown error';
  const payload = e.payload;
  if(payload){
    if(payload.outcome && payload.outcome.error) return String(payload.outcome.error);
    if(payload.error && payload.error.message) return String(payload.error.message);
    if(payload.message) return String(payload.message);
  }
  return String(e.message || e);
}

// ---------------------------------------------------------------------------
// Model change notification centre
// ---------------------------------------------------------------------------
let modelNotifications = [];
let modelNotifFilter = '';

async function loadModelNotifications(){
  try{
    const res = await api('/api/gateway/discovery/notifications');
    modelNotifications = Array.isArray(res.notifications) ? res.notifications : [];
    renderModelNotifications();
    renderModelNotifBadge(res.unreadCount || 0);
  }catch(e){
    // The notification centre is optional — never break the page for it.
  }
}

function renderModelNotifBadge(count){
  const badge = document.getElementById('modelNotifUnreadBadge');
  if(!badge) return;
  badge.textContent = String(count || 0);
  badge.style.display = count > 0 ? 'inline-block' : 'none';
}

function notifTypeLabel(type){
  if(type === 'model_added') return t('notifTypeModelAdded');
  if(type === 'model_removed') return t('notifTypeModelRemoved');
  if(type === 'model_renamed') return t('notifTypeModelRenamed');
  if(type === 'model_metadata_changed') return t('notifTypeModelMetadata');
  if(type === 'model_restored') return t('notifTypeModelRestored');
  return String(type || '');
}

function notifTypeIcon(type){
  if(type === 'model_added') return '＋';
  if(type === 'model_removed') return '－';
  if(type === 'model_renamed') return '✎';
  if(type === 'model_metadata_changed') return '⚙';
  if(type === 'model_restored') return '↺';
  return '•';
}

function renderModelNotifications(){
  const panel = document.getElementById('modelNotificationsPanel');
  if(!panel) return;
  const items = modelNotifFilter
    ? modelNotifications.filter(n => n.providerId === modelNotifFilter)
    : modelNotifications;

  if(items.length === 0){
    panel.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:10px">' + esc(t('notifEmpty')) + '</div>';
    return;
  }

  panel.innerHTML = items.map(n =>
    '<div class="model-notif-item' + (n.read ? '' : ' unread') + '" data-notif-id="' + esc(n.id) + '">' +
      '<div class="model-notif-icon">' + esc(notifTypeIcon(n.type)) + '</div>' +
      '<div class="model-notif-body">' +
        '<div class="model-notif-title">' +
          '<strong>' + esc(n.providerName || n.providerId) + '</strong>' +
          ' — ' + esc(notifTypeLabel(n.type)) + ': ' + esc(n.displayName) +
        '</div>' +
        (n.previousDisplayName
          ? '<div style="font-size:11px;color:var(--text-muted)">' + esc(n.previousDisplayName) + ' → ' + esc(n.displayName) + '</div>'
          : '') +
        '<div style="font-size:10.5px;color:var(--text-dim);display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
          '<span>' + esc(t('notifDetectedAt', { ts: n.detectedAt })) + '</span>' +
          '<span>' + esc(t('notifSourceLabel')) + ': ' + esc(t(n.source === 'web-ui-network' ? 'modelsSourceLiveWebUi' : 'modelsSourceLiveWebUi')) + '</span>' +
          '<button type="button" class="btn-sm" style="padding:2px 7px;font-size:10.5px" data-notif-open="' + esc(n.providerId) + '">' + esc(t('notifOpenCard')) + '</button>' +
          (n.read ? '' : '<button type="button" class="btn-sm" style="padding:2px 7px;font-size:10.5px" data-notif-read="' + esc(n.id) + '">' + esc(t('notifMarkRead')) + '</button>') +
        '</div>' +
      '</div>' +
    '</div>'
  ).join('');

  panel.querySelectorAll('[data-notif-read]').forEach(btn => {
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      await api('/api/gateway/discovery/notifications/' + encodeURIComponent(btn.dataset.notifRead) + '/read', {method:'POST', body: JSON.stringify({read:true})}).catch(()=>{});
      await loadModelNotifications();
    };
  });
  panel.querySelectorAll('[data-notif-open]').forEach(btn => {
    btn.onclick = (ev) => {
      ev.stopPropagation();
      focusProviderCard(btn.dataset.notifOpen);
    };
  });
}

function toggleModelNotifications(){
  const panel = document.getElementById('modelNotificationsPanel');
  if(!panel) return;
  const open = panel.style.display === 'none';
  panel.style.display = open ? 'block' : 'none';
  if(open) void loadModelNotifications();
}

function openModelNotificationsPanel(providerId){
  modelNotifFilter = providerId || '';
  const panel = document.getElementById('modelNotificationsPanel');
  if(panel) panel.style.display = 'block';
  renderModelNotifications();
}

function focusProviderCard(providerId){
  modelNotifFilter = '';
  const grid = document.getElementById('providersGrid');
  if(!grid) return;
  const cards = grid.querySelectorAll('.provider-card');
  for(const card of cards){
    if(card.innerHTML && card.innerHTML.indexOf('data-id="' + providerId + '"') !== -1){
      card.scrollIntoView({behavior:'smooth', block:'center'});
      card.style.outline = '2px solid var(--primary)';
      setTimeout(()=>{ card.style.outline = ''; }, 2200);
      return;
    }
  }
  showToast(t('notifCardNotFound'), 'error');
}

async function markAllModelNotificationsRead(){
  try{
    await api('/api/gateway/discovery/notifications/read-all', {method:'POST', body: JSON.stringify({providerId: modelNotifFilter || undefined})});
  }catch(e){ /* ignore */ }
  await loadModelNotifications();
}

function showToast(text, type='info'){
  const cont = document.getElementById('toastList');
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.innerHTML = '<span>' + (type==='error'?'⚠':'✓') + '</span><span>' + esc(text) + '</span>';
  cont.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; setTimeout(()=>el.remove(), 250); }, 3000);
}

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

// The backend seeds session-less providers with Arabic placeholder account
// labels. Those are sentinels, not user data, so translate them for display.
const ACCOUNT_NAME_SENTINEL = new Set(['الحساب الافتراضي', 'Default Account', 'Compte par défaut', 'Аккаунт по умолчанию', 'Cuenta predeterminada', '默认账号']);
const ACCOUNT_EMAIL_SENTINEL = new Set(['جلسة متصفح نشطة', 'Active browser session', 'Session de navigateur active', 'Активный сеанс браузера', 'Sesión de navegador activa', '活动浏览器会话']);
function locAccName(name){
  if(!name || ACCOUNT_NAME_SENTINEL.has(name)) return t('defaultAccountName');
  return name;
}
function locAccEmail(email){
  if(!email || ACCOUNT_EMAIL_SENTINEL.has(email)) return t('activeBrowserSession');
  return email;
}
function fmtUptime(ms){
  ms = Math.max(0, ms||0);
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
}



function toggleAgentConnectSettings(show){
  const panel = document.getElementById('agentConnectSettingsContent');
  const btn = document.getElementById('btnToggleAgentConnectSettings');
  if(!panel) return;
  const next = typeof show === 'boolean' ? show : panel.style.display === 'none';
  panel.style.display = next ? 'block' : 'none';
  if(btn) btn.setAttribute('aria-expanded', next ? 'true' : 'false');
  if(next) setTimeout(()=>panel.scrollIntoView({behavior:'smooth', block:'start'}), 50);
}

function navigate(viewName, itemEl){
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.view-panel').forEach(el=>el.classList.remove('active'));

  if(viewName === 'usage'){
    const overviewNav = document.querySelector('.sidebar-nav .nav-item[data-nav="overview"]') || itemEl;
    if(overviewNav) overviewNav.classList.add('active');
    const target = document.getElementById('view-overview');
    if(target) target.classList.add('active');
    setTimeout(()=>{
      const consumptionSec = document.getElementById('overview-consumption-section');
      if(consumptionSec){
        consumptionSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        consumptionSec.classList.remove('section-highlight-pulse');
        void consumptionSec.offsetWidth;
        consumptionSec.classList.add('section-highlight-pulse');
      }
    }, 60);
    return;
  }

  if(viewName === 'connect'){
    const target = document.getElementById('view-settings');
    if(target) target.classList.add('active');
    toggleAgentConnectSettings(true);
    return;
  }

  if(itemEl) itemEl.classList.add('active');
  const target = document.getElementById('view-'+viewName);
  if(target) target.classList.add('active');
  if(viewName === 'keys'){
    loadApiKeys();
    loadCustomProviders();
  }
  if(viewName === 'router'){
    navigate('swarm', document.querySelector('.nav-item[data-nav="swarm"]'));
    return;
  }
  if(viewName === 'swarm'){
    loadRouterGroups();
  }
  if(viewName === 'overview'){
    setTimeout(updateTopologyFlowLines, 50);
  }
}

async function copyInput(id, btn){
  const el = document.getElementById(id);
  if(el){
    await navigator.clipboard.writeText(el.value).catch(()=>{ el.select(); document.execCommand('copy'); });
    const old = btn.textContent;
    btn.textContent = t('copied');
    showToast(t('toastCopied') + el.value);
    setTimeout(()=>btn.textContent=old, 1500);
  }
}

async function copyCode(btn){
  const text = btn.parentElement.innerText.replace(btn.textContent,'').trim();
  await navigator.clipboard.writeText(text).catch(()=>{});
  const old = btn.textContent;
  btn.textContent = t('copied');
  showToast(t('toastSettingsCopied'));
  setTimeout(()=>btn.textContent=old, 1500);
}

async function api(path, opts={}){
  const headers = {...(opts.headers||{})};
  if(opts.body && !headers['Content-Type']) headers['Content-Type']='application/json';
  const serverKey = '__EMO_API_KEY__';
  const key = (serverKey && !serverKey.startsWith('__')) ? serverKey : (localStorage.getItem('emoApiKey') || 'emo.web');
  headers['Authorization'] = 'Bearer ' + key;
  const res = await fetch(path, {...opts, headers});
  const text = await res.text();
  let json; try{ json = JSON.parse(text); }catch{ json = { raw: text }; }
  if(!res.ok){
    const err = new Error(json?.error?.message || json?.message || text || res.status);
    // Keep the parsed body so callers can show the REAL reason (e.g. the
    // discovery outcome) instead of a generic failure string.
    err.payload = json;
    err.status = res.status;
    throw err;
  }
  return json;
}

// Share one in-flight refresh so a manual click never races the 3s poll and
// always resolves with the freshest state.
let refreshPromise = null;
function refreshData(){
  if(refreshPromise) return refreshPromise;
  refreshPromise = runRefresh().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
async function runRefresh(){
  try{
    const st = await api('/api/gateway/status');
    stateData = st;

    const sbText = document.getElementById('sbStatusText');
    if(sbText){ sbText.textContent = t('gatewayConnected'); sbText.style.color = 'var(--success)'; }
    const sbDotEl = document.getElementById('sbDot');
    if(sbDotEl) sbDotEl.className = 'status-dot dot-running';
    const sbDotMini = document.getElementById('sbDotMini');
    if(sbDotMini) sbDotMini.className = 'status-dot dot-running';

    const realOrigin = window.location.origin;
    const apiKey = st.gateway?.api || 'emo.web';
    document.getElementById('inpBaseUrl').value = realOrigin + '/v1';
    document.getElementById('inpAnthropicUrl').value = realOrigin;
    document.getElementById('inpGeminiUrl').value = realOrigin;
    document.getElementById('inpApiKey').value = apiKey;
    const qBase = document.getElementById('quickBaseUrl');
    if(qBase) qBase.textContent = realOrigin + '/v1';
    const qKey = document.getElementById('quickApiKey');
    if(qKey) qKey.textContent = apiKey;

    // Service status toggle state
    const isServiceRunning = st.serviceRunning ?? st.gateway?.serviceRunning ?? true;
    const sBadge = document.getElementById('serviceStateBadge');
    const sDot = document.getElementById('serviceStateDot');
    const sText = document.getElementById('serviceStateText');
    const sBtn = document.getElementById('btnToggleGatewayService');
    const hubNode = document.getElementById('topNodeHub');

    if(isServiceRunning){
      if(sBadge) sBadge.className = 'badge badge-success';
      if(sDot) sDot.className = 'status-dot dot-running';
      if(sText) sText.textContent = t('serviceRunning');
      if(sBtn){
        sBtn.classList.add('is-on');
        sBtn.setAttribute('aria-checked', 'true');
      }
      if(hubNode) hubNode.classList.remove('hub-stopped');
      const topoBadge = document.getElementById('topoLivePulseBadge');
      if(topoBadge){
        topoBadge.className = 'badge badge-success';
        topoBadge.innerHTML = '<span class="status-dot dot-running"></span> ' + t('topoLivePulse');
      }
    } else {
      if(sBadge) sBadge.className = 'badge badge-danger';
      if(sDot) sDot.className = 'status-dot dot-error';
      if(sText) sText.textContent = t('serviceStopped');
      if(sBtn){
        sBtn.classList.remove('is-on');
        sBtn.setAttribute('aria-checked', 'false');
      }
      if(hubNode) hubNode.classList.add('hub-stopped');
      const topoBadge = document.getElementById('topoLivePulseBadge');
      if(topoBadge){
        topoBadge.className = 'badge badge-danger';
        topoBadge.innerHTML = '<span class="status-dot dot-error"></span> ' + t('topoFlowStopped');
      }
    }

    // Live Metrics
    const startTime = new Date(st.usage.gatewayStartedAt).getTime();
    document.getElementById('uptimeCounter').textContent = fmtUptime(Date.now() - startTime);

    const u = st.usage.session;
    const pTokens = Math.round((u.promptChars || 0) / 4);
    const cTokens = Math.round((u.completionChars || 0) / 4);
    document.getElementById('totalTokens').textContent = (pTokens + cTokens).toLocaleString();
    document.getElementById('promptTokens').textContent = pTokens.toLocaleString();
    document.getElementById('complTokens').textContent = cTokens.toLocaleString();
    document.getElementById('okRequests').textContent = (u.completions || 0).toLocaleString();
    document.getElementById('totalRequests').textContent = (u.requests || 0).toLocaleString();
    document.getElementById('streamRequests').textContent = (u.streamRequests || 0).toLocaleString();

    // Success rate
    const reqs = u.requests || 0;
    const comps = u.completions || 0;
    const rate = reqs > 0 ? Math.round((comps / reqs) * 100) : 100;
    document.getElementById('successRate').textContent = rate + '%';

    document.getElementById('promptChars').textContent = (u.promptChars || 0).toLocaleString();
    document.getElementById('complChars').textContent = (u.completionChars || 0).toLocaleString();
    document.getElementById('lifetimeReq').textContent = (st.usage.lifetime.requests || 0).toLocaleString();

    // Hub compact metrics: request rate (per minute) + live connection speed
    const hubUptimeMin = Math.max(1 / 60, (Date.now() - startTime) / 60000);
    const hubReq = document.getElementById('hubReqRate');
    if(hubReq) hubReq.textContent = String(Math.round((u.requests || 0) / hubUptimeMin));
    const hubLat = document.getElementById('hubMetricsLatency');
    if(hubLat){
      const lats = (st.providers || []).map(p => p.latencyMs).filter(v => typeof v === 'number' && v > 0);
      hubLat.textContent = lats.length ? ('~' + Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) + 'ms') : '—';
    }

    // Render Recent Requests Log & Badge
    renderRecentRequests(st.recentRequests || []);
    const bReqCount = document.getElementById('badgeTotalRequestsCount');
    if(bReqCount) bReqCount.textContent = (st.usage?.session?.requests || 0).toLocaleString();

    // Active Models & Providers
    const activeModels = [];
    const activeProvidersList = [];
    let totalAccountsCount = 0;

    st.providers.forEach(p=>{
      const accs = p.accounts || [];
      totalAccountsCount += Math.max(accs.length, (p.accountEmail ? 1 : 0));
      if(p.enabled && Array.isArray(p.selectedModels) && p.selectedModels.length > 0){
        p.selectedModels.forEach(m=>{ if(!activeModels.includes(m)) activeModels.push(m); });
        activeProvidersList.push(p);
      }
    });

    document.getElementById('badgeActiveProv').textContent = activeProvidersList.length;
    const bProv = document.getElementById('badgeTotalProviders');
    if (bProv) bProv.textContent = st.providers.length;
    document.getElementById('badgeTotalAccounts').textContent = totalAccountsCount;
    document.getElementById('activeProvidersCount').textContent = activeProvidersList.length;
    document.getElementById('activeModelsCount').textContent = activeModels.length;

    const qmContainer = document.getElementById('quickModelsBadges');
    if(activeModels.length === 0){
      qmContainer.innerHTML = '<small style="color:var(--text-muted)">' + t('quickModelsEmpty') + '</small>';
    } else {
      qmContainer.innerHTML = activeModels.map(m=>
        '<span class="badge" style="cursor:pointer;font-family:var(--font-mono)" data-badge-model="' + esc(m) + '">' + esc(m) + '</span>'
      ).join('');
      qmContainer.querySelectorAll('[data-badge-model]').forEach(badge=>{
        badge.onclick = ()=>{
          const m = badge.dataset.badgeModel;
          navigator.clipboard.writeText(m).catch(()=>{});
          showToast(t('toastCopied') + m);
        };
      });
    }

    // Populate model select in Agent Connect (only when list changes so open dropdown is not closed)
    const selModel = document.getElementById('selSnippetModel');
    const modelsSig = activeModels.join('|');
    if(selModel.__lastSig !== modelsSig){
      selModel.__lastSig = modelsSig;
      const prevVal = selModel.value;
      selModel.innerHTML = activeModels.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('') || '<option value="claude-web:default">claude-web:default</option>';
      if(prevVal && activeModels.includes(prevVal)) selModel.value = prevVal;
    }

    // Topology flow — Upstream column shows strictly providers with active or recent requests
    const topActive = document.getElementById('topologyActiveList');
    const live = collectLiveTraffic();
    const provAct = (id) => live.provs[id] || { liveCount: 0, recentCount: 0, latestModel: '', latestLatency: 0 };

    const activeBuiltin = activeProvidersList
      .map(p => ({ p, act: provAct(p.id) }))
      .filter(item => item.act.liveCount > 0 || item.act.recentCount > 0)
      .sort((a, b) => {
        if(b.act.liveCount !== a.act.liveCount) return b.act.liveCount - a.act.liveCount;
        if(b.act.recentCount !== a.act.recentCount) return b.act.recentCount - a.act.recentCount;
        return 0;
      });

    const activeCustom = (((stateData || {}).customProviders) || [])
      .filter(cp => cp && cp.enabled)
      .map(cp => ({ cp, act: provAct(cp.id) }))
      .filter(item => item.act.liveCount > 0 || item.act.recentCount > 0)
      .sort((a, b) => {
        if(b.act.liveCount !== a.act.liveCount) return b.act.liveCount - a.act.liveCount;
        return b.act.recentCount - a.act.recentCount;
      });

    // Display prioritized providers (traffic-only)
    const providersToShow = activeBuiltin.slice(0, 5);
    const customToShow = activeCustom.slice(0, 2);

    if(providersToShow.length === 0 && customToShow.length === 0){
      const emptyMarkup = 
        '<div class="topo-empty-state">' +
          '<div class="topo-empty-icon">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted);opacity:0.8"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>' +
          '</div>' +
          '<div class="topo-empty-title" data-i18n="topoWaitingProvs">' + esc(t('topoWaitingProvs')) + '</div>' +
          '<div class="topo-empty-desc" data-i18n="topoWaitingProvsSub">' + esc(t('topoWaitingProvsSub')) + '</div>' +
        '</div>';
      if(topActive.__lastSig !== emptyMarkup){
        topActive.__lastSig = emptyMarkup;
        topActive.innerHTML = emptyMarkup;
      }
    } else {
      const customGlyph = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--primary)"><path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0V8z"/><path d="M12 17v5"/></svg>';
      const customNodes = customToShow.map(({cp, act}) => {
        const isInFlight = act.liveCount > 0;
        const hasRecent = act.recentCount > 0;
        const modelsCount = (cp.models || []).length;
        const statusBadge = isInFlight
          ? '<span class="badge badge-success topo-pulse-badge" style="font-size:8.5px;padding:2px 6px"><span class="status-dot dot-running" style="width:6px;height:6px"></span> ' + t('topoServing') + (act.liveCount > 1 ? ' ×' + act.liveCount : '') + '</span>'
          : '<span class="badge" style="font-size:8.5px;padding:2px 6px;color:var(--primary);border-color:rgba(59,130,246,0.3)">' + t('topoRecent') + '</span>';

        return (
          '<div class="topology-node topo-provider' + (isInFlight ? ' node-inflight' : ' node-active-flow') + '" data-provider-id="' + esc(cp.id) + '" data-custom="1" data-privacy="0" data-status="running" data-live="' + (isInFlight ? '1' : '0') + '" data-recent="' + (hasRecent ? '1' : '0') + '" tabindex="0">' +
            '<span class="topo-port port-right" title="' + esc(t('topoHubPortOut')) + '"></span>' +
            '<div class="topo-node-header">' +
              '<div class="topo-node-main">' +
                '<div class="topo-icon-badge">' + customGlyph + '</div>' +
                '<div class="topo-provider-name">' + esc(cp.name) + '</div>' +
              '</div>' +
              '<div class="topo-status-badge">' + statusBadge + '</div>' +
            '</div>' +
            (act.latestModel ? (
              '<div class="topo-req-chips">' +
                '<span class="topo-model-chip" title="' + esc(act.latestModel) + '">' + esc(act.latestModel) + '</span>' +
              '</div>'
            ) : '') +
            '<div class="topo-node-footer">' +
              '<span class="topo-dest-badge">' + modelsCount + ' ' + t('customModelsPart') + '</span>' +
              '<span class="topo-metrics-text">' + (act.latestLatency ? act.latestLatency + 'ms' : '') + '</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      const builtinNodes = providersToShow.map(({p, act})=>{
        const isRunning = p.status === 'running';
        const isPriv = p.settings?.privacyMode === true;
        const activeAcc = p.accounts?.find(a=>a.active) || { email: p.accountEmail || t('unnamedAccount') };
        const isInFlight = act.liveCount > 0;
        const hasRecent = act.recentCount > 0;
        const modelsCount = (p.selectedModels || []).length || (p.availableModels || []).length;

        const statusBadge = isInFlight
          ? '<span class="badge badge-success topo-pulse-badge" style="font-size:8.5px;padding:2px 6px"><span class="status-dot dot-running" style="width:6px;height:6px"></span> ' + t('topoServing') + (act.liveCount > 1 ? ' ×' + act.liveCount : '') + '</span>'
          : '<span class="badge" style="font-size:8.5px;padding:2px 6px;color:var(--primary);border-color:rgba(59,130,246,0.3)">' + t('topoRecent') + '</span>';

        return (
          '<div class="topology-node topo-provider' + (isPriv ? ' node-privacy' : '') + (isInFlight ? ' node-inflight' : ' node-active-flow') + '" data-provider-id="' + esc(p.id) + '" data-privacy="' + (isPriv ? '1' : '0') + '" data-status="' + (isRunning ? 'running' : 'idle') + '" data-live="' + (isInFlight ? '1' : '0') + '" data-recent="' + (hasRecent ? '1' : '0') + '" tabindex="0">' +
            '<span class="topo-port port-right" title="' + esc(t('topoHubPortOut')) + '"></span>' +
            '<div class="topo-node-header">' +
              '<div class="topo-node-main">' +
                '<div class="topo-icon-badge">' + getBrandIcon(p.id) + '</div>' +
                '<div class="topo-provider-name" title="' + esc(p.name) + '">' + esc(p.name) + '</div>' +
              '</div>' +
              '<div class="topo-status-badge">' +
                statusBadge +
                (isPriv ? '<span class="badge" title="' + esc(t('topoPrivacyPath')) + '" style="font-size:8.5px;padding:2px 5px;color:#10b981;border-color:rgba(16,185,129,0.3)">' + t('topoLegendPrivacy') + '</span>' : '') +
              '</div>' +
            '</div>' +
            (act.latestModel ? (
              '<div class="topo-req-chips">' +
                '<span class="topo-model-chip" title="' + esc(act.latestModel) + '">' + esc(act.latestModel) + '</span>' +
                '<span class="topo-acc-pill" title="' + esc(activeAcc.email) + '">' + esc(activeAcc.email) + '</span>' +
              '</div>'
            ) : (activeAcc && activeAcc.email) ? (
              '<div class="topo-req-chips">' +
                '<span class="topo-acc-pill" title="' + esc(activeAcc.email) + '">' + esc(activeAcc.email) + '</span>' +
              '</div>'
            ) : '') +
            '<div class="topo-node-footer">' +
              '<span class="topo-dest-badge">' + (modelsCount ? modelsCount + ' ' + t('metricActiveModelsPart') : '') + '</span>' +
              '<span class="topo-metrics-text">' + (act.latestLatency ? act.latestLatency + 'ms' : '') + '</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      const totalMarkup = builtinNodes + customNodes;
      if(topActive.__lastSig !== totalMarkup){
        topActive.__lastSig = totalMarkup;
        topActive.innerHTML = totalMarkup;
      }
    }
    renderTopologyAgentNodes();

    renderProvidersGrid(st.providers);
    // Keep the notification centre in sync with the discovery results.
    if(typeof st.unreadNotifications === 'number') renderModelNotifBadge(st.unreadNotifications);
    renderAccountsView(st.providers);
    updateSnippetDisplay();
    loadRouterGroups().catch(()=>{});
    renderSwarmRoleModels();

    return true;
  }catch(e){
    console.error('Refresh error:', e);
    document.getElementById('sbStatusText').textContent = t('gatewayDisconnected');
    document.getElementById('sbDot').className = 'status-dot dot-error';
    const sbDotMini = document.getElementById('sbDotMini');
    if(sbDotMini) sbDotMini.className = 'status-dot dot-error';
    return false;
  }
}

// Manual refresh button: visible spinner + toast so the click is never silent.
async function manualRefresh(btn){
  const el = btn || document.getElementById('btnQuickRefresh');
  if(!el || el.dataset.busy === '1') return;
  el.dataset.busy = '1';
  el.disabled = true;
  el.classList.add('is-refreshing');
  const originalText = el.textContent;
  el.textContent = t('btnRefreshing');
  const startedAt = Date.now();
  const ok = await refreshData();
  const elapsed = Date.now() - startedAt;
  if(elapsed < 550) await new Promise(r => setTimeout(r, 550 - elapsed));
  el.classList.remove('is-refreshing');
  el.disabled = false;
  el.textContent = originalText;
  delete el.dataset.busy;
  showToast(ok ? t('toastRefreshed') : t('toastRefreshFailed'), ok ? 'success' : 'error');
}

async function toggleGatewayService(){
  try{
    const btn = document.getElementById('btnToggleGatewayService');
    if(btn) btn.disabled = true;
    const res = await api('/api/gateway/service-toggle', { method: 'POST' });
    const isRunning = res.serviceRunning;
    showToast(isRunning ? t('toastServiceResumed') : t('toastServicePaused'), isRunning ? 'info' : 'error');
    await refreshData();
  }catch(e){
    showToast(t('toastServiceToggleFailed') + e.message, 'error');
  }finally{
    const btn = document.getElementById('btnToggleGatewayService');
    if(btn) btn.disabled = false;
  }
}

function renderRecentRequests(reqs){
  const tbody = document.getElementById('recentRequestsTableBody');
  if(!tbody) return;
  if(!Array.isArray(reqs) || reqs.length === 0){
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:24px">' + t('noRequestsRecorded') + '</td></tr>';
    return;
  }

  tbody.innerHTML = reqs.map(r=>{
    const agentBadge = '<span class="table-agent-badge">' + getBrandIcon(r.clientAgent || 'opencode') + ' ' + esc(formatAgentName(r.clientAgent)) + '</span>';
    const statusBadge = r.ok === undefined
      ? '<span class="badge" style="font-size:10.5px">' + esc(t('requestInFlight') || '…') + '</span>'
      : r.ok
      ? '<span class="badge badge-success" style="font-size:10.5px">200 OK</span>'
      : '<span class="badge badge-danger" style="font-size:10.5px" title="' + esc(r.error || t('statusError')) + '">' + t('statusError') + '</span>';
    const streamBadge = r.stream
      ? '<span class="badge" style="font-size:10px;color:#f59e0b;border-color:rgba(245,158,11,0.3)">' + t('typeStream') + '</span>'
      : '<span class="badge" style="font-size:10px;color:var(--text-dim)">' + t('typeSync') + '</span>';

    return (
      '<tr>' +
        '<td><span style="font-family:var(--font-mono);font-size:11.5px">' + esc(r.timeStr || new Date(r.timestamp).toLocaleTimeString()) + '</span></td>' +
        '<td>' + agentBadge + '</td>' +
        '<td><code style="font-family:var(--font-mono);font-size:11px">' + esc(r.model) + '</code></td>' +
        '<td>' + streamBadge + '</td>' +
        '<td><span style="font-family:var(--font-mono)">' + (r.tokensEstimated || 0).toLocaleString() + '</span></td>' +
        '<td><span style="font-family:var(--font-mono);color:var(--primary)">' + (r.durationMs || 0) + 'ms</span></td>' +
        '<td>' + statusBadge + '</td>' +
      '</tr>'
    );
  }).join('');
}

function formatAgentName(agentId){
  const map = {
    cursor: 'Cursor',
    windsurf: 'Windsurf',
    opencode: 'OpenCode',
    claudecode: 'Claude Code',
    vscode: 'VS Code',
    python: 'Python SDK',
    geminicli: 'Gemini CLI',
    hermes: 'Hermes',
    curl: 'cURL CLI',
    openai: 'OpenAI Client',
  };
  const key = normalizeBrandKey(agentId);
  return map[key] || map[agentId] || (agentId ? String(agentId) : t('unknownClient'));
}

async function clearRecentRequests(){
  try{
    await api('/api/gateway/recent-requests/clear', { method: 'POST' });
    showToast(t('toastLogCleared'));
    await refreshData();
  }catch(e){
    showToast(t('toastLogClearFailed') + e.message, 'error');
  }
}

// Load Detected Agents
// Short display names for the per-agent edge chips (full names live in tooltips)
const AGENT_SHORT_NAMES = {
  opencode: 'OpenCode',
  claudecode: 'Claude Code',
  cursor: 'Cursor',
  vscode: 'VS Code',
  windsurf: 'Windsurf',
  hermes: 'Hermes',
  antigravity: 'Antigravity',
  gemini: 'Gemini CLI',
  codex: 'Codex',
  t3: 'T3 Code',
  lobehub: 'LobeHub',
  jan: 'Jan AI',
  anythingllm: 'AnythingLLM',
  librechat: 'LibreChat',
  zed: 'Zed',
  pi: 'PI',
  alphacode: 'AlphaCode',
  kiro: 'Kiro Code',
  openwebui: 'Open WebUI',
  dify: 'Dify',
  flowise: 'Flowise',
  n8n: 'n8n',
  continue: 'Continue',
  roocode: 'Roo Code',
  aider: 'Aider',
  sillytavern: 'SillyTavern',
  python: 'Python'
};

// User-Agent derived client names -> detected agent ids
const CLIENT_AGENT_TO_ID = {
  'cursor': 'cursor',
  'windsurf': 'windsurf',
  'opencode': 'opencode',
  'claude code': 'claudecode',
  'gemini cli': 'gemini',
  'vs code': 'vscode',
  'roo code': 'roocode',
  'cline': 'vscode',
  'continue': 'continue',
  'aider': 'aider',
  'sillytavern': 'sillytavern',
  'open webui': 'openwebui',
  'kiro code': 'kiro',
  'librechat': 'librechat',
  'dify': 'dify',
  'flowise': 'flowise',
  'n8n': 'n8n',
  'anythingllm': 'anythingllm',
  'lobehub': 'lobehub',
  'jan ai': 'jan',
  'codex': 'codex',
  'antigravity': 'antigravity',
  'zed': 'zed',
  'python sdk': 'python',
  'hermes': 'hermes'
};

// Real live traffic, parsed from the recent-requests log. There is exactly ONE
// truthful definition of "live": a request that is IN FLIGHT right now. It is
// logged at arrival with ok === undefined and stamped only when it completes
// (JSON drops undefined, so a missing ok means "still running"). Completed
// requests never mark a node live — when nothing is running the panel is empty
// rather than pretending something is working.
function collectLiveTraffic(){
  const recent = (stateData && stateData.recentRequests) || [];
  const builtinIds = new Set((((stateData || {}).providers) || []).map(p => p.id));
  const customs = ((stateData || {}).customProviders) || [];
  const customById = {};
  const customByName = {};
  customs.forEach(cp => {
    if(cp && cp.enabled){
      customById[String(cp.id || '').toLowerCase()] = cp;
      customByName[String(cp.name || '').trim().toLowerCase()] = cp;
    }
  });
  const knownIds = new Set(detectedAgents.map(a => a.id));
  const now = Date.now();
  const MAX_INFLIGHT_MS = 5 * 60 * 1000;
  const RECENT_FLOW_MS = 2 * 60 * 1000; // 2 minutes live session window for recent traffic
  const blank = () => ({
    liveCount: 0,
    recentCount: 0,
    lastTs: 0,
    provId: '',
    provTs: 0,
    inflightProvId: '',
    inflightProvTs: 0,
    latestModel: '',
    latestStream: false,
    latestLatency: 0,
    latestTokens: 0,
    latestOk: undefined
  });
  const agents = {};   // detected agent id -> record
  const others = {};   // real clients whose UA maps to no detected agent id
  const provs = {};    // provider id -> record

  recent.forEach(r => {
    const ts = r.timestamp ? new Date(r.timestamp).getTime() : 0;
    if(!ts) return;
    const age = now - ts;
    const isInFlight = r.ok === undefined && age <= MAX_INFLIGHT_MS;
    const isRecent = age <= RECENT_FLOW_MS;
    if(!isInFlight && !isRecent) return;

    const rawAgent = String(r.clientAgent || '').trim() || 'API Client';
    const agId = CLIENT_AGENT_TO_ID[rawAgent.toLowerCase()];
    const model = String(r.model || '');
    const prefix = model.includes(':') ? model.split(':')[0].trim().toLowerCase() : '';
    let provKey = '';
    if(prefix && builtinIds.has(prefix)) provKey = prefix;
    else if(prefix && (customById[prefix] || customByName[prefix])) provKey = (customById[prefix] || customByName[prefix]).id;
    const provKnown = !!provKey;
    const isKnownAgent = !!(agId && knownIds.has(agId));
    const bucket = isKnownAgent ? agents : others;
    const key = isKnownAgent ? agId : rawAgent;
    const a = bucket[key] || (bucket[key] = blank());

    if(isInFlight) a.liveCount += 1;
    a.recentCount += 1;
    if(ts > a.lastTs){
      a.lastTs = ts;
      a.latestModel = model.replace(/^[a-z0-9_-]+:/i, '');
      a.latestStream = !!r.stream;
      a.latestLatency = r.latencyMs || 0;
      a.latestTokens = r.tokens || 0;
      a.latestOk = r.ok;
      if(provKnown){
        a.provId = provKey;
        a.provTs = ts;
      }
    }
    if(isInFlight && provKnown && ts > a.inflightProvTs){
      a.inflightProvTs = ts;
      a.inflightProvId = provKey;
    }

    if(provKnown){
      const p = provs[provKey] || (provs[provKey] = blank());
      if(isInFlight) p.liveCount += 1;
      p.recentCount += 1;
      if(ts > p.lastTs){
        p.lastTs = ts;
        p.latestModel = model.replace(/^[a-z0-9_-]+:/i, '');
        p.latestStream = !!r.stream;
        p.latestLatency = r.latencyMs || 0;
        p.latestTokens = r.tokens || 0;
        p.latestOk = r.ok;
      }
    }
  });

  return { agents, others, provs, now };
}

// Render rich interactive request flow nodes on the inbound side
function renderTopologyAgentNodes(){
  const listEl = document.getElementById('topologyAgentList');
  if(!listEl) return;
  const live = collectLiveTraffic();
  const nodeSpecs = [];

  // 1. Agents with live in-flight or recent traffic ONLY
  detectedAgents.forEach(ag => {
    const act = live.agents[ag.id];
    if(act && (act.liveCount > 0 || act.recentCount > 0)){
      nodeSpecs.push({
        key: ag.id,
        isKnown: true,
        name: ag.name || AGENT_SHORT_NAMES[ag.id] || ag.id,
        lastTs: act.lastTs,
        act
      });
    }
  });

  Object.entries(live.others).forEach(([rawName, o]) => {
    if(o && (o.liveCount > 0 || o.recentCount > 0)){
      nodeSpecs.push({
        key: 'cli:' + String(rawName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cli:unknown',
        isKnown: false,
        name: rawName,
        lastTs: o.lastTs,
        act: o
      });
    }
  });

  // Sort: in-flight first, then most recent traffic
  nodeSpecs.sort((a, b) => {
    if((b.act.liveCount || 0) !== (a.act.liveCount || 0)) return (b.act.liveCount || 0) - (a.act.liveCount || 0);
    return (b.lastTs || 0) - (a.lastTs || 0);
  });

  if(nodeSpecs.length === 0){
    const empty = 
      '<div class="topo-empty-state">' +
        '<div class="topo-empty-icon">' +
          '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted);opacity:0.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
        '</div>' +
        '<div class="topo-empty-title" data-i18n="topoWaitingRequests">' + esc(t('topoWaitingRequests')) + '</div>' +
        '<div class="topo-empty-desc" data-i18n="topoWaitingRequestsSub">' + esc(t('topoWaitingRequestsSub')) + '</div>' +
      '</div>';
    if(listEl.__lastSig !== empty){
      listEl.__lastSig = empty;
      listEl.innerHTML = empty;
    }
    updateTopologyFlowLines();
    return;
  }

  const genericGlyph = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted)"><path d="M4 17l6-6-6-6"/><path d="M12 19h8"/></svg>';
  const markup = nodeSpecs.map(spec => {
    const act = spec.act;
    const full = esc(spec.name);
    const short = esc(spec.isKnown ? (AGENT_SHORT_NAMES[spec.key] || spec.name) : spec.name);
    const isInFlight = act.liveCount > 0;
    const hasRecent = act.recentCount > 0;
    const icon = spec.isKnown ? getBrandIcon(spec.key) : genericGlyph;

    const targetProvId = act.inflightProvId || act.provId || '';
    let targetProvName = '';
    if(targetProvId){
      const prov = (((stateData || {}).providers) || []).find(x => x.id === targetProvId)
        || ((((stateData || {}).customProviders) || [])).find(x => x.id === targetProvId);
      if(prov) targetProvName = prov.name;
    }

    const statusBadge = isInFlight
      ? '<span class="badge badge-success topo-pulse-badge" style="font-size:8.5px;padding:2px 6px"><span class="status-dot dot-running" style="width:6px;height:6px"></span> ' + t('topoInFlight') + (act.liveCount > 1 ? ' ×' + act.liveCount : '') + '</span>'
      : '<span class="badge" style="font-size:8.5px;padding:2px 6px;color:var(--primary);border-color:rgba(59,130,246,0.3)">' + t('topoRecent') + '</span>';

    const reqChips = act.latestModel ? (
      '<div class="topo-req-chips">' +
        '<span class="topo-model-chip" title="' + esc(act.latestModel) + '">' + esc(act.latestModel) + '</span>' +
        '<span class="' + (act.latestStream ? 'topo-stream-chip' : 'topo-sync-chip') + '">' + (act.latestStream ? t('topoStreamSse') : t('topoNormal')) + '</span>' +
      '</div>'
    ) : '';

    const footer = (targetProvName || act.latestLatency) ? (
      '<div class="topo-node-footer">' +
        '<span class="topo-dest-badge">' + (targetProvName ? t('topoRouteTo') + ': <strong>' + esc(targetProvName) + '</strong>' : '') + '</span>' +
        '<span class="topo-metrics-text">' + (act.latestLatency ? act.latestLatency + 'ms' : '') + (act.latestTokens ? ' · ' + act.latestTokens.toLocaleString() + ' ' + t('tokenUnit') : '') + '</span>' +
      '</div>'
    ) : '';

    const nodeClass = 'topology-node topo-agent' + (isInFlight ? ' node-inflight' : ' node-active-flow');

    return (
      '<div class="' + nodeClass + '" data-agent-id="' + esc(spec.key) + '" data-installed="1" data-status="' + (isInFlight ? 'inflight' : 'active') + '" data-live="' + (isInFlight ? '1' : '0') + '" data-recent="' + (hasRecent ? '1' : '0') + '" data-prov-id="' + esc(targetProvId) + '" data-model="' + esc(act.latestModel || '') + '" data-name="' + full + '" tabindex="0">' +
        '<span class="topo-port port-left" title="' + esc(t('agentPortTitle')) + '"></span>' +
        '<div class="topo-node-header">' +
          '<div class="topo-node-main">' +
            '<div class="topo-icon-badge">' + icon + '</div>' +
            '<div class="topo-provider-name" title="' + full + '">' + short + '</div>' +
          '</div>' +
          '<div class="topo-status-badge">' + statusBadge + '</div>' +
        '</div>' +
        reqChips +
        footer +
      '</div>'
    );
  }).join('');

  if(listEl.__lastSig !== markup){
    listEl.__lastSig = markup;
    listEl.innerHTML = markup;
  }
  updateTopologyFlowLines();
}

async function loadDetectedAgents(){
  try{
    const res = await api('/api/gateway/agents/detect');
    detectedAgents = res.agents || [];
    const count = detectedAgents.filter(a=>a.installed).length;
    document.getElementById('badgeDetectedAgents').textContent = count;
    renderAgentsList();
    renderTopologyAgentNodes();
    updateSnippetDisplay();
  }catch(e){
    console.error('Failed to detect agents:', e);
    renderTopologyAgentNodes();
  }
}

function renderAgentsList(){
  const sel = document.getElementById('selAgentClient');
  if(!sel) return;
  sel.innerHTML = '';

  const makeLabel = (ag) => {
    const status = ag.isCustom ? (' [' + t('agentCustom') + ']')
      : (ag.isConfigured ? (' [' + t('agentConfigured') + ']')
      : (ag.installed ? (' [' + t('agentInstalled') + ']') : (' [' + t('agentGuide') + ']')));
    return ag.name + status;
  };

  const installed = detectedAgents.filter(a => a.installed || a.isCustom || a.isConfigured);
  const guides = detectedAgents.filter(a => !a.installed && !a.isCustom && !a.isConfigured);

  if(installed.length){
    const og = document.createElement('optgroup');
    og.label = '✓ ' + (t('agentInstalled') || 'Installed');
    installed.forEach(ag => {
      const opt = document.createElement('option');
      opt.value = ag.id;
      opt.textContent = makeLabel(ag);
      og.appendChild(opt);
    });
    sel.appendChild(og);
  }
  if(guides.length){
    const og = document.createElement('optgroup');
    og.label = '• ' + (t('agentGuide') || 'Guide');
    guides.forEach(ag => {
      const opt = document.createElement('option');
      opt.value = ag.id;
      opt.textContent = makeLabel(ag);
      og.appendChild(opt);
    });
    sel.appendChild(og);
  }

  if(!detectedAgents.find(a=>a.id===selectedAgentId) && detectedAgents.length){
    selectedAgentId = detectedAgents[0].id;
  }
  sel.value = selectedAgentId;
  renderMcpAgentsList();
}

function selectAgentFromDropdown(id){
  if(!id) return;
  selectedAgentId = id;
  updateSnippetDisplay();
}

// connectMode declared above in shared gateway state

function setConnectMode(mode, btn){
  connectMode = mode || 'auto';
  document.querySelectorAll('.connect-tab').forEach(el=>el.classList.toggle('active', el.dataset.connectTab === connectMode));
  ['auto','manual','mcp'].forEach(m=>{
    const panel = document.getElementById('connectMode' + m.charAt(0).toUpperCase() + m.slice(1));
    if(panel) panel.classList.toggle('active', m === connectMode);
  });
  if(connectMode === 'mcp') updateMcpConfigDisplay();
  if(connectMode === 'manual') updateSnippetDisplay();
}

function onConnectModelChange(){
  updateSnippetDisplay();
  if(connectMode === 'mcp') updateMcpConfigDisplay();
}

function getSelectedConnectAgent(){
  return detectedAgents.find(a=>a.id === selectedAgentId) || { name: 'OpenCode', id: 'opencode', installed: false, protocol: 'openai' };
}

function renderMcpAgentsList(){
  const sel = document.getElementById('selMcpAgent');
  if(!sel) return;
  sel.innerHTML = '';
  if(!Array.isArray(detectedAgents) || detectedAgents.length === 0){
    const opt = document.createElement('option');
    opt.value = selectedAgentId || 'opencode';
    opt.textContent = 'OpenCode';
    sel.appendChild(opt);
    return;
  }
  const makeLabel = (ag) => {
    const status = ag.isCustom ? (' [' + t('agentCustom') + ']')
      : (ag.isConfigured ? (' [' + t('agentConfigured') + ']')
      : (ag.installed ? (' [' + t('agentInstalled') + ']') : (' [' + t('agentGuide') + ']')));
    return ag.name + status;
  };
  const installed = detectedAgents.filter(a => a.installed || a.isCustom || a.isConfigured);
  const guides = detectedAgents.filter(a => !a.installed && !a.isCustom && !a.isConfigured);
  const appendGroup = (label, arr) => {
    if(!arr.length) return;
    const og = document.createElement('optgroup');
    og.label = label;
    arr.forEach(ag => {
      const opt = document.createElement('option');
      opt.value = ag.id;
      opt.textContent = makeLabel(ag);
      og.appendChild(opt);
    });
    sel.appendChild(og);
  };
  appendGroup('✓ ' + (t('agentInstalled') || 'Installed'), installed);
  appendGroup('• ' + (t('agentGuide') || 'Guide'), guides);
  if(!detectedAgents.find(a=>a.id===selectedAgentId) && detectedAgents.length){
    selectedAgentId = detectedAgents[0].id;
  }
  sel.value = selectedAgentId;
}

function onMcpAgentChange(id){
  if(!id) return;
  selectedAgentId = id;
  const mainSel = document.getElementById('selAgentClient');
  if(mainSel) mainSel.value = id;
  updateSnippetDisplay();
}

function resolveMcpTarget(target, ag){
  const id = (ag && ag.id) || '';
  if(target && target !== 'auto') return target;
  if(id === 'claudecode') return 'claude';
  if(id === 'cursor') return 'cursor';
  if(id === 'windsurf') return 'windsurf';
  if(id === 'vscode' || id === 'continue' || id === 'roocode' || id === 'copilot') return 'vscode';
  if(id === 'zed') return 'zed';
  if(id === 'opencode') return 'opencode';
  return 'generic';
}

function updateMcpConfigDisplay(){
  const pre = document.getElementById('dtMcpConfigCode');
  if(!pre) return;
  const ag = getSelectedConnectAgent();
  const mcpAgentSel = document.getElementById('selMcpAgent');
  if(mcpAgentSel && ag && ag.id && mcpAgentSel.value !== ag.id && Array.from(mcpAgentSel.options).some(o=>o.value===ag.id)){
    mcpAgentSel.value = ag.id;
  }
  const origin = window.location.origin || ((document.getElementById('inpBaseUrl')?.value || 'http://127.0.0.1:8989/v1').replace(new RegExp('/v1/?$'),''));
  const apiKey = document.getElementById('inpApiKey')?.value || 'emo.web';
  const model = document.getElementById('selSnippetModel')?.value || 'claude-web:default';
  const targetSel = document.getElementById('selMcpTarget')?.value || 'auto';
  const target = resolveMcpTarget(targetSel, ag);
  const serverName = 'emo.web';
  const baseV1 = (document.getElementById('inpBaseUrl')?.value || (origin + '/v1')).replace(new RegExp('/$'),'');
  const mcpUrl = origin + '/mcp';

  const header = [
    '# Agent: ' + (ag.name || ag.id || 'agent') + ' (' + (ag.id || '-') + ')',
    '# Model: ' + model,
    '# Gateway: ' + baseV1,
    '# MCP Server Name: ' + serverName,
    '# Target format: ' + target
  ].join('\\n');

  let cfg = '';
  if(target === 'zed'){
    const obj = {
      context_servers: {
        [serverName]: {
          command: 'npx',
          args: ['-y', 'mcp-remote', mcpUrl],
          env: {
            GATEWAY_BASE_URL: baseV1,
            GATEWAY_API_KEY: apiKey,
            TARGET_AGENT: ag.id || 'agent',
            TARGET_MODEL: model
          }
        }
      }
    };
    cfg = header + '\\n' + JSON.stringify(obj, null, 2) + '\\n\\n# File hint: add under "context_servers" in Zed settings.json.';
  } else if(target === 'opencode'){
    const obj = {
      mcp: {
        [serverName]: {
          type: 'local',
          command: ['npx', '-y', 'mcp-remote', mcpUrl],
          environment: {
            GATEWAY_BASE_URL: baseV1,
            GATEWAY_API_KEY: apiKey,
            TARGET_AGENT: ag.id || 'agent',
            TARGET_MODEL: model
          },
          enabled: true
        }
      }
    };
    cfg = header + '\\n' + JSON.stringify(obj, null, 2) + '\\n\\n# File hint: merge into OpenCode MCP configuration (e.g. opencode.json) according to your client schema.';
  } else {
    const env = {
      GATEWAY_BASE_URL: baseV1,
      GATEWAY_API_KEY: apiKey,
      TARGET_AGENT: ag.id || 'agent',
      TARGET_MODEL: model
    };
    const obj = {
      mcpServers: {
        [serverName]: {
          command: 'npx',
          args: ['-y', 'mcp-remote', mcpUrl],
          env
        }
      }
    };
    cfg = header + '\\n' + JSON.stringify(obj, null, 2);
    if(target === 'cursor'){
      cfg += '\\n\\n# File hint: place in .cursor/mcp.json (or Cursor MCP settings).';
    } else if(target === 'windsurf'){
      cfg += '\\n\\n# File hint: place in Windsurf MCP config (e.g. mcp_config.json / MCP settings).';
    } else if(target === 'vscode'){
      cfg += '\\n\\n# File hint: place in .vscode/mcp.json for VS Code / Copilot Chat MCP.';
    } else if(target === 'claude'){
      cfg += '\\n\\n# File hint: add under "mcpServers" in Claude Desktop config.';
    } else {
      cfg += '\\n\\n# Generic MCP config using mcp-remote. Adapt keys/file location to your client if needed.';
    }
  }

  pre.textContent = cfg;
}

async function copyMcpConfig(btn){
  const pre = document.getElementById('dtMcpConfigCode');
  const text = pre ? pre.textContent : '';
  await navigator.clipboard.writeText(text).catch(()=>{});
  if(btn){
    const old = btn.textContent;
    btn.textContent = t('copied');
    setTimeout(()=>btn.textContent=old, 1500);
  }
  showToast(t('toastSettingsCopied'));
}

function updateSnippetDisplay(){
  const ag = detectedAgents.find(a=>a.id === selectedAgentId) || { name: 'OpenCode', id: 'opencode', installed: false };
  const origin = window.location.origin;
  const apiKey = document.getElementById('inpApiKey').value || 'emo.web';
  const selModel = document.getElementById('selSnippetModel').value || 'claude-web:claude-3-7-sonnet';

  const sel = document.getElementById('selAgentClient');
  if(sel && sel.value !== selectedAgentId) sel.value = selectedAgentId;
  const mcpSel = document.getElementById('selMcpAgent');
  if(mcpSel && ag && ag.id && mcpSel.options.length && Array.from(mcpSel.options).some(o=>o.value===ag.id) && mcpSel.value !== ag.id){
    mcpSel.value = ag.id;
  }

  document.getElementById('dtClientName').textContent = ag.name;
  document.getElementById('dtClientIcon').innerHTML = getBrandIcon(ag.id);
  document.getElementById('dtClientPath').textContent = ag.path ? (t('pathLabel') + ' ' + ag.path) : t('editorReady');
  document.getElementById('dtClientStatusBadge').className = 'badge ' + (ag.installed ? 'badge-success' : 'badge-warn');
  document.getElementById('dtClientStatusBadge').textContent = ag.installed ? t('installedOnDevice') : t('setupGuide');

  const protocolEl = document.getElementById('dtClientProtocol');
  if(protocolEl) protocolEl.textContent = ag.protocol || 'openai';
  const deleteBtn = document.getElementById('btnDeleteCustomAgent');
  if(deleteBtn) deleteBtn.style.display = ag.isCustom ? '' : 'none';
  const autoBar = document.getElementById('autoConnectBar');
  if(autoBar){
    autoBar.style.display = ag.canAutoConfigure ? 'flex' : 'none';
    const btn = document.getElementById('btnAutoConnectAgent');
    if(btn){
      // Not-installed agents get a disabled button + truthful tooltip
      btn.disabled = !ag.canAutoConfigure || (!ag.isCustom && !ag.installed);
      btn.title = (!ag.isCustom && !ag.installed) ? t('agentNotInstalledMsg') : '';
    }
  }

  let snippet = '';
  if(ag.id === 'claudecode'){
    snippet = [
      t('snipEnvSetup'),
      'export ANTHROPIC_BASE_URL="' + origin + '"',
      'export ANTHROPIC_API_KEY="' + apiKey + '"',
      '',
      t('snipRunClaude'),
      'claude --model ' + selModel
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'cursor' || ag.id === 'windsurf'){
    snippet = [
      t('snipCursorModels', { name: ag.name }),
      'OpenAI Base URL : ' + origin + '/v1',
      'OpenAI API Key  : ' + apiKey,
      'Model Override  : ' + selModel
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'vscode'){
    snippet = [
      t('snipVsCode'),
      '{',
      '  "openai.baseUrl": "' + origin + '/v1",',
      '  "openai.apiKey": "' + apiKey + '",',
      '  "openai.model": "' + selModel + '"',
      '}'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'python'){
    snippet = [
      t('snipPythonOpenAI'),
      'from openai import OpenAI',
      '',
      'client = OpenAI(',
      '    base_url="' + origin + '/v1",',
      '    api_key="' + apiKey + '"',
      ')',
      '',
      'response = client.chat.completions.create(',
      '    model="' + selModel + '",',
      '    messages=[{"role": "user", "content": "' + t('snipPythonHello') + '"}]',
      ')',
      'print(response.choices[0].message.content)',
      '',
      t('snipPythonAnthropic'),
      'import anthropic',
      'client = anthropic.Anthropic(base_url="' + origin + '", api_key="' + apiKey + '")',
      'msg = client.messages.create(model="' + selModel + '", max_tokens=1000, messages=[{"role":"user","content":"' + t('snipHello') + '"}])'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'geminicli'){
    const sq = String.fromCharCode(39);
    snippet = [
      t('snipGeminiSetup'),
      'export GEMINI_API_BASE_URL="' + origin + '"',
      'export GEMINI_API_KEY="' + apiKey + '"',
      '',
      t('snipGeminiCurl'),
      'curl -X POST "' + origin + '/v1beta/models/' + selModel + ':generateContent" ' +
      '-H "x-goog-api-key: ' + apiKey + '" ' +
      '-H "Content-Type: application/json" ' +
      '-d ' + sq + '{"contents":[{"role":"user","parts":[{"text":"' + t('snipGeminiHello') + '"}]}]}' + sq
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'hermes'){
    snippet = [
      t('snipHermesSetup'),
      'export OPENAI_BASE_URL="' + origin + '/v1"',
      'export OPENAI_API_KEY="' + apiKey + '"',
      'export HERMES_MODEL="' + selModel + '"',
      '',
      'hermes --model ' + selModel
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'antigravity'){
    snippet = [
      '# Antigravity (agy) → ~/.gemini/config/config.json',
      '{',
      '  "gateway": {',
      '    "baseURL": "' + origin + '/v1",',
      '    "apiKey": "' + apiKey + '",',
      '    "enabled": true',
      '  }',
      '}',
      '',
      t('snipEnvVarsAlt'),
      'export OPENAI_BASE_URL="' + origin + '/v1"',
      'export OPENAI_API_KEY="' + apiKey + '"',
      'export GEMINI_API_ENDPOINT="' + origin + '"'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'codex'){
    snippet = [
      '# Codex CLI/IDE → ~/.codex/config.toml',
      '[providers.emo_gateway]',
      'base_url = "' + origin + '/v1"',
      'api_key = "' + apiKey + '"',
      'enabled = true',
      '',
      t('snipThenRun'),
      'codex --model ' + selModel
    ].join(String.fromCharCode(10));
  } else if(ag.id === 't3'){
    snippet = [
      '// T3 Code → ~/.t3/userdata/settings.json',
      '{',
      '  "providerInstances": {',
      '    "emoGateway": {',
      '      "driver": "opencode",',
      '      "displayName": "EMO Gateway",',
      '      "enabled": true,',
      '      "baseURL": "' + origin + '/v1",',
      '      "apiKey": "' + apiKey + '"',
      '    }',
      '  }',
      '}'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'lobehub'){
    snippet = [
      '// LobeHub → ~/Library/Application Support/LobeHub/gateway-config.json',
      '{',
      '  "openai": {',
      '    "endpoint": "' + origin + '/v1",',
      '    "apiKey": "' + apiKey + '"',
      '  }',
      '}'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'jan'){
    snippet = [
      '// Jan AI → ~/Library/Application Support/Jan/data/settings.json',
      '{',
      '  "model-provider": "{\\"state\\":{\\"providers\\":[{\\"provider\\":\\"openai\\",\\"base_url\\":\\"' + origin + '/v1\\",\\"settings\\":[{\\"key\\":\\"api_key\\",\\"controller_props\\":{\\"value\\":\\"' + apiKey + '\\"}}]}]}}"',
      '}'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'anythingllm'){
    snippet = [
      '# AnythingLLM → ~/Library/Application Support/anythingllm-desktop/storage/.env',
      "LLM_PROVIDER='generic-openai'",
      "GENERIC_OPEN_AI_BASE_PATH='" + origin + "/v1'",
      "GENERIC_OPEN_AI_API_KEY='" + apiKey + "'",
      "GENERIC_OPEN_AI_MODEL_PREF='" + selModel + "'",
      "GENERIC_OPEN_AI_MAX_TOKENS='8192'"
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'librechat'){
    snippet = [
      '# LibreChat → ~/.config/librechat/librechat.yaml',
      'version: 1.0.8',
      'endpoints:',
      '  custom:',
      '    - name: "EMO.ai Gateway"',
      '      apiKey: "' + apiKey + '"',
      '      baseURL: "' + origin + '/v1"',
      '      models:',
      '        default: ["' + selModel + '"]'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'zed'){
    snippet = [
      '// Zed → ~/.config/zed/settings.json',
      '{',
      '  "language_models": {',
      '    "openai": {',
      '      "api_url": "' + origin + '/v1",',
      '      "available_models": [',
      '        { "name": "' + selModel + '", "max_tokens": 8192 }',
      '      ]',
      '    }',
      '  }',
      '}'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'pi'){
    snippet = [
      '// PI Agent → ~/.config/pi/config.json',
      '{',
      '  "baseURL": "' + origin + '/v1",',
      '  "apiKey": "' + apiKey + '",',
      '  "activeModel": "' + selModel + '"',
      '}'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'alphacode'){
    snippet = [
      '// AlphaCode → ~/.config/alphacode/config.json',
      '{',
      '  "api_url": "' + origin + '/v1",',
      '  "api_key": "' + apiKey + '"',
      '}'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'kiro'){
    snippet = [
      '// Kiro Code / Kilo Code → ~/.kiro/config.json',
      '{',
      '  "baseURL": "' + origin + '/v1",',
      '  "apiKey": "' + apiKey + '"',
      '}'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'openwebui'){
    snippet = [
      '# Open WebUI → ~/.config/open-webui/.env',
      'OPENAI_API_BASE_URL=' + origin + '/v1',
      'OPENAI_API_KEY=' + apiKey,
      '',
      '// أو في config.json:',
      '{ "openai": { "api_base": "' + origin + '/v1", "api_key": "' + apiKey + '", "enabled": true } }'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'dify'){
    snippet = [
      '# Dify → ~/.config/dify/.env أو إعدادات مزود النموذج',
      'OPENAI_API_BASE=' + origin + '/v1',
      'OPENAI_API_KEY=' + apiKey,
      '',
      '# في واجهة Dify: Settings > Model Providers > OpenAI-API-compatible',
      '# Base URL: ' + origin + '/v1',
      '# Model: ' + selModel
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'flowise'){
    snippet = [
      '# Flowise → ~/.config/flowise/.env',
      'OPENAI_API_BASE=' + origin + '/v1',
      'OPENAI_API_KEY=' + apiKey,
      '',
      '# في عقد ChatOpenAI: Base Path = ' + origin + '/v1'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'n8n'){
    snippet = [
      '# n8n → ~/.n8n/config أو متغيرات البيئة',
      'N8N_OPENAI_API_BASE=' + origin + '/v1',
      'N8N_OPENAI_API_KEY=' + apiKey,
      '',
      '# في عقدة OpenAI: استخدم Base URL مخصص = ' + origin + '/v1'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'continue'){
    snippet = [
      '// Continue (VS Code) → إعدادات Continue / settings.json',
      '{',
      '  "continue.apiBase": "' + origin + '/v1",',
      '  "continue.apiKey": "' + apiKey + '",',
      '  "continue.model": "' + selModel + '"',
      '}'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'roocode'){
    snippet = [
      '// Roo Code (VS Code) → settings.json',
      '{',
      '  "roo-cline.openAiBaseUrl": "' + origin + '/v1",',
      '  "roo-cline.openAiApiKey": "' + apiKey + '",',
      '  "roo-cline.model": "' + selModel + '"',
      '}'
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'aider'){
    snippet = [
      '# Aider → ~/.aider.conf.yml',
      'openai-api-base: ' + origin + '/v1',
      'openai-api-key: ' + apiKey,
      'model: ' + selModel,
      '',
      '# أو عبر متغيرات البيئة:',
      'export OPENAI_API_BASE="' + origin + '/v1"',
      'export OPENAI_API_KEY="' + apiKey + '"',
      'aider --model ' + selModel
    ].join(String.fromCharCode(10));
  } else if(ag.id === 'sillytavern'){
    snippet = [
      '# SillyTavern → API Connections > Chat Completion (OpenAI)',
      'API URL: ' + origin + '/v1',
      'API Key: ' + apiKey,
      'Model: ' + selModel,
      '',
      '# config.yaml hint:',
      '# gateway:',
      '#   openai_base_url: ' + origin + '/v1',
      '#   openai_api_key: ' + apiKey
    ].join(String.fromCharCode(10));
  } else {
    // OpenCode or general CLI / custom agent
    snippet = [
      'export OPENAI_BASE_URL="' + origin + '/v1"',
      'export OPENAI_API_KEY="' + apiKey + '"',
      'export OPENAI_MODEL="' + selModel + '"',
      '',
      t('snipCallAgent'),
      ag.command || ag.id || 'opencode'
    ].join(String.fromCharCode(10));
  }

  const snippetEl = document.getElementById('dtSnippetCode');
  if(snippetEl) snippetEl.textContent = snippet;
  updateMcpConfigDisplay();
}

// Rescan local agents on the device
async function rescanLocalAgents(){
  const btn = document.getElementById('btnRescanAgents');
  if(btn){ btn.disabled = true; btn.textContent = t('scanningAgents'); }
  showToast(t('scanningAgentsToast'), 'info');
  try{
    const res = await api('/api/gateway/agents/rescan', { method: 'POST' });
    detectedAgents = res.agents || [];
    const count = detectedAgents.filter(a=>a.installed).length;
    const badge = document.getElementById('badgeDetectedAgents');
    if(badge) badge.textContent = count;
    renderAgentsList();
    renderTopologyAgentNodes();
    updateSnippetDisplay();
    showToast(t('agentsScanDone').replace('{count}', count), 'success');
  }catch(e){
    console.error('Failed to rescan agents:', e);
    showToast(e.message || String(e), 'error');
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = t('btnRescanAgents'); }
  }
}

// One-click auto-configure the currently selected agent
async function autoConnectCurrentAgent(){
  const ag = detectedAgents.find(a=>a.id === selectedAgentId);
  if(!ag){ showToast(t('noAgentSelected'), 'error'); return; }
  // Honest guard: refuse to auto-bind an agent that is not actually installed.
  if(!ag.isCustom && !ag.installed){
    showToast(t('agentNotInstalledMsg'), 'error');
    return;
  }
  const btn = document.getElementById('btnAutoConnectAgent');
  if(btn){ btn.disabled = true; btn.textContent = t('autoConnecting'); }
  try{
    const res = await api('/api/gateway/agents/' + encodeURIComponent(ag.id) + '/auto-configure', { method: 'POST' });
    if(res && res.success){
      showToast(res.message || t('autoConnectSuccess'), 'success');
      await loadDetectedAgents();
    } else {
      showToast((res && res.message) || t('autoConnectFailed'), 'error');
    }
  }catch(e){
    console.error('Auto-configure failed:', e);
    showToast(e.message || String(e), 'error');
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = t('btnAutoConnect'); }
  }
}

// Custom agent modal
function openAddCustomAgentModal(){
  ['inpCustomAgentName','inpCustomAgentId','inpCustomAgentIcon','inpCustomAgentCommand','inpCustomAgentConfigPath','inpCustomAgentNotes'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  const proto = document.getElementById('selCustomAgentProtocol');
  if(proto) proto.value = 'openai';
  document.getElementById('addCustomAgentModal').classList.add('open');
}
function closeAddCustomAgentModal(){
  document.getElementById('addCustomAgentModal').classList.remove('open');
}
async function saveCustomAgent(){
  const name = document.getElementById('inpCustomAgentName').value.trim();
  if(!name){ showToast(t('agentNameRequired'), 'error'); return; }
  const body = {
    name,
    id: document.getElementById('inpCustomAgentId').value.trim() || undefined,
    icon: document.getElementById('inpCustomAgentIcon').value.trim() || undefined,
    protocol: document.getElementById('selCustomAgentProtocol').value,
    command: document.getElementById('inpCustomAgentCommand').value.trim() || undefined,
    configPath: document.getElementById('inpCustomAgentConfigPath').value.trim() || undefined,
    notes: document.getElementById('inpCustomAgentNotes').value.trim() || undefined,
  };
  try{
    const res = await api('/api/gateway/agents/custom', { method: 'POST', body: JSON.stringify(body) });
    showToast(t('agentSaved'), 'success');
    closeAddCustomAgentModal();
    await loadDetectedAgents();
    if(res && res.agent) selectedAgentId = res.agent.id;
    renderAgentsList();
    updateSnippetDisplay();
  }catch(e){
    showToast(e.message || String(e), 'error');
  }
}
async function deleteCurrentCustomAgent(){
  const ag = detectedAgents.find(a=>a.id === selectedAgentId);
  if(!ag || !ag.isCustom){ showToast(t('notCustomAgent'), 'error'); return; }
  if(!confirm(t('confirmDeleteAgent').replace('{name}', ag.name))) return;
  try{
    await api('/api/gateway/agents/custom/' + encodeURIComponent(ag.id), { method: 'DELETE' });
    showToast(t('agentDeleted'), 'success');
    selectedAgentId = 'opencode';
    await loadDetectedAgents();
    renderAgentsList();
    updateSnippetDisplay();
  }catch(e){
    showToast(e.message || String(e), 'error');
  }
}

// Render Providers
function toggleProviderFilter(provId){
  if(provId === 'all'){
    selectedProviderFilters.clear();
  } else if(provId === '__enabled__'){
    const enabled = ((stateData && Array.isArray(stateData.providers)) ? stateData.providers : []).filter(p=>p.enabled);
    const alreadyOnlyEnabled = enabled.length > 0 &&
      selectedProviderFilters.size === enabled.length &&
      enabled.every(p => selectedProviderFilters.has(p.id));
    selectedProviderFilters.clear();
    if(!alreadyOnlyEnabled){
      enabled.forEach(p=>selectedProviderFilters.add(p.id));
    }
  } else {
    if(selectedProviderFilters.has(provId)){
      selectedProviderFilters.delete(provId);
    } else {
      selectedProviderFilters.add(provId);
    }
  }
  if(stateData && Array.isArray(stateData.providers)){
    renderProvidersGrid(stateData.providers, true);
  }
}

function renderProvidersGrid(providers, force=false){
  const grid = document.getElementById('providersGrid');
  const filterBar = document.getElementById('providersFilterBar');
  if(!grid || !Array.isArray(providers)) return;

  const filterKey = Array.from(selectedProviderFilters).sort().join(',');
  const sig = filterKey + '::' + JSON.stringify(providers.map(p=>({
    id: p.id,
    status: p.status,
    enabled: p.enabled,
    availableModels: p.availableModels,
    selectedModels: p.selectedModels,
    settings: p.settings,
    accounts: p.accounts,
    accountEmail: p.accountEmail,
    accountName: p.accountName,
    isLoggedIn: p.isLoggedIn,
    meta: p.meta,
    connection: p.connection,
    capabilities: p.capabilities
  })));
  if(!force && grid.__lastSig === sig && grid.children.length > 0) return;
  grid.__lastSig = sig;

  const isAllSelected = selectedProviderFilters.size === 0;
  const enabledProviders = providers.filter(p => p.enabled);
  const isEnabledSelected = !isAllSelected && enabledProviders.length > 0 &&
    selectedProviderFilters.size === enabledProviders.length &&
    enabledProviders.every(p => selectedProviderFilters.has(p.id));
  const visibleProviders = isAllSelected
    ? providers
    : providers.filter(p => selectedProviderFilters.has(p.id));

  if(filterBar){
    const pillsHtml =
      '<button type="button" class="prov-filter-pill ' + (isAllSelected ? 'active' : '') + '" data-pfilter="all">' +
        '<span>' + t('filterShowAll') + '</span>' +
        '<span class="pill-count">' + providers.length + '</span>' +
      '</button>' +
      '<button type="button" class="prov-filter-pill prov-filter-pill-enabled ' + (isEnabledSelected ? 'active' : '') + '" data-pfilter="__enabled__" title="' + esc(t('filterShowEnabled')) + '">' +
        '<span>' + t('filterShowEnabled') + '</span>' +
        '<span class="pill-count">' + enabledProviders.length + '</span>' +
      '</button>' +
      providers.map(p => {
        const isSel = selectedProviderFilters.has(p.id);
        const mCount = [...new Set([...(p.availableModels||[]), ...(p.selectedModels||[])])].length;
        const dotColor = p.status === 'running' ? 'var(--success)' : (p.enabled ? 'var(--primary)' : 'var(--text-dim)');
        return (
          '<button type="button" class="prov-filter-pill ' + (isSel ? 'active' : '') + '" data-pfilter="' + esc(p.id) + '" title="' + esc(t('filterPillTitle', { name: p.name })) + '">' +
            getBrandIcon(p.id) +
            '<span>' + esc(p.name) + '</span>' +
            '<span class="pill-count">' + mCount + '</span>' +
            '<span style="color:' + dotColor + ';font-size:10px">' + (isSel ? '✓' : '●') + '</span>' +
          '</button>'
        );
      }).join('');

    filterBar.innerHTML =
      '<div class="providers-filter-header">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<strong style="font-size:12.5px;color:var(--text)">' + t('filterProvidersHeader') + '</strong>' +
          '<span style="font-size:11.5px;color:var(--text-muted)">' + t('filterProvidersSub') + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span class="badge ' + (isAllSelected ? '' : 'badge-success') + '" style="font-size:11px">' +
            (isAllSelected ? (t('filterShownCountAll') + ' (' + providers.length + ')') : t('filterShownCount', { shown: visibleProviders.length, total: providers.length })) +
          '</span>' +
          (!isAllSelected ? '<button type="button" class="btn-sm" data-pfilter="all" style="font-size:11px;padding:3px 9px">' + t('filterClear') + '</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="prov-filter-pills">' + pillsHtml + '</div>';

    filterBar.querySelectorAll('button[data-pfilter]').forEach(btn => {
      btn.onclick = () => toggleProviderFilter(btn.dataset.pfilter);
    });
  }

  grid.innerHTML = '';

  visibleProviders.forEach(p=>{
    const card = document.createElement('div');
    card.className = 'provider-card';

    const isRunning = p.status === 'running';
    const isStarting = p.status === 'starting';
    const dotClass = isRunning ? 'dot-running' : isStarting ? 'dot-starting' : p.status === 'error' ? 'dot-error' : 'dot-stopped';
    const statusLabel = isRunning ? t('statusRunning') : isStarting ? t('statusStarting') : p.status === 'error' ? t('statusError') : t('statusStopped');

    // Single unified start/stop button
    let toggleBtnHtml = '';
    if(isRunning){
      toggleBtnHtml = '<button class="btn-stop btn-sm" data-act="toggleRun" data-id="' + esc(p.id) + '" data-status="running">' + t('btnStop') + '</button>';
    } else if(isStarting){
      toggleBtnHtml = '<button class="btn-sm" disabled>' + t('statusStarting') + '</button>';
    } else {
      toggleBtnHtml = '<button class="btn-start btn-sm" data-act="toggleRun" data-id="' + esc(p.id) + '" data-status="stopped">' + t('btnStart') + '</button>';
    }

    // Account pills bar
    const accounts = Array.isArray(p.accounts) && p.accounts.length > 0 ? p.accounts : (
      p.accountEmail ? [{ id: 'acc_def', name: p.accountName||p.accountEmail, email: p.accountEmail, isLoggedIn: p.isLoggedIn, active: true }] : []
    );

    let chipsHtml = '';
    if(accounts.length === 0){
      chipsHtml = '<span style="font-size:11px;color:var(--text-dim)">' + t('noAccountsRegistered') + '</span>';
    } else {
      chipsHtml = accounts.map(a=>
        '<span class="account-chip ' + (a.active ? 'active' : '') + '" data-act="quickSwitchAcc" data-pid="' + esc(p.id) + '" data-accid="' + esc(a.id) + '" title="' + esc(t('chipSwitchTitle')) + '">' +
          '<span style="color:' + (a.isLoggedIn ? 'var(--success)' : 'var(--text-dim)') + '">●</span> ' +
          esc(locAccName(a.name || a.email)) +
          (a.active ? ' <small style="font-size:9.5px;color:#93c5fd">' + t('activeAccountPill') + '</small>' : '') +
          '<button type="button" class="chip-delete-btn" data-act="deleteAccChip" data-pid="' + esc(p.id) + '" data-accid="' + esc(a.id) + '" data-accname="' + esc(a.name || a.email) + '" title="' + esc(t('chipDeleteTitle')) + '">×</button>' +
        '</span>'
      ).join('');
    }

    chipsHtml += '<button class="btn-sm" style="padding:2px 7px;font-size:11px" data-act="addAccForProv" data-id="' + esc(p.id) + '">' + t('addAccountBtnShort') + '</button>';

    // The card is rendered from ONE source of truth: the provider card view
    // model built on the server (capabilities + persisted meta + last
    // verified connection report). The UI never invents a status.
    const cardView = p.card || {
      refresh: { labelKey: 'btnFetchModelsLive', busyLabelKey: 'btnWorking', disabled: false, isLive: true },
      test: { labelKey: 'btnTestConnection', busyLabelKey: 'btnWorking', disabled: false, isLive: true },
      models: { sourceLabelKey: 'modelsSourceNone', tone: 'muted', items: [], availableCount: 0, selectedCount: 0 },
      connection: { labelKey: 'connStatusNeverChecked', tone: 'muted' },
      discovery: { status: 'never_scanned', labelKey: 'discoveryNeverScanned', tone: 'muted', unreadChanges: 0, proven: false }
    };
    const toneClass = (tone)=> tone === 'ok' ? 'badge-success' : tone === 'warn' ? 'badge-warn' : tone === 'error' ? 'badge-danger' : '';
    const busyKey = (act)=> p.id + ':' + act;
    const refreshBusy = providerCardBusy.has(busyKey('refreshModels'));
    const testBusy = providerCardBusy.has(busyKey('testConnection'));

    const modelsHtml = (cardView.models.items || []).map(it=>
      '<label class="model-row' + (it.available ? '' : ' model-stale') + '"' + (it.available ? '' : ' title="' + esc(t('modelsStaleBadge')) + '"') + '>' +
        '<input type="checkbox" data-model="' + esc(it.id) + '" data-id="' + esc(p.id) + '" ' + (it.selected?'checked':'') + '/>' +
        '<code>' + esc(it.id) + '</code>' +
        (it.available ? '' : '<span class="badge badge-warn" style="font-size:9.5px">' + esc(t('modelsStaleBadge')) + '</span>') +
      '</label>'
    ).join('') || '<small style="color:var(--text-dim);display:block;padding:6px">' + t('noModelsYet') + '</small>';

    const clientRefreshError = providerCardErrors.get(p.id + ':refreshModels') || '';
    const clientTestError = providerCardErrors.get(p.id + ':testConnection') || '';
    const modelsError = cardView.models.lastError || clientRefreshError;
    const connError = clientTestError;

    const modelsMetaHtml =
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--text-muted)">' +
        '<span class="badge ' + toneClass(cardView.models.tone) + '">' + esc(t('modelsSourceLabel')) + ': ' + esc(t(cardView.models.sourceLabelKey)) + '</span>' +
        '<span>' + esc(cardView.models.lastRefreshAt ? t('modelsLastRefreshAt', { ts: cardView.models.lastRefreshAt }) : t('modelsNeverRefreshed')) + '</span>' +
        (cardView.models.lastRefreshCount != null ? '<span>(' + esc(String(cardView.models.lastRefreshCount)) + ')</span>' : '') +
      '</div>' +
      (modelsError
        ? '<div style="font-size:11px;color:var(--danger);margin-top:3px">⚠ ' + esc(modelsError) + '</div>'
        : '');

    const connMetaHtml =
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--text-muted)">' +
        '<span class="badge ' + toneClass(cardView.connection.tone) + '">' + esc(t('connStatusLabel')) + ': ' + esc(t(cardView.connection.labelKey)) + '</span>' +
        '<span>' + esc(cardView.connection.checkedAt ? t('connLastCheckAt', { ts: cardView.connection.checkedAt }) : t('connStatusNeverChecked')) + '</span>' +
      '</div>' +
      (cardView.connection.detail
        ? '<div style="font-size:11px;color:var(--text-dim);margin-top:3px">' + esc(cardView.connection.detail) + '</div>'
        : '') +
      (connError
        ? '<div style="font-size:11px;color:var(--danger);margin-top:3px">⚠ ' + esc(connError) + '</div>'
        : '');

    const refreshDisabled = cardView.refresh.disabled || refreshBusy;
    const refreshLabel = refreshBusy ? t(cardView.refresh.busyLabelKey) : t(cardView.refresh.labelKey);
    const testDisabled = cardView.test.disabled || testBusy;
    const testLabel = testBusy ? t(cardView.test.busyLabelKey) : t(cardView.test.labelKey);
    const discovery = cardView.discovery || { status: 'never_scanned', labelKey: 'discoveryNeverScanned', tone: 'muted', unreadChanges: 0, proven: false };
    const discoveryBusy = providerCardBusy.has(busyKey('discoverModels'));
    const discoverDisabled = discoveryBusy || discovery.status === 'unsupported';

    const discoveryMetaHtml =
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--text-muted)">' +
        '<span class="badge ' + toneClass(discovery.tone) + '">' + esc(t(discovery.labelKey)) + '</span>' +
        (discovery.modelCount != null ? '<span>' + esc(t('discoveryModelsFound', { count: discovery.modelCount })) + '</span>' : '') +
        (discovery.newModelCount ? '<span class="badge badge-success">' + esc(t('discoveryNewModels', { count: discovery.newModelCount })) + '</span>' : '') +
        (discovery.unreadChanges ? '<span class="badge badge-warn" data-act="viewChanges" data-id="' + esc(p.id) + '" style="cursor:pointer">' + esc(t('notifUnread', { count: discovery.unreadChanges })) + '</span>' : '') +
        '<span>' + esc(discovery.lastSuccessAt ? t('discoveryLastScan', { ts: discovery.lastSuccessAt }) : t('discoveryNeverScanned')) + '</span>' +
      '</div>' +
      (discovery.detail
        ? '<div style="font-size:11px;color:var(--text-dim);margin-top:3px">' + esc(discovery.detail) + '</div>'
        : '');

    const isHeadless = p.settings?.headless !== false;
    const isPrivacy = p.settings?.privacyMode === true;
    // ChatGPT's private mode is real Temporary Chat (which blocks tools/images);
    // other providers only suppress stored history, so their note differs.
    const privacyNoteKey = p.id === 'chatgpt-web' ? 'privacyModeNote' : 'privacyModeNoteGeneric';

    card.innerHTML = 
      '<div class="provider-card-header">' +
        '<div class="provider-title-group">' +
          '<div class="provider-icon-badge">' + getBrandIcon(p.id) + '</div>' +
          '<div>' +
            '<h3>' + esc(p.name) + '</h3>' +
            '<span class="provider-id-tag">' + esc(p.id) + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span class="badge"><span class="status-dot ' + dotClass + '"></span> ' + statusLabel + '</span>' +
          toggleBtnHtml +
        '</div>' +
      '</div>' +

      '<div class="provider-card-body">' +
        '<div>' +
          '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">' + t('registeredAccounts') + '</div>' +
          '<div class="account-chips">' + chipsHtml + '</div>' +
        '</div>' +

        '<div>' +
          '<div class="provider-toggles">' +
            '<label class="provider-toggle-item ' + (isHeadless ? 'active' : '') + '" title="' + esc(t('headlessHint')) + '">' +
              '<input type="checkbox" data-act="toggleHeadless" data-id="' + esc(p.id) + '" ' + (isHeadless ? 'checked' : '') + '/>' +
              '<span>' + t('toggleHeadlessLabel') + '</span>' +
            '</label>' +
            '<label class="provider-toggle-item ' + (isPrivacy ? 'active' : '') + '" title="' + esc(t('privacyHint')) + '">' +
              '<input type="checkbox" data-act="togglePrivacy" data-id="' + esc(p.id) + '" ' + (isPrivacy ? 'checked' : '') + '/>' +
              '<span>' + t('togglePrivacyLabel') + '</span>' +
            '</label>' +
          '</div>' +
          (isPrivacy
            ? '<div class="privacy-mode-note"><span aria-hidden="true">⚠️</span><span data-i18n="' + privacyNoteKey + '">' + esc(t(privacyNoteKey)) + '</span></div>'
            : '') +
        '</div>' +

        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-size:12px;font-weight:600">' + t('availableModelsCount') + ' (' + (cardView.models.availableCount || 0) + ')</span>' +
          '<div style="display:flex;gap:4px">' +
            '<button class="btn-sm" data-act="selectAll" data-id="' + esc(p.id) + '">' + t('btnAllShort') + '</button>' +
            '<button class="btn-sm" data-act="deselectAll" data-id="' + esc(p.id) + '">' + t('btnNoneShort') + '</button>' +
          '</div>' +
        '</div>' +

        modelsMetaHtml +
        connMetaHtml +
        discoveryMetaHtml +

        '<div class="models-container">' + modelsHtml + '</div>' +

        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;flex-wrap:wrap;gap:6px">' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
            '<button class="btn-sm" data-act="discoverModels" data-id="' + esc(p.id) + '"' + (discoverDisabled ? ' disabled' : '') + ' title="' + esc(t('btnDiscoverModelsHint')) + '">' + esc(discoveryBusy ? t('btnWorking') : t('btnDiscoverModels')) + '</button>' +
            '<button class="btn-sm" data-act="checkChanges" data-id="' + esc(p.id) + '">' + esc(t('btnCheckChanges')) + '</button>' +
            '<button class="btn-sm" data-act="viewChanges" data-id="' + esc(p.id) + '">' + esc(t('btnViewChanges')) + '</button>' +
            '<button class="btn-primary btn-sm" data-act="saveModels" data-id="' + esc(p.id) + '">' + t('btnSaveModels') + '</button>' +
            '<button class="btn-sm" data-act="refreshModels" data-id="' + esc(p.id) + '"' + (refreshDisabled ? ' disabled' : '') + ' title="' + esc(t(cardView.refresh.reasonKey || cardView.models.sourceLabelKey)) + '">' + esc(refreshLabel) + '</button>' +
          '</div>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn-sm" data-act="testConnection" data-id="' + esc(p.id) + '"' + (testDisabled ? ' disabled' : '') + ' title="' + esc(t((p.capabilities && p.capabilities.connectionCheckNoteKey) || 'connCheckWebProfile')) + '">' + esc(testLabel) + '</button>' +
            '<button class="btn-sm" data-act="login" data-id="' + esc(p.id) + '">' + t('btnOpenBrowser') + '</button>' +
            '<button class="btn-sm" data-act="toggleEnabled" data-id="' + esc(p.id) + '" data-enabled="' + (p.enabled?1:0) + '">' +
              (p.enabled ? t('btnDisable') : t('btnEnable')) +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    grid.appendChild(card);
  });

  // Attach button & chip handlers
  grid.querySelectorAll('[data-act]').forEach(el=>{
    const id = el.dataset.id || el.dataset.pid;
    const act = el.dataset.act;

    if(act === 'toggleHeadless' || act === 'togglePrivacy'){
      el.onchange = async()=>{
        const isHeadlessAct = (act === 'toggleHeadless');
        const checked = el.checked;
        const patchKey = isHeadlessAct ? 'headless' : 'privacyMode';
        try{
          await api('/api/gateway/providers/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: JSON.stringify({ settings: { [patchKey]: checked } })
          });
          showToast(t(isHeadlessAct ? (checked ? 'toastHeadlessEnabled' : 'toastHeadlessDisabled') : (checked ? 'toastPrivacyEnabled' : 'toastPrivacyDisabled'), { id }));
          await refreshData();
        }catch(e){
          el.checked = !checked;
          showToast(e.message||String(e), 'error');
        }
      };
      return;
    }

    el.onclick = async(ev)=>{
      // Guard against a double click on the same card action BEFORE anything
      // is touched — a second click must not re-enable the running button.
      const actionKey = id + ':' + act;
      if((act === 'refreshModels' || act === 'testConnection') && providerCardBusy.has(actionKey)){
        return;
      }
      // Immediate loading feedback (the label comes from the provider's own
      // card view model, so it always matches the declared capability).
      const busyLabelKey = (()=>{
        const prov = (stateData && Array.isArray(stateData.providers) ? stateData.providers : []).find(x=>x.id===id);
        const card = prov && prov.card;
        if(!card) return 'btnWorking';
        return act === 'refreshModels'
          ? ((card.refresh && card.refresh.busyLabelKey) || 'btnWorking')
          : ((card.test && card.test.busyLabelKey) || 'btnWorking');
      })();

      if(act === 'deleteAccChip'){
        ev.stopPropagation();
        await deleteAccountDirect(el.dataset.pid, el.dataset.accid, el.dataset.accname);
        return;
      }

      if(act === 'selectAll' || act === 'deselectAll'){
        const card = el.closest('.provider-card');
        card.querySelectorAll('.models-container input[type=checkbox]').forEach(cb=>{ cb.checked = (act==='selectAll'); });
        return;
      }

      if(act === 'quickSwitchAcc'){
        const accId = el.dataset.accid;
        try{
          await api('/api/gateway/providers/' + encodeURIComponent(id) + '/accounts/' + encodeURIComponent(accId) + '/activate', {method:'POST'});
          showToast(t('toastAccSwitched'));
          await refreshData();
        }catch(e){ showToast(e.message||String(e), 'error'); }
        return;
      }

      if(act === 'addAccForProv'){
        document.getElementById('selModalProvider').value = id;
        openAddAccountModal();
        return;
      }

      el.disabled = true;
      try{
        if(act === 'toggleRun'){
          const currentStatus = el.dataset.status;
          if(currentStatus === 'running'){
            await api('/api/gateway/providers/' + encodeURIComponent(id) + '/stop', {method:'POST'});
            showToast(t('toastProviderStopped', { id }));
          } else {
            await api('/api/gateway/providers/' + encodeURIComponent(id) + '/start', {method:'POST'});
            showToast(t('toastProviderStarted', { id }));
          }
        }
        else if(act === 'discoverModels'){
          // LIVE discovery: reads the provider's own website through its own
          // browser profile. Never a static catalog.
          const key = id + ':discoverModels';
          if(providerCardBusy.has(key)) return;
          providerCardBusy.add(key);
          providerCardErrors.delete(key);
          el.textContent = t(busyLabelKey);
          try{
            const res = await api('/api/gateway/providers/' + encodeURIComponent(id) + '/discover', {method:'POST'});
            const report = res.report || {};
            if(report.status === 'discovered'){
              const count = (report.models || []).length;
              const newCount = (report.changes || []).filter(c => c.type === 'model_added' || c.type === 'model_restored').length;
              showToast(t('toastDiscoveryDone', { count: count, newCount: newCount }));
              if(newCount > 0){
                showToast(t('toastDiscoveryChanges', { count: newCount }));
                await loadModelNotifications();
              }
            }else if(report.deferred){
              providerCardErrors.set(key, report.detail || '');
              showToast(t('toastDiscoveryDeferred', { reason: report.detail || t('discoveryDeferred') }), 'error');
            }else{
              const msg = report.detail || report.failureReason || 'unknown';
              providerCardErrors.set(key, msg);
              showToast(t('toastDiscoveryFailed', { error: msg }), 'error');
            }
          }catch(e){
            const msg = providerErrorMessage(e);
            providerCardErrors.set(key, msg);
            showToast(t('toastDiscoveryFailed', { error: msg }), 'error');
          }finally{
            providerCardBusy.delete(key);
            await refreshData();
            await loadModelNotifications();
          }
        }
        else if(act === 'checkChanges'){
          const key = id + ':checkChanges';
          if(providerCardBusy.has(key)) return;
          providerCardBusy.add(key);
          try{
            const res = await api('/api/gateway/providers/' + encodeURIComponent(id) + '/discovery');
            const changes = (res.report && res.report.changes) || [];
            if(changes.length === 0){
              showToast(t('toastNoChanges'));
            }else{
              showToast(t('toastDiscoveryChanges', { count: changes.length }));
            }
            await loadModelNotifications();
            openModelNotificationsPanel(id);
          }catch(e){
            showToast(t('toastDiscoveryFailed', { error: providerErrorMessage(e) }), 'error');
          }finally{
            providerCardBusy.delete(key);
            await refreshData();
          }
        }
        else if(act === 'viewChanges'){
          await loadModelNotifications();
          openModelNotificationsPanel(id);
        }
        else if(act === 'testConnection'){
          const key = id + ':testConnection';
          providerCardBusy.add(key);
          providerCardErrors.delete(key);
          el.textContent = t(busyLabelKey);
          try{
            const res = await api('/api/gateway/providers/' + encodeURIComponent(id) + '/connection', {method:'POST'});
            const report = res.report || {};
            const statusText = t(report.labelKey || 'connStatusUnknown');
            showToast(t('toastConnectionResult', { status: statusText, ms: report.latencyMs || 0 }));
          }catch(e){
            const msg = providerErrorMessage(e);
            providerCardErrors.set(key, msg);
            showToast(t('toastConnectionFailed', { error: msg }), 'error');
          }finally{
            providerCardBusy.delete(key);
            await refreshData();
          }
        }
        else if(act === 'saveModels'){
          const card = el.closest('.provider-card');
          const boxes = [...card.querySelectorAll('.models-container input[type=checkbox]')];
          const selected = boxes.filter(b=>b.checked).map(b=>b.dataset.model);
          // Only the SELECTION is saved here. The available list is owned by
          // the discovery operation — letting the browser write it back would
          // resurrect ids the provider no longer offers.
          await api('/api/gateway/providers/' + encodeURIComponent(id), {
            method:'PATCH',
            body: JSON.stringify({selectedModels: selected})
          });
          showToast(t('toastModelsSaved', { id }));
        }
        else if(act === 'refreshModels'){
          const key = id + ':refreshModels';
          providerCardBusy.add(key);
          providerCardErrors.delete(key);
          el.textContent = t(busyLabelKey);
          try{
            const res = await api('/api/gateway/providers/' + encodeURIComponent(id) + '/refresh', {method:'POST'});
            const outcome = res.outcome || {};
            const sourceText = t(outcome.source === 'live-api' ? 'modelsSourceLiveApi' : 'modelsSourceConfiguredCatalog');
            showToast(t('toastModelsRefreshedCount', { count: outcome.count || 0, source: sourceText }));
            if(Array.isArray(outcome.droppedSelected) && outcome.droppedSelected.length > 0){
              showToast(t('toastModelsPruned', { count: outcome.droppedSelected.length }), 'error');
            }
          }catch(e){
            // A failed refresh NEVER reports success and NEVER clears the
            // list: the previous list stays and the reason is shown.
            const msg = providerErrorMessage(e);
            providerCardErrors.set(key, msg);
            showToast(t('toastModelsRefreshFailed', { error: msg }), 'error');
          }finally{
            providerCardBusy.delete(key);
            await refreshData();
          }
        }
        else if(act === 'login'){
          showToast(t('toastBrowserOpening'));
          await api('/api/gateway/providers/' + encodeURIComponent(id) + '/login', {method:'POST'});
          showToast(t('toastLoginComplete'));
        }
        else if(act === 'toggleEnabled'){
          const nowEnabled = (el.dataset.enabled === '1');
          await api('/api/gateway/providers/' + encodeURIComponent(id), {
            method:'PATCH',
            body: JSON.stringify({enabled: !nowEnabled})
          });
          showToast(!nowEnabled ? t('toastProviderEnabled') : t('toastProviderDisabled'));
        }
      }catch(e){
        showToast(e.message||String(e), 'error');
      }finally{
        el.disabled = false;
        await refreshData();
      }
    };
  });
}

// Render Accounts View
function renderAccountsView(providers, force=false){
  const fBar = document.getElementById('accountsFilterBar');
  const tbody = document.getElementById('accountsTableBody');
  if(!fBar || !tbody || !Array.isArray(providers)) return;

  const sig = currentAccountFilter + '::' + JSON.stringify(providers.map(p=>({
    id: p.id,
    accounts: p.accounts,
    accountEmail: p.accountEmail,
    accountName: p.accountName,
    isLoggedIn: p.isLoggedIn
  })));
  if(!force && tbody.__lastSig === sig && fBar.children.length > 0) return;
  tbody.__lastSig = sig;

  fBar.innerHTML = '<button class="btn-sm ' + (currentAccountFilter==='all'?'btn-primary':'') + '" data-filter="all">' + t('filterAccountsAll') + '</button>';
  providers.forEach(p=>{
    const cnt = p.accounts?.length || (p.accountEmail ? 1 : 0);
    fBar.innerHTML += '<button class="btn-sm ' + (currentAccountFilter===p.id?'btn-primary':'') + '" data-filter="' + esc(p.id) + '">' + esc(p.name) + ' (' + cnt + ')</button>';
  });
  fBar.querySelectorAll('button[data-filter]').forEach(b=>{
    b.onclick = () => filterAccounts(b.dataset.filter, b);
  });

  tbody.innerHTML = '';
  const selectedSet = window.__selectedAccountKeys instanceof Set ? window.__selectedAccountKeys : new Set();
  window.__selectedAccountKeys = selectedSet;
  const visibleKeys = new Set();

  let count = 0;
  providers.forEach(p=>{
    if(currentAccountFilter !== 'all' && currentAccountFilter !== p.id) return;

    const accs = Array.isArray(p.accounts) && p.accounts.length > 0 ? p.accounts : (
      p.accountEmail ? [{ id: 'acc_def', name: p.accountName||p.accountEmail, email: p.accountEmail, isLoggedIn: p.isLoggedIn, active: true }] : []
    );

    accs.forEach(acc=>{
      count++;
      const isEnabled = acc.enabled !== false;
      const key = p.id + '::' + acc.id;
      visibleKeys.add(key);
      const checked = selectedSet.has(key);
      const tr = document.createElement('tr');
      tr.innerHTML = 
        '<td><input type="checkbox" class="acc-select" data-key="' + esc(key) + '" data-pid="' + esc(p.id) + '" data-accid="' + esc(acc.id) + '" ' + (checked ? 'checked' : '') + '></td>' +
        '<td><div style="display:flex;align-items:center;gap:10px"><div class="table-icon-badge">' + getBrandIcon(p.id) + '</div><strong>' + esc(p.name) + '</strong></div></td>' +
        '<td>' + esc(locAccName(acc.name) || t('unnamedAccount')) + '</td>' +
        '<td><code style="font-family:var(--font-mono)">' + esc(locAccEmail(acc.email)) + '</code></td>' +
        '<td>' + (acc.isLoggedIn ? '<span class="badge badge-success">' + t('statusLoggedIn') + '</span>' : '<span class="badge">' + t('statusNotLoggedIn') + '</span>') + '</td>' +
        '<td>' + (!isEnabled ? '<span class="badge badge-danger">' + t('statusDisabled') + '</span>' : (acc.active ? '<span class="badge badge-success">' + t('statusActiveAccountBadge') + '</span>' : '<span class="badge" style="color:var(--text-dim)">' + t('statusDormantAccountBadge') + '</span>')) + '</td>' +
        '<td>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            (acc.active || !isEnabled ? '' : '<button class="btn-sm btn-primary" data-act="quickActivate" data-pid="' + esc(p.id) + '" data-accid="' + esc(acc.id) + '">' + t('btnActivate') + '</button>') +
            '<button type="button" class="service-toggle ' + (isEnabled ? 'is-on' : '') + '" role="switch" aria-checked="' + (isEnabled ? 'true' : 'false') + '" data-act="toggleEnabled" data-pid="' + esc(p.id) + '" data-accid="' + esc(acc.id) + '" data-enable="' + (isEnabled ? '0' : '1') + '" title="' + (isEnabled ? esc(t('btnDisable')) : esc(t('btnEnable'))) + '">' +
              '<span class="service-toggle-track" aria-hidden="true"><span class="service-toggle-knob"></span></span>' +
            '</button>' +
            '<button class="btn-sm btn-stop" data-act="quickDelete" data-pid="' + esc(p.id) + '" data-accid="' + esc(acc.id) + '" data-accname="' + esc(acc.name || acc.email) + '" title="' + esc(t('chipDeleteTitle')) + '">' + t('btnDelete') + '</button>' +
          '</div>' +
        '</td>';

      const cb = tr.querySelector('.acc-select');
      if(cb){
        cb.onchange = ()=>{
          if(cb.checked) selectedSet.add(key); else selectedSet.delete(key);
          updateAccountsSelectionUi();
        };
      }
      tr.querySelectorAll('[data-act]').forEach(btn=>{
        btn.onclick = (e)=>{
          e.stopPropagation();
          const act = btn.dataset.act;
          const pid = btn.dataset.pid;
          const accId = btn.dataset.accid;
          if(act === 'quickActivate') quickActivateAcc(pid, accId);
          else if(act === 'toggleEnabled') quickToggleAccount(pid, accId, btn.dataset.enable === '1');
          else if(act === 'quickDelete') deleteAccountDirect(pid, accId, btn.dataset.accname);
        };
      });

      tbody.appendChild(tr);
    });
  });

  for(const k of [...selectedSet]){ if(!visibleKeys.has(k)) selectedSet.delete(k); }

  if(count === 0){
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:24px">' + t('noAccountsFound') + '</td></tr>';
  }
  updateAccountsSelectionUi();
}

async function quickActivateAcc(pid, accId){
  try{
    await api('/api/gateway/providers/' + encodeURIComponent(pid) + '/accounts/' + encodeURIComponent(accId) + '/activate', {method:'POST'});
    showToast(t('toastAccountActivated'));
    await refreshData();
  }catch(e){ showToast(e.message || String(e), 'error'); }
}

function getVisibleAccountsForBulk(){
  const providers = (stateData && Array.isArray(stateData.providers)) ? stateData.providers : [];
  const items = [];
  providers.forEach(p=>{
    if(currentAccountFilter !== 'all' && currentAccountFilter !== p.id) return;
    const accs = Array.isArray(p.accounts) && p.accounts.length > 0 ? p.accounts : (
      p.accountEmail ? [{ id: 'acc_def', name: p.accountName||p.accountEmail, email: p.accountEmail, isLoggedIn: p.isLoggedIn, active: true, enabled: true }] : []
    );
    accs.forEach(acc=>items.push({ pid: p.id, accId: acc.id, name: acc.name || acc.email || acc.id, enabled: acc.enabled !== false }));
  });
  return items;
}

function updateAccountsSelectionUi(){
  const selected = window.__selectedAccountKeys instanceof Set ? window.__selectedAccountKeys : new Set();
  const visible = getVisibleAccountsForBulk();
  const visibleKeys = new Set(visible.map(x=>x.pid+'::'+x.accId));
  for(const k of [...selected]){ if(!visibleKeys.has(k)) selected.delete(k); }
  const allCb = document.getElementById('accountsSelectAll');
  if(allCb){
    allCb.checked = visible.length > 0 && visible.every(x=>selected.has(x.pid+'::'+x.accId));
    allCb.indeterminate = !allCb.checked && visible.some(x=>selected.has(x.pid+'::'+x.accId));
  }
  const countEl = document.getElementById('accountsSelectedCount');
  if(countEl) countEl.textContent = selected.size ? ('محدد: ' + selected.size) : '';
}

function toggleSelectAllAccounts(checked){
  const selected = window.__selectedAccountKeys instanceof Set ? window.__selectedAccountKeys : new Set();
  window.__selectedAccountKeys = selected;
  getVisibleAccountsForBulk().forEach(x=>{
    const key = x.pid+'::'+x.accId;
    if(checked) selected.add(key); else selected.delete(key);
  });
  document.querySelectorAll('#accountsTableBody .acc-select').forEach(cb=>{
    cb.checked = !!checked;
  });
  updateAccountsSelectionUi();
}

function toggleAccountsBulkMenu(e){
  if(e) e.stopPropagation();
  const menu = document.getElementById('accountsBulkMenu');
  if(!menu) return;
  const show = menu.style.display === 'none' || !menu.style.display;
  menu.style.display = show ? 'block' : 'none';
}

document.addEventListener('click', (e)=>{
  const menu = document.getElementById('accountsBulkMenu');
  const btn = document.getElementById('btnAccountsBulkMenu');
  if(!menu || menu.style.display !== 'block') return;
  if(menu.contains(e.target) || (btn && btn.contains(e.target))) return;
  menu.style.display = 'none';
});

async function bulkAccountsAction(action, scope){
  const menu = document.getElementById('accountsBulkMenu');
  if(menu) menu.style.display = 'none';
  const visible = getVisibleAccountsForBulk();
  const selected = window.__selectedAccountKeys instanceof Set ? window.__selectedAccountKeys : new Set();
  let targets = scope === 'selected' ? visible.filter(x=>selected.has(x.pid+'::'+x.accId)) : visible.slice();
  if(scope === 'selected' && targets.length === 0){ showToast('لم يتم تحديد حسابات', 'error'); return; }
  if(targets.length === 0){ showToast(t('noAccountsFound'), 'error'); return; }

  if(action === 'disable' || action === 'enable'){
    const enable = action === 'enable';
    targets = targets.filter(x=>x.enabled !== enable);
    if(targets.length === 0){ showToast(enable ? 'كل الحسابات مفعلة بالفعل' : 'كل الحسابات معطلة بالفعل'); return; }
  }

  if(action === 'delete'){
    const ok = confirm('هل أنت متأكد من حذف ' + (scope === 'all' ? 'كل الحسابات الظاهرة' : 'الحسابات المحددة') + ' (' + targets.length + ')؟');
    if(!ok) return;
  }

  let okCount = 0;
  for(const item of targets){
    try{
      if(action === 'delete'){
        await api('/api/gateway/providers/' + encodeURIComponent(item.pid) + '/accounts/' + encodeURIComponent(item.accId), {method:'DELETE'});
      } else {
        await api('/api/gateway/providers/' + encodeURIComponent(item.pid) + '/accounts/' + encodeURIComponent(item.accId), {
          method:'PATCH',
          body: JSON.stringify({ enabled: action === 'enable' })
        });
      }
      okCount++;
    }catch(e){ console.error('bulk account action failed', item, e); }
  }
  if(action === 'delete'){ selected.clear(); }
  showToast('تم تنفيذ الإجراء على ' + okCount + ' / ' + targets.length + ' حساب');
  await refreshData();
}

async function quickToggleAccount(pid, accId, enable){
  try{
    await api('/api/gateway/providers/' + encodeURIComponent(pid) + '/accounts/' + encodeURIComponent(accId), {
      method:'PATCH',
      body: JSON.stringify({ enabled: enable })
    });
    showToast(enable ? t('btnEnable') : t('btnDisable'));
    await refreshData();
  }catch(e){ showToast(e.message || String(e), 'error'); }
}

async function deleteAccountDirect(pid, accId, accName){
  try{
    await api('/api/gateway/providers/' + encodeURIComponent(pid) + '/accounts/' + encodeURIComponent(accId), {method:'DELETE'});
    showToast(t('toastAccountDeleted') + (accName || accId));
    await refreshData();
  }catch(e){
    showToast(e.message || String(e), 'error');
  }
}

function filterAccounts(pid, btn){
  currentAccountFilter = pid;
  if(stateData) renderAccountsView(stateData.providers, true);
}

// API Keys & Custom Providers Logic (NEW!)
async function loadApiKeys(){
  try{
    const res = await api('/api/gateway/keys');
    currentApiKeys = res.keys || [];
    renderApiKeysTable();
  }catch(e){
    console.error('Failed to load keys:', e);
  }
}

function renderApiKeysTable(){
  const tbody = document.getElementById('apiKeysTableBody');
  const countBadge = document.getElementById('badgeTotalKeys');
  
  // Default key + generated keys (deduplicated against default master key)
  const defaultKey = document.getElementById('inpApiKey').value || 'emo.web';
  const extraKeys = (currentApiKeys || []).filter(k => k && k.id !== 'key-default' && k.id !== 'key_default' && k.key !== defaultKey);
  const allKeys = [
    { id: 'key_default', name: t('statusDefaultKey'), key: defaultKey, createdAt: t('defaultKeyCreatedAt'), enabled: true, isDefault: true },
    ...extraKeys
  ];

  if(countBadge) countBadge.textContent = allKeys.length;

  tbody.innerHTML = allKeys.map(k=>{
    const masked = k.isDefault ? k.key : (k.key.slice(0, 10) + '••••••••' + k.key.slice(-4));
    return (
      '<tr>' +
        '<td><strong>' + esc(k.name) + '</strong></td>' +
        '<td>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<code style="font-family:var(--font-mono);direction:ltr">' + esc(masked) + '</code>' +
            '<button class="btn-copy btn-sm" data-keyact="copy" data-keyval="' + esc(k.key) + '">' + t('btnCopy') + '</button>' +
          '</div>' +
        '</td>' +
        '<td><span style="font-size:11px;color:var(--text-dim)">' + esc(k.createdAt) + '</span></td>' +
        '<td>' + (k.enabled ? '<span class="badge badge-success">' + t('statusActive') + '</span>' : '<span class="badge badge-danger">' + t('statusDisabled') + '</span>') + '</td>' +
        '<td>' +
          (k.isDefault ? '<span style="font-size:11px;color:var(--text-dim)">' + t('statusSystemMasterKey') + '</span>' : (
            '<div style="display:flex;gap:4px">' +
              '<button class="btn-sm" data-keyact="toggle" data-keyid="' + esc(k.id) + '" data-enable="' + (k.enabled?0:1) + '">' + (k.enabled ? t('btnDisable') : t('btnEnable')) + '</button>' +
              '<button class="btn-stop btn-sm" data-keyact="delete" data-keyid="' + esc(k.id) + '">' + t('btnDelete') + '</button>' +
            '</div>'
          )) +
        '</td>' +
      '</tr>'
    );
  }).join('');

  tbody.querySelectorAll('button[data-keyact]').forEach(btn=>{
    btn.onclick = ()=>{
      const act = btn.dataset.keyact;
      if(act === 'copy'){
        navigator.clipboard.writeText(btn.dataset.keyval || '').catch(()=>{});
        showToast(t('toastKeyCopied'));
      } else if(act === 'toggle'){
        toggleApiKey(btn.dataset.keyid, Number(btn.dataset.enable));
      } else if(act === 'delete'){
        deleteApiKey(btn.dataset.keyid);
      }
    };
  });
}

async function toggleApiKey(id, enable){
  try{
    await api('/api/gateway/keys/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify({ enabled: Boolean(enable) })
    });
    showToast(enable ? t('toastKeyActivated') : t('toastKeyDeactivated'));
    await loadApiKeys();
  }catch(e){ showToast(e.message, 'error'); }
}

async function deleteApiKey(id){
  try{
    await api('/api/gateway/keys/' + encodeURIComponent(id), { method: 'DELETE' });
    showToast(t('toastKeyDeleted'));
    await loadApiKeys();
  }catch(e){ showToast(e.message, 'error'); }
}

function openAddKeyModal(){
  generateRandomKeyVal();
  document.getElementById('addKeyModal').classList.add('open');
}
function closeAddKeyModal(){
  document.getElementById('addKeyModal').classList.remove('open');
}
function generateRandomKeyVal(){
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('');
  document.getElementById('inpCustomKeyVal').value = 'sk-emo-' + rand;
}
async function submitAddKey(){
  const name = document.getElementById('inpKeyName').value.trim();
  const key = document.getElementById('inpCustomKeyVal').value.trim();
  if(!name){ showToast(t('keyNameRequired'), 'error'); return; }

  try{
    await api('/api/gateway/keys', {
      method: 'POST',
      body: JSON.stringify({ name, key })
    });
    showToast(t('toastKeyCreated'));
    closeAddKeyModal();
    document.getElementById('inpKeyName').value = '';
    await loadApiKeys();
  }catch(e){ showToast(e.message || String(e), 'error'); }
}

// Custom Upstream Providers Logic (Real Live Verification & Model Fetching)
let cpModalDiscoveredModels = [];
let cpModalLiveServerModels = new Set();
let editingCustomProviderId = null;
const cpCardVerifyState = {};

const GEAR_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

async function loadCustomProviders(){
  try{
    const res = await api('/api/gateway/custom-providers');
    currentCustomProviders = res.providers || [];
    renderCustomProvidersList();
  }catch(e){
    console.error('Failed to load custom providers:', e);
  }
}

function renderCustomProvidersList(){
  const cont = document.getElementById('customProvidersList');
  if(currentCustomProviders.length === 0){
    cont.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:16px">' + t('noCustomProvidersFound') + '</div>';
    return;
  }

  cont.innerHTML = currentCustomProviders.map(cp=>{
    const cleanModels = (cp.models || []).filter(m => m && m !== 'default');
    const modelsBadges = cleanModels.length > 0
      ? cleanModels.map(m =>
          '<span class="badge" style="font-family:var(--font-mono);font-size:11px;direction:ltr">' + esc(m) + '</span>'
        ).join(' ')
      : '<span style="font-size:11px;color:var(--text-muted)">' + t('cpNoModelsYet') + '</span>';
    const hasKey = Boolean(cp.apiKey && cp.apiKey.trim());

    return (
      '<div class="topology-node" style="padding:14px;display:flex;flex-direction:column;gap:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<strong style="font-size:13.5px">' + esc(cp.name) + '</strong>' +
            '<span class="badge ' + (cp.enabled ? 'badge-success' : '') + '">' + (cp.enabled ? t('statusActive') : t('statusDisabled')) + '</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<button type="button" class="btn-sm" data-cpact="openSettings" data-cpid="' + esc(cp.id) + '" title="' + esc(t('cpSettingsHint')) + '" style="display:inline-flex;align-items:center;gap:5px;padding:4px 9px">' +
              GEAR_ICON_SVG +
              '<span>' + t('customSettingsBtn') + '</span>' +
            '</button>' +
            '<button class="btn-sm" data-cpact="toggle" data-cpid="' + esc(cp.id) + '" data-enable="' + (cp.enabled?0:1) + '">' + (cp.enabled ? t('btnDisable') : t('btnEnable')) + '</button>' +
            '<button class="btn-stop btn-sm" data-cpact="delete" data-cpid="' + esc(cp.id) + '">' + t('btnDelete') + '</button>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);direction:ltr">' + esc(cp.baseUrl) + '</div>' +
          '<span style="font-size:10.5px;color:' + (hasKey ? 'var(--success)' : 'var(--text-dim)') + '">' + (hasKey ? t('customApiKeySaved') : t('customNoApiKey')) + '</span>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:11px;color:var(--text-dim);margin-bottom:5px">' + t('activeModelsListLabel') + ' (' + cleanModels.length + '):</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:5px">' + modelsBadges + '</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  cont.querySelectorAll('button[data-cpact]').forEach(btn=>{
    btn.onclick = async ()=>{
      const act = btn.dataset.cpact;
      const cpid = btn.dataset.cpid;
      if(act === 'toggle') await toggleCustomProvider(cpid, Number(btn.dataset.enable));
      else if(act === 'delete') await deleteCustomProvider(cpid);
      else if(act === 'openSettings') openEditCustomProviderModal(cpid);
    };
  });
}

function toggleCpApiKeyVisibility(){
  const inp = document.getElementById('inpCpApiKey');
  if(!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

function renderCpVerifyBanner(state){
  const banner = document.getElementById('cpVerifyBanner');
  if(!banner) return;
  if(!state){
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  banner.style.display = 'block';
  if(state.loading){
    banner.style.borderColor = 'var(--primary)';
    banner.style.color = 'var(--primary)';
    banner.innerHTML = esc(state.message || t('cpVerifyLoading'));
    return;
  }
  const color = state.ok ? 'var(--success)' : 'var(--danger)';
  banner.style.borderColor = color;
  banner.style.color = color;
  const statusBadge = state.status ? ('HTTP ' + state.status) : 'Network Error';
  const latencyBadge = state.latencyMs ? (state.latencyMs + 'ms') : '';
  banner.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;font-weight:600">' +
      '<span>' + (state.ok ? '✓ ' : '✗ ') + esc(state.message || (state.ok ? t('verifyOk') : t('verifyFail'))) + '</span>' +
      '<span style="font-family:var(--font-mono);font-size:10.5px;direction:ltr">' + esc([statusBadge, latencyBadge].filter(Boolean).join(' · ')) + '</span>' +
    '</div>' +
    (state.endpoint ? '<div style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted);direction:ltr;margin-top:3px">Endpoint: ' + esc(state.endpoint) + '</div>' : '');
}

async function verifyCpConnectionFromModal(){
  const urlEl = document.getElementById('inpCpUrl');
  const keyEl = document.getElementById('inpCpApiKey');
  const btn = document.getElementById('btnVerifyCpConn');
  const baseUrl = urlEl ? urlEl.value.trim() : '';
  const apiKey = keyEl ? keyEl.value.trim() : '';
  const firstModel = getCpModelsInputArray()[0] || '';

  if(!baseUrl){
    showToast(t('baseUrlRequiredVerify'), 'error');
    return;
  }

  renderCpVerifyBanner({ loading: true, message: t('cpVerifyChecking') });
  if(btn){
    btn.disabled = true;
    btn.textContent = t('cpVerifyCheckingShort');
  }

  try{
    const res = await api('/api/gateway/custom-providers/verify', {
      method: 'POST',
      body: JSON.stringify({ baseUrl, apiKey, testModel: firstModel })
    });
    renderCpVerifyBanner(res);
    if(editingCustomProviderId){
      cpCardVerifyState[editingCustomProviderId] = res;
    }

    if(res.ok){
      if(Array.isArray(res.models) && res.models.length > 0){
        res.models.forEach(m => cpModalLiveServerModels.add(m));
        const existingManual = getCpModelsInputArray().filter(m => m !== 'default');
        cpModalDiscoveredModels = [...new Set([...res.models, ...existingManual])];
        renderCpFetchedModelsChecklist(cpModalDiscoveredModels, new Set(cpModalDiscoveredModels));
        syncCpChecklistToInput();
        const statusEl = document.getElementById('cpFetchStatus');
        if(statusEl){
          statusEl.textContent = '✓ ' + t('cpFetchedDuringVerify', { count: res.models.length });
          statusEl.style.color = 'var(--success)';
        }
      }
      showToast(res.message || t('verifyOk'));
    } else {
      showToast(res.message || res.error || t('verifyCheckFailed'), 'error');
    }
  }catch(e){
    const errMsg = e.message || t('verifyServerFailed');
    renderCpVerifyBanner({ ok: false, status: 0, message: errMsg });
    showToast(errMsg, 'error');
  }finally{
    if(btn){
      btn.disabled = false;
      btn.textContent = t('cpVerifyBtn');
    }
  }
}

async function fetchCpModelsFromEndpoint(){
  const urlEl = document.getElementById('inpCpUrl');
  const keyEl = document.getElementById('inpCpApiKey');
  const nameEl = document.getElementById('inpCpName');
  const statusEl = document.getElementById('cpFetchStatus');
  const btn = document.getElementById('btnFetchCpModels');
  const baseUrl = urlEl ? urlEl.value.trim() : '';
  const apiKey = keyEl ? keyEl.value.trim() : '';
  const name = nameEl ? nameEl.value.trim() : '';

  if(!baseUrl){
    showToast(t('baseUrlRequired'), 'error');
    return;
  }

  renderCpVerifyBanner({ loading: true, message: t('cpFetchingBanner') });
  if(statusEl){
    statusEl.textContent = t('cpFetchingLive');
    statusEl.style.color = 'var(--primary)';
  }
  if(btn){
    btn.disabled = true;
    btn.textContent = t('cpFetchingShort');
  }

  try{
    const res = await api('/api/gateway/custom-providers/fetch-models', {
      method: 'POST',
      body: JSON.stringify({ baseUrl, apiKey, name })
    });
    const fetched = Array.isArray(res.models) ? res.models : [];
    fetched.forEach(m => cpModalLiveServerModels.add(m));
    const existingManual = getCpModelsInputArray().filter(m => m !== 'default');
    cpModalDiscoveredModels = [...new Set([...fetched, ...existingManual])];
    renderCpFetchedModelsChecklist(cpModalDiscoveredModels, new Set(cpModalDiscoveredModels));
    syncCpChecklistToInput();

    const okMsg = t('cpFetchedReal', { count: fetched.length });
    renderCpVerifyBanner({
      ok: true,
      status: res.status || 200,
      latencyMs: res.latencyMs || 0,
      endpoint: res.endpoint || baseUrl,
      message: okMsg
    });
    if(statusEl){
      statusEl.textContent = '✓ ' + okMsg + ' (' + (res.latencyMs || 0) + 'ms)';
      statusEl.style.color = 'var(--success)';
    }
    showToast(okMsg);
  }catch(e){
    const errMsg = e.message || t('cpFetchFailed');
    renderCpVerifyBanner({
      ok: false,
      status: 0,
      endpoint: baseUrl,
      message: errMsg
    });
    if(statusEl){
      statusEl.textContent = '✗ ' + errMsg;
      statusEl.style.color = 'var(--danger)';
    }
    showToast(errMsg, 'error');
  }finally{
    if(btn){
      btn.disabled = false;
      btn.textContent = t('btnFetchReal');
    }
  }
}

function getCpModelsInputArray(){
  const inp = document.getElementById('inpCpModels');
  if(!inp || !inp.value.trim()) return [];
  return [...new Set(inp.value.split(',').map(s=>s.trim()).filter(m => Boolean(m) && m !== 'default'))];
}

function renderCpFetchedModelsChecklist(models, selectedSet){
  const wrap = document.getElementById('cpFetchedModelsWrap');
  const list = document.getElementById('cpFetchedModelsList');
  if(!wrap || !list) return;
  const cleanList = Array.isArray(models) ? models.filter(m => Boolean(m) && m !== 'default') : [];
  if(cleanList.length === 0){
    wrap.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  wrap.style.display = 'block';
  list.innerHTML = cleanList.map(m =>
    '<label class="model-row">' +
      '<input type="checkbox" data-cp-fetched-model="' + esc(m) + '" ' + (selectedSet.has(m) ? 'checked' : '') + '/>' +
      '<code>' + esc(m) + '</code>' +
    '</label>'
  ).join('');

  list.querySelectorAll('input[data-cp-fetched-model]').forEach(cb => {
    cb.onchange = () => syncCpChecklistToInput();
  });
}

function syncCpChecklistToInput(){
  const list = document.getElementById('cpFetchedModelsList');
  const inp = document.getElementById('inpCpModels');
  if(!list || !inp) return;
  const boxes = [...list.querySelectorAll('input[data-cp-fetched-model]')];
  const checked = boxes.filter(b => b.checked).map(b => b.dataset.cpFetchedModel);
  const allBoxModels = new Set(boxes.map(b => b.dataset.cpFetchedModel));
  const extraTyped = getCpModelsInputArray().filter(m => !allBoxModels.has(m));
  const combined = [...new Set([...checked, ...extraTyped])];
  inp.value = combined.join(', ');
}

function toggleAllCpFetchedModels(selectAll){
  const list = document.getElementById('cpFetchedModelsList');
  if(!list) return;
  list.querySelectorAll('input[data-cp-fetched-model]').forEach(cb => {
    cb.checked = !!selectAll;
  });
  syncCpChecklistToInput();
}

function addManualCpModelToModal(){
  const singleEl = document.getElementById('inpCpManualSingle');
  const inp = document.getElementById('inpCpModels');
  if(!singleEl || !inp) return;
  const val = singleEl.value.trim();
  if(!val){ showToast(t('modelNameRequired'), 'error'); return; }
  const added = val.split(',').map(s=>s.trim()).filter(Boolean);
  const currentSelected = new Set([...getCpModelsInputArray(), ...added]);
  cpModalDiscoveredModels = [...new Set([...cpModalDiscoveredModels, ...added])];
  renderCpFetchedModelsChecklist(cpModalDiscoveredModels, currentSelected);
  inp.value = [...currentSelected].join(', ');
  singleEl.value = '';
  const statusEl = document.getElementById('cpFetchStatus');
  if(statusEl){
    statusEl.textContent = '✓ ' + t('manualModelAdded', { count: currentSelected.size });
    statusEl.style.color = 'var(--success)';
  }
}

function openAddCustomProviderModal(){
  editingCustomProviderId = null;
  cpModalDiscoveredModels = [];
  cpModalLiveServerModels = new Set();
  const titleEl = document.getElementById('cpModalTitle');
  if(titleEl) titleEl.textContent = t('modalAddCpTitle');
  const submitBtn = document.getElementById('btnSubmitCpModal');
  if(submitBtn) submitBtn.textContent = t('btnSaveCustomProv');

  document.getElementById('inpCpName').value = '';
  document.getElementById('inpCpUrl').value = '';
  const keyEl = document.getElementById('inpCpApiKey');
  if(keyEl){ keyEl.value = ''; keyEl.type = 'password'; }
  document.getElementById('inpCpModels').value = '';
  const singleEl = document.getElementById('inpCpManualSingle');
  if(singleEl) singleEl.value = '';

  renderCpVerifyBanner(null);
  const wrap = document.getElementById('cpFetchedModelsWrap');
  if(wrap) wrap.style.display = 'none';
  const list = document.getElementById('cpFetchedModelsList');
  if(list) list.innerHTML = '';
  const statusEl = document.getElementById('cpFetchStatus');
  if(statusEl){
    statusEl.textContent = t('cpFetchHint');
    statusEl.style.color = 'var(--text-muted)';
  }
  document.getElementById('addCustomProviderModal').classList.add('open');
}

function openEditCustomProviderModal(id){
  const cp = currentCustomProviders.find(p => p.id === id);
  if(!cp) return;
  editingCustomProviderId = cp.id;
  cpModalLiveServerModels = new Set();

  const titleEl = document.getElementById('cpModalTitle');
  if(titleEl) titleEl.textContent = t('modalEditCpTitle') + cp.name;
  const submitBtn = document.getElementById('btnSubmitCpModal');
  if(submitBtn) submitBtn.textContent = t('cpSaveSettings');

  document.getElementById('inpCpName').value = cp.name || '';
  document.getElementById('inpCpUrl').value = cp.baseUrl || '';
  const keyEl = document.getElementById('inpCpApiKey');
  if(keyEl){ keyEl.value = cp.apiKey || ''; keyEl.type = 'password'; }

  const existingModels = Array.isArray(cp.models) ? cp.models.filter(m => Boolean(m) && m !== 'default') : [];
  document.getElementById('inpCpModels').value = existingModels.join(', ');
  const singleEl = document.getElementById('inpCpManualSingle');
  if(singleEl) singleEl.value = '';

  renderCpVerifyBanner(cpCardVerifyState[cp.id] || null);
  cpModalDiscoveredModels = [...existingModels];
  renderCpFetchedModelsChecklist(cpModalDiscoveredModels, new Set(existingModels));

  const statusEl = document.getElementById('cpFetchStatus');
  if(statusEl){
    statusEl.textContent = t('cpVerifyFetchHint');
    statusEl.style.color = 'var(--text-muted)';
  }
  document.getElementById('addCustomProviderModal').classList.add('open');
}

function closeAddCustomProviderModal(){
  editingCustomProviderId = null;
  document.getElementById('addCustomProviderModal').classList.remove('open');
}

async function submitAddCustomProvider(){
  const name = document.getElementById('inpCpName').value.trim();
  const baseUrl = document.getElementById('inpCpUrl').value.trim();
  const apiKey = document.getElementById('inpCpApiKey').value.trim();
  const singleManual = (document.getElementById('inpCpManualSingle')?.value || '').trim();
  const modelsStr = document.getElementById('inpCpModels').value.trim();
  if(!name || !baseUrl){ showToast(t('nameUrlRequired'), 'error'); return; }

  const combinedStr = [modelsStr, singleManual].filter(Boolean).join(',');
  const models = combinedStr ? [...new Set(combinedStr.split(',').map(s=>s.trim()).filter(m => Boolean(m) && m !== 'default'))] : [];

  try{
    if(editingCustomProviderId){
      const res = await api('/api/gateway/custom-providers/' + encodeURIComponent(editingCustomProviderId), {
        method: 'PATCH',
        body: JSON.stringify({ name, baseUrl, apiKey, models })
      });
      const savedCount = (res.provider?.models || []).filter(m => m !== 'default').length;
      showToast(t('cpSavedSettings', { count: savedCount }));
    } else {
      const res = await api('/api/gateway/custom-providers', {
        method: 'POST',
        body: JSON.stringify({ name, baseUrl, apiKey, models })
      });
      const savedCount = (res.provider?.models || []).filter(m => m !== 'default').length;
      showToast(t('cpAddedSuccess', { count: savedCount }));
    }
    closeAddCustomProviderModal();
    await loadCustomProviders();
  }catch(e){ showToast(e.message || String(e), 'error'); }
}

async function toggleCustomProvider(id, enable){
  try{
    await api('/api/gateway/custom-providers/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify({ enabled: Boolean(enable) })
    });
    showToast(enable ? t('toastProviderEnabled') : t('toastProviderDisabled'));
    await loadCustomProviders();
  }catch(e){ showToast(e.message, 'error'); }
}

async function deleteCustomProvider(id){
  try{
    await api('/api/gateway/custom-providers/' + encodeURIComponent(id), { method: 'DELETE' });
    showToast(t('toastProviderDeleted'));
    await loadCustomProviders();
  }catch(e){ showToast(e.message, 'error'); }
}

// ── Router Groups ──────────────────────────────────────────────────────────
// routerGroups declared above in shared gateway state
let editingRouterGroupId = null;

async function loadRouterGroups(){
  try{
    const res = await api('/api/gateway/router/groups');
    routerGroups = res.groups || [];
    renderRouterGroups();
    renderSwarmRoleModels();
    const badge = document.getElementById('badgeTotalGroups');
    if(badge) badge.textContent = String(routerGroups.filter(g=>g.enabled).length) + '/' + String(routerGroups.length);
  }catch(e){ console.error('loadRouterGroups', e); }
}

function rgProviderLabel(kind, providerId){
  if(kind === 'custom'){
    const cp = (currentCustomProviders||[]).find(p=>p.id===providerId) || (((stateData||{}).customProviders)||[]).find(p=>p.id===providerId);
    return cp ? cp.name : providerId;
  }
  const p = ((stateData||{}).providers||[]).find(x=>x.id===providerId);
  return p ? (p.name || p.id) : providerId;
}

function renderRouterGroups(){
  const cont = document.getElementById('routerGroupsList');
  if(!cont) return;
  if(!routerGroups.length){
    cont.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:18px;border:1px dashed var(--border);border-radius:10px">' + t('rgNoGroups') + '</div>';
    return;
  }
  cont.innerHTML = routerGroups.map(g=>{
    const targetsHtml = (g.targets||[]).map((t,i)=>{
      const prov = esc(rgProviderLabel(t.kind, t.providerId));
      const acc = t.accountId ? (' · ' + esc(t.accountId)) : '';
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--card-subtle);font-size:11.5px">' +
        '<span style="min-width:18px;height:18px;border-radius:999px;background:var(--primary);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">' + (i+1) + '</span>' +
        '<span style="color:var(--text-muted)">' + esc(t.kind==='custom'?'API':'Web') + '</span>' +
        '<strong>' + prov + '</strong>' +
        '<span style="font-family:var(--font-mono);direction:ltr;color:var(--text)">' + esc(t.model) + '</span>' +
        (acc ? '<span style="color:var(--text-dim)">' + acc + '</span>' : '') +
      '</div>';
    }).join('');
    const strat = g.strategy === 'round-robin' ? t('rgStrategyRR') : t('rgStrategySeq');
    return '<div class="topology-node" style="padding:14px;display:flex;flex-direction:column;gap:10px" data-gid="' + esc(g.id) + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
        '<div style="display:flex;align-items:center;gap:8px;min-width:0">' +
          '<span style="font-size:18px">' + esc(g.icon||'🔀') + '</span>' +
          '<strong style="font-size:14px">' + esc(g.name) + '</strong>' +
          '<span class="badge ' + (g.enabled?'badge-success':'') + '">' + (g.enabled?t('rgEnabled'):t('rgDisabled')) + '</span>' +
          '<span class="badge" style="font-size:10px">' + esc(strat) + '</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
          '<button class="btn-sm" onclick="testRouterGroup(\\\'' + esc(g.id) + '\\\')">' + t('rgBtnTest') + '</button>' +
          '<button class="btn-sm" onclick="toggleRouterGroup(\\\'' + esc(g.id) + '\\\',' + (!g.enabled) + ')">' + (g.enabled?t('btnDisable'):t('btnEnable')) + '</button>' +
          '<button class="btn-sm" onclick="openRouterGroupModal(\\\'' + esc(g.id) + '\\\')">' + t('rgBtnEdit') + '</button>' +
          '<button class="btn-stop btn-sm" onclick="deleteRouterGroup(\\\'' + esc(g.id) + '\\\')">' + t('rgBtnDelete') + '</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px">' + (targetsHtml || '<span style="color:var(--text-dim);font-size:12px">—</span>') + '</div>' +
      (g.apiKey ? ('<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px dashed var(--border);border-radius:8px;background:var(--card-subtle)">' +
        '<span style="font-size:11.5px;color:var(--text-muted)">' + t('rgApiKeyLabel') + ':</span>' +
        '<code style="font-family:var(--font-mono);font-size:11px;direction:ltr;user-select:all">' + esc(g.apiKey) + '</code>' +
        '<button class="btn-sm" onclick="copyRouterGroupKey(\\\'' + esc(g.id) + '\\\')">' + t('btnCopy') + '</button>' +
        '<span style="font-size:11px;color:var(--text-dim)">' + t('rgApiKeyHint') + '</span>' +
      '</div>') : '') +
      '<div id="rgtest-' + esc(g.id) + '" style="display:none;font-size:11.5px"></div>' +
    '</div>';
  }).join('');
}

function getRouterProviderOptions(){
  const web = ((stateData||{}).providers||[]).map(p=>({ kind:'web', id:p.id, name:p.name||p.id, models: (p.availableModels&&p.availableModels.length?p.availableModels:(p.selectedModels||[])), accounts: p.accounts||[] }));
  const custom = (currentCustomProviders||[]).map(cp=>({ kind:'custom', id:cp.id, name:cp.name||cp.id, models: (cp.models||[]).filter(m=>m&&m!=='default'), accounts: [] }));
  return [...web, ...custom];
}

function buildRouterTargetRow(target){
  const opts = getRouterProviderOptions();
  const tgt = target || { kind:'web', providerId: (opts[0]?.id||''), model:'', accountId:'' };
  const row = document.createElement('div');
  row.className = 'rg-target-row';
  row.style.cssText = 'display:grid;grid-template-columns:1.2fr 1.2fr 1fr auto;gap:8px;align-items:center;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--card-subtle)';
  row.dataset.tid = tgt.id || '';
  const provSel = '<select class="form-input rg-prov" style="direction:ltr"></select>';
  const modelSel = '<select class="form-input rg-model" style="direction:ltr"></select>';
  const accSel = '<select class="form-input rg-acc" style="direction:ltr"></select>';
  row.innerHTML = provSel + modelSel + accSel +
    '<div style="display:flex;gap:4px">' +
      '<button class="btn-sm" type="button" onclick="moveRouterTargetRow(this,-1)">↑</button>' +
      '<button class="btn-sm" type="button" onclick="moveRouterTargetRow(this,1)">↓</button>' +
      '<button class="btn-stop btn-sm" type="button" onclick="this.closest(\\\'.rg-target-row\\\').remove()">×</button>' +
    '</div>';
  const provEl = row.querySelector('.rg-prov');
  provEl.innerHTML = opts.map(o=>'<option value="'+esc(o.kind+':'+o.id)+'">'+esc((o.kind==='custom'?'[API] ':'')+o.name)+'</option>').join('') || '<option value="">—</option>';
  const key = (tgt.kind||'web') + ':' + (tgt.providerId||'');
  if(opts.find(o=>o.kind+':'+o.id===key)) provEl.value = key;
  const sync = ()=>{
    const [kind,id] = (provEl.value||'web:').split(':');
    const opt = opts.find(o=>o.kind===kind && o.id===id);
    const mSel = row.querySelector('.rg-model');
    const models = (opt?.models||[]);
    mSel.innerHTML = (models.length?models:['']).map(m=>'<option value="'+esc(m)+'">'+esc(m||'—')+'</option>').join('');
    if(tgt.model && models.includes(tgt.model)) mSel.value = tgt.model;
    const aSel = row.querySelector('.rg-acc');
    if(kind==='web'){
      const accs = opt?.accounts||[];
      aSel.innerHTML = '<option value="">' + esc(t('rgAccountActive')) + '</option>' + accs.map(a=>'<option value="'+esc(a.id)+'">'+esc((locAccName(a.name)||locAccEmail(a.email)||a.id))+'</option>').join('');
      aSel.disabled = false;
      if(tgt.accountId) aSel.value = tgt.accountId;
    } else {
      aSel.innerHTML = '<option value="">' + esc(t('rgAccountActive')) + '</option>';
      aSel.disabled = true;
    }
  };
  provEl.onchange = ()=>{ tgt.model=''; tgt.accountId=''; sync(); };
  sync();
  return row;
}

function addRouterTargetRow(target){
  const list = document.getElementById('rgTargetsList');
  if(list) list.appendChild(buildRouterTargetRow(target));
}
function moveRouterTargetRow(btn, dir){
  const row = btn.closest('.rg-target-row'); if(!row) return;
  const sib = dir<0 ? row.previousElementSibling : row.nextElementSibling;
  if(!sib) return;
  if(dir<0) row.parentElement.insertBefore(row, sib); else row.parentElement.insertBefore(sib, row);
}

function openRouterGroupModal(id){
  editingRouterGroupId = id || null;
  const g = id ? routerGroups.find(x=>x.id===id) : null;
  document.getElementById('rgModalTitle').textContent = g ? t('rgModalEditTitle') : t('rgModalCreateTitle');
  document.getElementById('rgName').value = g ? g.name : '';
  document.getElementById('rgIcon').value = g ? (g.icon||'') : '';
  document.getElementById('rgStrategy').value = g ? g.strategy : 'sequential';
  const list = document.getElementById('rgTargetsList');
  list.innerHTML = '';
  const targets = g && g.targets && g.targets.length ? g.targets : [null];
  targets.forEach(t=>addRouterTargetRow(t));
  document.getElementById('routerGroupModal').classList.add('open');
}
function closeRouterGroupModal(){
  editingRouterGroupId = null;
  document.getElementById('routerGroupModal').classList.remove('open');
}

async function saveRouterGroup(){
  const name = document.getElementById('rgName').value.trim();
  const icon = document.getElementById('rgIcon').value.trim();
  const strategy = document.getElementById('rgStrategy').value;
  const rows = Array.from(document.querySelectorAll('#rgTargetsList .rg-target-row'));
  const targets = rows.map(r=>{
    const [kind, providerId] = (r.querySelector('.rg-prov').value||'web:').split(':');
    const model = r.querySelector('.rg-model').value || '';
    const accountId = r.querySelector('.rg-acc').value || undefined;
    return { id: r.dataset.tid || undefined, kind, providerId, model, ...(accountId?{accountId}:{}) };
  }).filter(t=>t.providerId && t.model);
  if(!name){ showToast(t('rgNameLabel'), 'error'); return; }
  if(!targets.length){ showToast(t('rgTargetsLabel'), 'error'); return; }
  const existing = editingRouterGroupId ? routerGroups.find(x=>x.id===editingRouterGroupId) : null;
  const body = { name, icon: icon||undefined, strategy, enabled: existing ? existing.enabled : true, targets };
  try{
    if(editingRouterGroupId){
      await api('/api/gateway/router/groups/' + encodeURIComponent(editingRouterGroupId), { method:'PATCH', body: JSON.stringify(body) });
    } else {
      await api('/api/gateway/router/groups', { method:'POST', body: JSON.stringify(body) });
    }
    showToast(t('rgSaved'));
    closeRouterGroupModal();
    await loadRouterGroups();
  }catch(e){ showToast(e.message||String(e), 'error'); }
}

async function toggleRouterGroup(id, enabled){
  try{
    await api('/api/gateway/router/groups/' + encodeURIComponent(id), { method:'PATCH', body: JSON.stringify({ enabled: !!enabled }) });
    await loadRouterGroups();
  }catch(e){ showToast(e.message||String(e), 'error'); }
}
async function deleteRouterGroup(id){
  if(!confirm(t('rgDeleteConfirm'))) return;
  try{
    await api('/api/gateway/router/groups/' + encodeURIComponent(id), { method:'DELETE' });
    showToast(t('rgDeleted'));
    await loadRouterGroups();
  }catch(e){ showToast(e.message||String(e), 'error'); }
}
async function testRouterGroup(id){
  const box = document.getElementById('rgtest-' + id);
  if(box){ box.style.display='block'; box.innerHTML = '<span style="color:var(--text-muted)">…</span>'; }
  try{
    const res = await api('/api/gateway/router/groups/' + encodeURIComponent(id) + '/test', { method:'POST' });
    if(box){
      box.innerHTML = (res.results||[]).map(r=>{
        const color = r.ok ? 'var(--success)' : 'var(--danger)';
        return '<div style="display:flex;gap:8px;align-items:center;margin-top:4px"><span style="color:'+color+';font-weight:600">'+(r.ok?t('rgTestOk'):t('rgTestFail'))+'</span><span style="font-family:var(--font-mono);font-size:10.5px">'+esc(r.targetId)+'</span>'+(r.latencyMs?'<span style="color:var(--text-dim)">'+r.latencyMs+'ms</span>':'')+(r.error?'<span style="color:var(--danger)">'+esc(r.error)+'</span>':'')+'</div>';
      }).join('') || '<span style="color:var(--text-dim)">—</span>';
    }
  }catch(e){ if(box) box.innerHTML = '<span style="color:var(--danger)">'+esc(e.message||String(e))+'</span>'; }
}

async function copyRouterGroupKey(id){
  const g = (routerGroups||[]).find(x=>x.id===id);
  if(!g || !g.apiKey){ showToast(t('rgNoApiKey') || 'لا يوجد مفتاح', 'error'); return; }
  try{
    await navigator.clipboard.writeText(g.apiKey);
    showToast(t('copied') || 'تم النسخ');
  }catch(e){
    showToast((e && e.message) ? e.message : 'Copy failed', 'error');
  }
}

// Modal handlers
function openAddAccountModal(){
  document.getElementById('addAccountModal').classList.add('open');
}
function closeAddAccountModal(){
  document.getElementById('addAccountModal').classList.remove('open');
}
async function submitAddAccount(){
  const pid = document.getElementById('selModalProvider').value;
  const name = document.getElementById('inpModalAccName').value.trim();
  const email = document.getElementById('inpModalAccEmail').value.trim();
  if(!email){ showToast(t('emailRequired'), 'error'); return; }

  try{
    await api('/api/gateway/providers/' + encodeURIComponent(pid) + '/accounts', {
      method: 'POST',
      body: JSON.stringify({ name, email })
    });
    showToast(t('toastAccountAdded') + ' (' + pid + ')');
    closeAddAccountModal();
    document.getElementById('inpModalAccName').value = '';
    document.getElementById('inpModalAccEmail').value = '';
    await refreshData();
  }catch(e){
    showToast(t('statusError') + ': ' + (e.message || String(e)), 'error');
  }
}

let activeDetailAcc = null;
function openAccountDetail(providerId, accId){
  const p = stateData?.providers.find(x=>x.id === providerId);
  if(!p) return;
  const acc = (p.accounts||[]).find(a=>a.id === accId) || { id: accId, name: p.accountName, email: p.accountEmail, isLoggedIn: p.isLoggedIn, active: true, userDataDir: p.settings?.userDataDir };
  activeDetailAcc = { providerId, acc };

  const rawAccLabel = String(acc.name || acc.email || '');
  document.getElementById('dtAccTitle').textContent = t('manageAccountTitle', { name: rawAccLabel });
  document.getElementById('dtAccProvider').textContent = p.name + ' (' + p.id + ')';
  document.getElementById('dtAccName').textContent = locAccName(acc.name) || t('noNameLabel');
  document.getElementById('dtAccEmail').textContent = locAccEmail(acc.email);
  document.getElementById('dtAccLogged').innerHTML = acc.isLoggedIn ? '<span class="badge badge-success">' + t('statusLoggedIn') + '</span>' : '<span class="badge">' + t('statusNotLoggedIn') + '</span>';
  document.getElementById('dtAccPath').textContent = (acc.userDataDir && acc.userDataDir !== '[redacted]') ? acc.userDataDir : ('~/.arena-webbridge/' + p.id + '-profile');

  const btnAct = document.getElementById('btnActivateAccount');
  if(btnAct){
    btnAct.disabled = !!acc.active;
    btnAct.textContent = acc.active ? t('accountActiveNow') : t('btnSetAsActive');
  }

  document.getElementById('btnActivateAccount').onclick = async()=>{
    try{
      await api('/api/gateway/providers/' + encodeURIComponent(providerId) + '/accounts/' + encodeURIComponent(acc.id) + '/activate', {method:'POST'});
      showToast(t('toastAccountActivated') + ': ' + acc.email);
      closeAccountDetailModal();
      await refreshData();
    }catch(e){ showToast(e.message || String(e), 'error'); }
  };

  document.getElementById('btnLoginAccount').onclick = async()=>{
    try{
      closeAccountDetailModal();
      showToast(t('toastLoginWindow'));
      await api('/api/gateway/providers/' + encodeURIComponent(providerId) + '/login', {
        method:'POST',
        body: JSON.stringify({ accountId: acc.id })
      });
      showToast(t('toastLoginDone'));
      await refreshData();
    }catch(e){ showToast(e.message || String(e), 'error'); }
  };

  document.getElementById('btnDeleteAccount').onclick = async()=>{
    try{
      await api('/api/gateway/providers/' + encodeURIComponent(providerId) + '/accounts/' + encodeURIComponent(acc.id), {method:'DELETE'});
      showToast(t('toastAccountDeletedShort'));
      closeAccountDetailModal();
      await refreshData();
    }catch(e){ showToast(e.message || String(e), 'error'); }
  };

  document.getElementById('accountDetailModal').classList.add('open');
}
function closeAccountDetailModal(){
  document.getElementById('accountDetailModal').classList.remove('open');
  activeDetailAcc = null;
}

// Live Flow Graph Logic (Connection Topology Flow)

// Point on cubic bezier at param t
function topoBusPath(x0, y0, x1, y1, spineX, r){
  // Bus-style elbow: horizontal from the start point, along a shared vertical
  // spine, then horizontal into the end point. Straight when already aligned.
  if(Math.abs(y1 - y0) < 2 || Math.abs(spineX - x0) < 2 || Math.abs(x1 - spineX) < 2){
    return 'M ' + x0 + ',' + y0 + ' L ' + x1 + ',' + y1;
  }
  const dirY = y1 > y0 ? 1 : -1;
  const rr = Math.max(2, Math.min(r, Math.abs(y1 - y0)/2, Math.abs(spineX - x0), Math.abs(x1 - spineX)));
  return 'M ' + x0 + ',' + y0 +
    ' L ' + (spineX - Math.sign(spineX - x0) * rr) + ',' + y0 +
    ' Q ' + spineX + ',' + y0 + ' ' + spineX + ',' + (y0 + dirY * rr) +
    ' L ' + spineX + ',' + (y1 - dirY * rr) +
    ' Q ' + spineX + ',' + y1 + ' ' + (spineX + Math.sign(x1 - spineX) * rr) + ',' + y1 +
    ' L ' + x1 + ',' + y1;
}

function topoBezierPoint(x0, y0, cx0, cy0, cx1, cy1, x1, y1, t){
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, e = t * t * t;
  return {
    x: a * x0 + b * cx0 + c * cx1 + e * x1,
    y: a * y0 + b * cy0 + c * cy1 + e * y1
  };
}

function updateTopologyFlowLines(){
  const wrapper = document.getElementById('topologyFlowWrapper');
  const svg = document.getElementById('topologySvgOverlay');
  const hub = document.getElementById('topNodeHub');
  if(!wrapper || !svg || !hub) return;

  const wrapRect = wrapper.getBoundingClientRect();
  if(wrapRect.width === 0 || wrapRect.height === 0) return;

  svg.setAttribute('viewBox', '0 0 ' + wrapRect.width + ' ' + wrapRect.height);
  svg.setAttribute('width', String(wrapRect.width));
  svg.setAttribute('height', String(wrapRect.height));

  const agentNodes = Array.from(wrapper.querySelectorAll('#topologyAgentList .topology-node[data-agent-id]'));
  const providerNodes = Array.from(wrapper.querySelectorAll('#topologyActiveList .topology-node[data-provider-id]'));

  // Update summary badges
  const inCountEl = document.getElementById('topoInCount');
  if(inCountEl) inCountEl.textContent = String(agentNodes.length);
  const outCountEl = document.getElementById('topoOutCount');
  if(outCountEl) outCountEl.textContent = String(providerNodes.length);
  const reqCountEl = document.getElementById('topoReqCount');
  if(reqCountEl){
    const activeReqs = agentNodes.filter(n => n.dataset.live === '1' || n.dataset.recent === '1').length;
    reqCountEl.textContent = String(activeReqs);
  }
  const privChip = document.getElementById('topoPrivacyChip');
  const hasPriv = providerNodes.some(n => n.dataset.privacy === '1');
  if(privChip) privChip.style.display = hasPriv ? 'inline-flex' : 'none';

  // Edge-label overlay: connection lines carry the agent name + brand icon
  let labelsEl = wrapper.querySelector('#topologyEdgeLabels');
  if(!labelsEl){
    labelsEl = document.createElement('div');
    labelsEl.id = 'topologyEdgeLabels';
    labelsEl.className = 'topology-edge-labels';
    wrapper.appendChild(labelsEl);
  }

  // If no active agents and no active providers are flowing, clear all flow lines and labels
  if(agentNodes.length === 0 && providerNodes.length === 0){
    if(svg.__lastSig !== ''){
      svg.__lastSig = '';
      svg.innerHTML = '';
    }
    if(labelsEl && labelsEl.__lastSig !== ''){
      labelsEl.__lastSig = '';
      labelsEl.innerHTML = '';
    }
    return;
  }

  const hubRect = hub.getBoundingClientRect();
  const agentRects = agentNodes.map(n => n.getBoundingClientRect());
  const provRects = providerNodes.map(n => n.getBoundingClientRect());
  const firstAgentRect = agentRects[0] || null;
  // Stacked layout (mobile) = the agent column shares the hub's horizontal
  // center; side-by-side columns (desktop) are offset horizontally.
  const isVertical = firstAgentRect
    ? Math.abs((hubRect.left + hubRect.width/2) - (firstAgentRect.left + firstAgentRect.width/2)) < 80
    : false;

  // An active flow node pulses when traffic passed through it
  const agentFlowing = (node) => isServiceRunning && (node.dataset.live === '1' || node.dataset.recent === '1');
  let pathsHtml = 
    '<defs>' +
      '<filter id="topoGlow" x="-20%" y="-20%" width="140%" height="140%">' +
        '<feGaussianBlur stdDeviation="3" result="blur" />' +
        '<feMerge>' +
          '<feMergeNode in="blur" />' +
          '<feMergeNode in="SourceGraphic" />' +
        '</feMerge>' +
      '</filter>' +
    '</defs>';

  const isServiceRunning = stateData ? (stateData.serviceRunning ?? stateData.gateway?.serviceRunning ?? true) : true;
  // Direction-aware geometry: in RTL the agent column sits on the right of the
  // hub and the provider column on the left, so ports swap sides. Paths and
  // label corridors are mirrored from the same formulas in both directions.
  const isLtr = (document.documentElement.getAttribute('dir') || 'rtl') === 'ltr';

  const hubInX = (isLtr ? hubRect.left : hubRect.right) - wrapRect.left;
  const hubOutX = (isLtr ? hubRect.right : hubRect.left) - wrapRect.left;
  const hubY = hubRect.top + hubRect.height/2 - wrapRect.top;

  // Bus-style routing (horizontal layout): every node line leaves the node's
  // edge horizontally, joins a shared vertical spine, and a single connector
  // enters the hub port — no crossing arcs, and every attach point is the
  // exact node edge.
  let agentSpineX = hubInX;
  let provSpineX = hubOutX;
  if(!isVertical && agentRects.length){
    const avg = agentRects.reduce((s, r) => s + ((isLtr ? r.right : r.left) - wrapRect.left), 0) / agentRects.length;
    agentSpineX = hubInX + (avg - hubInX) * 0.5;
  }
  if(!isVertical && provRects.length){
    const avg = provRects.reduce((s, r) => s + ((isLtr ? r.left : r.right) - wrapRect.left), 0) / provRects.length;
    provSpineX = hubOutX + (avg - hubOutX) * 0.5;
  }
  if(!isVertical && agentRects.length){
    const ys = agentRects.map(r => r.top + r.height/2 - wrapRect.top);
    const top = Math.min(hubY, ...ys);
    const bot = Math.max(hubY, ...ys);
    pathsHtml += '<path class="conduit-bg topo-trunk" d="M ' + hubInX + ',' + hubY + ' L ' + agentSpineX + ',' + hubY + '"/>';
    if(bot - top > 4) pathsHtml += '<path class="conduit-bg topo-trunk" d="M ' + agentSpineX + ',' + top.toFixed(1) + ' L ' + agentSpineX + ',' + bot.toFixed(1) + '"/>';
  }
  if(!isVertical && provRects.length){
    const ys = provRects.map(r => r.top + r.height/2 - wrapRect.top);
    const top = Math.min(hubY, ...ys);
    const bot = Math.max(hubY, ...ys);
    pathsHtml += '<path class="conduit-bg topo-trunk" d="M ' + hubOutX + ',' + hubY + ' L ' + provSpineX + ',' + hubY + '"/>';
    if(bot - top > 4) pathsHtml += '<path class="conduit-bg topo-trunk" d="M ' + provSpineX + ',' + top.toFixed(1) + ' L ' + provSpineX + ',' + bot.toFixed(1) + '"/>';
  }

  const edgeLabels = [];
  // Conduits from Agents -> Hub
  agentNodes.forEach((node, idx) => {
    const nodeRect = agentRects[idx];
    const agentId = node.dataset.agentId || ('agent_' + idx);
    let x1, y1, x2, y2, d, dFull;

    if(isVertical){
      x1 = nodeRect.left + nodeRect.width/2 - wrapRect.left;
      y1 = nodeRect.bottom - wrapRect.top;
      x2 = hubRect.left + hubRect.width/2 - wrapRect.left;
      y2 = hubRect.top - wrapRect.top;
      const cy1 = y1 + (y2 - y1) * 0.45;
      const cy2 = y2 - (y2 - y1) * 0.45;
      d = 'M ' + x1 + ',' + y1 + ' C ' + x1 + ',' + cy1 + ' ' + x2 + ',' + cy2 + ' ' + x2 + ',' + y2;
      dFull = d;
      const labelDefV = AGENT_SHORT_NAMES[agentId] ? { short: AGENT_SHORT_NAMES[agentId], full: node.dataset.name || esc(agentId) } : { short: node.dataset.name || esc(agentId), full: node.dataset.name || esc(agentId) };
      edgeLabels.push({
        agent: agentId,
        icon: getBrandIcon(agentId),
        name: labelDefV.short,
        full: labelDefV.full,
        x: (x1 + x2) / 2,
        y: y1 + 9,
        vertical: true,
        dormant: !agentFlowing(node)
      });
    } else {
      // RTL: the line exits the agent's left edge, runs horizontally to the
      // shared spine, and the spine feeds the hub entry port. LTR mirrored.
      x1 = (isLtr ? nodeRect.right : nodeRect.left) - wrapRect.left;
      y1 = nodeRect.top + nodeRect.height/2 - wrapRect.top;
      x2 = agentSpineX;
      y2 = hubY;
      d = 'M ' + x1 + ',' + y1 + ' L ' + x2 + ',' + y1;
      dFull = topoBusPath(x1, y1, hubInX, hubY, agentSpineX, 8);
      const labelDef = AGENT_SHORT_NAMES[agentId] ? { short: AGENT_SHORT_NAMES[agentId], full: node.dataset.name || esc(agentId) } : { short: node.dataset.name || esc(agentId), full: node.dataset.name || esc(agentId) };
      edgeLabels.push({
        agent: agentId,
        icon: getBrandIcon(agentId),
        name: labelDef.short,
        full: labelDef.full,
        x: (x1 + agentSpineX) / 2,
        y: y1 - 12,
        hubInner: hubInX,
        agentInner: x1,
        vertical: false,
        dormant: !agentFlowing(node)
      });
    }

    const dur = (2.0 + idx * 0.35).toFixed(2) + 's';
    const flowing = agentFlowing(node);
    const conduitClass = flowing ? 'conduit-flow' : 'conduit-flow dormant';
    pathsHtml +=
      '<g class="flow-group agent-flow" data-from="' + esc(agentId) + '" data-to="hub">' +
        '<path class="conduit-bg" d="' + d + '" />' +
        '<path class="' + conduitClass + '" d="' + d + '" />' +
        (flowing ? (
          '<circle class="particle-dot" r="3.5">' +
            '<animateMotion path="' + (dFull || d) + '" dur="' + dur + '" repeatCount="indefinite" />' +
          '</circle>'
        ) : '') +
      '</g>';
  });

  // Conduits from Hub -> Providers
  providerNodes.forEach((node, idx) => {
    const nodeRect = provRects[idx];
    const provId = node.dataset.providerId || ('prov_' + idx);
    const isPriv = node.dataset.privacy === '1';
    const isRunning = node.dataset.status === 'running';
    let x3, y3, x4, y4, d, dFull;

    if(isVertical){
      x3 = hubRect.left + hubRect.width/2 - wrapRect.left;
      y3 = hubRect.bottom - wrapRect.top;
      x4 = nodeRect.left + nodeRect.width/2 - wrapRect.left;
      y4 = nodeRect.top - wrapRect.top;
      const cy3 = y3 + (y4 - y3) * 0.45;
      const cy4 = y4 - (y4 - y3) * 0.45;
      d = 'M ' + x3 + ',' + y3 + ' C ' + x3 + ',' + cy3 + ' ' + x4 + ',' + cy4 + ' ' + x4 + ',' + y4;
      dFull = d;
    } else {
      // RTL: the spine feeds the hub exit port, then a straight stub enters
      // the provider's right edge. LTR mirrored.
      x3 = provSpineX;
      y3 = nodeRect.top + nodeRect.height/2 - wrapRect.top;
      x4 = (isLtr ? nodeRect.left : nodeRect.right) - wrapRect.left;
      y4 = y3;
      d = 'M ' + x3 + ',' + y3 + ' L ' + x4 + ',' + y4;
      dFull = topoBusPath(hubOutX, hubY, x4, y4, provSpineX, 8);
    }

    const dur = (1.8 + (idx % 3) * 0.35).toFixed(2) + 's';
    const privClass = isPriv ? ' privacy' : '';
    // Traffic is the truth: a rendered provider node is one serving requests
    const shouldAnimate = isServiceRunning && (node.dataset.live === '1' || node.dataset.recent === '1');
    const flowClass = shouldAnimate ? ('conduit-flow' + privClass) : 'conduit-flow dormant';
    pathsHtml += 
      '<g class="flow-group provider-flow' + privClass + '" data-from="hub" data-to="' + esc(provId) + '">' +
        '<path class="conduit-bg" d="' + d + '" />' +
        '<path class="' + flowClass + '" d="' + d + '" />' +
        (shouldAnimate ? (
          '<circle class="particle-dot' + privClass + '" r="3.5">' +
            '<animateMotion path="' + (dFull || d) + '" dur="' + dur + '" repeatCount="indefinite" />' +
          '</circle>'
        ) : '') +
      '</g>';
  });

  // Only replace the SVG markup when it actually changed: rebuilding identical
  // markup restarts the SMIL particle animations (they would visibly jump
  // every 3s refresh cycle).
  if(svg.__lastSig !== pathsHtml){
    svg.__lastSig = pathsHtml;
    svg.innerHTML = pathsHtml;
  }

  if(labelsEl){
    const activeLabels = edgeLabels.filter(l => !l.dormant);
    const labelsMarkup = activeLabels.map(l => {
      const style = 'left:' + Math.round(l.x) + 'px;top:' + Math.round(l.y) + 'px';
      return '<div class="topo-edge-label active" data-agent-id="' + esc(l.agent) + '" style="' + style + '">' +
               l.icon + ' <span>' + esc(l.name) + '</span>' +
             '</div>';
    }).join('');
    if(labelsEl.__lastSig !== labelsMarkup){
      labelsEl.__lastSig = labelsMarkup;
      labelsEl.innerHTML = labelsMarkup;
    }
  }

  setupTopologyInteractions();
}

function setupTopologyInteractions(){
  const wrapper = document.getElementById('topologyFlowWrapper');
  if(!wrapper || wrapper.__interactionsInit) return;
  wrapper.__interactionsInit = true;

  const applyFlowHighlight = (node) => {
    const agentId = node.dataset.agentId;
    const provId = node.dataset.providerId;
    const isHub = node.id === 'topNodeHub';

    const groups = wrapper.querySelectorAll('.flow-group');
    const nodes = wrapper.querySelectorAll('.topology-node');

    if(isHub){
      groups.forEach(g => {
        g.querySelectorAll('.conduit-flow').forEach(p => p.classList.add('highlighted'));
        g.querySelectorAll('.conduit-bg, .conduit-flow, .particle-dot').forEach(p => p.classList.remove('dimmed'));
      });
      wrapper.querySelectorAll('.topo-edge-label').forEach(el => el.classList.add('active'));
      node.classList.add('node-highlight');
      return;
    }

    if(agentId){
      const targetProvId = node.dataset.provId;
      groups.forEach(g => {
        const isFromAgent = g.dataset.from === agentId;
        const isToTargetProv = targetProvId ? (g.dataset.from === 'hub' && g.dataset.to === targetProvId) : (g.dataset.from === 'hub');
        if(isFromAgent || isToTargetProv){
          g.querySelectorAll('.conduit-flow').forEach(p => p.classList.add('highlighted'));
          g.querySelectorAll('.conduit-bg, .conduit-flow, .particle-dot').forEach(p => p.classList.remove('dimmed'));
        } else {
          g.querySelectorAll('.conduit-flow').forEach(p => p.classList.remove('highlighted'));
          g.querySelectorAll('.conduit-bg, .conduit-flow, .particle-dot').forEach(p => p.classList.add('dimmed'));
        }
      });
      nodes.forEach(n => {
        const isTargetProv = targetProvId && n.dataset.providerId === targetProvId;
        if(n === node || n.id === 'topNodeHub' || isTargetProv) n.classList.add('node-highlight');
        else n.classList.remove('node-highlight');
      });
      wrapper.querySelectorAll('.topo-edge-label').forEach(el => el.classList.toggle('active', el.dataset.agentId === agentId));
      return;
    }

    if(provId){
      groups.forEach(g => {
        const isToProv = g.dataset.to === provId;
        if(isToProv){
          g.querySelectorAll('.conduit-flow').forEach(p => p.classList.add('highlighted'));
          g.querySelectorAll('.conduit-bg, .conduit-flow, .particle-dot').forEach(p => p.classList.remove('dimmed'));
        } else {
          g.querySelectorAll('.conduit-flow').forEach(p => p.classList.remove('highlighted'));
          g.querySelectorAll('.conduit-bg, .conduit-flow, .particle-dot').forEach(p => p.classList.add('dimmed'));
        }
      });
      nodes.forEach(n => {
        if(n === node || n.id === 'topNodeHub') n.classList.add('node-highlight');
        else n.classList.remove('node-highlight');
      });
      wrapper.querySelectorAll('.topo-edge-label').forEach(el => el.classList.remove('active'));
    }
  };

  // Mouse & keyboard parity: Tab-focus highlights the exact same flow paths.
  const nodeFromEvent = (e) => {
    const t = e.target;
    return t && t.closest ? t.closest('.topology-node') : null;
  };
  wrapper.addEventListener('mouseover', (e) => {
    const node = nodeFromEvent(e);
    if(node) applyFlowHighlight(node);
  });
  wrapper.addEventListener('focusin', (e) => {
    const node = nodeFromEvent(e);
    if(node) applyFlowHighlight(node);
  });

  wrapper.addEventListener('mouseout', (e) => {
    const related = e.relatedTarget;
    if(related && wrapper.contains(related)) {
      const node = related.closest('.topology-node');
      if(node) return;
    }
    resetFlowHighlights();
  });
  wrapper.addEventListener('focusout', () => {
    // Only reset when focus leaves the wrapper entirely
    setTimeout(() => {
      if(!wrapper.contains(document.activeElement)) resetFlowHighlights();
    }, 0);
  });
}

function resetFlowHighlights(){
  const wrapper = document.getElementById('topologyFlowWrapper');
  if(!wrapper) return;
  wrapper.querySelectorAll('.conduit-flow').forEach(p => p.classList.remove('highlighted'));
  wrapper.querySelectorAll('.conduit-bg, .conduit-flow, .particle-dot').forEach(p => p.classList.remove('dimmed'));
  wrapper.querySelectorAll('.topology-node').forEach(n => n.classList.remove('node-highlight'));
  wrapper.querySelectorAll('.topo-edge-label').forEach(el => el.classList.remove('active'));
}

function triggerFlowPingPulse(){
  const box = document.getElementById('topologyFlowContainer');
  if(!box) return;

  box.classList.add('ping-pulse-active');
  const btn = document.getElementById('btnFlowPingPulse');
  const btnIdle = btn ? btn.innerHTML : '';
  if(btn){
    btn.innerHTML = t('topoPulsing');
    btn.disabled = true;
  }

  const metricLat = document.getElementById('hubMetricsLatency');
  const prevMetric = metricLat ? metricLat.textContent : '';
  if(metricLat) metricLat.textContent = t('pulseLatency');

  showToast(t('toastFlowPulse'));

  setTimeout(() => {
    box.classList.remove('ping-pulse-active');
    if(btn){
      btn.innerHTML = btnIdle;
      btn.disabled = false;
    }
    if(metricLat) metricLat.textContent = prevMetric;
  }, 1400);
}

// Window & Resize listeners (rAF-throttled: resize/ResizeObserver fire much
// faster than recomputing every path layout needs to run)
let topoUpdatePending = false;
function scheduleTopologyUpdate(){
  if(topoUpdatePending) return;
  topoUpdatePending = true;
  if(typeof requestAnimationFrame === 'function'){
    requestAnimationFrame(flushTopologyUpdate);
  } else {
    setTimeout(flushTopologyUpdate, 30);
  }
}
function flushTopologyUpdate(){
  topoUpdatePending = false;
  updateTopologyFlowLines();
}
window.addEventListener('resize', scheduleTopologyUpdate);
if(typeof ResizeObserver !== 'undefined'){
  const ro = new ResizeObserver(scheduleTopologyUpdate);
  const wrapperEl = document.getElementById('topologyFlowWrapper');
  if(wrapperEl) ro.observe(wrapperEl);
}

// Polling and heartbeat
async function beat(){ try{ await api('/api/gateway/heartbeat', {method:'POST'}); }catch{} }

beat();
setInterval(beat, 5000);

// Hub compact seconds counter (1s live tick when state is loaded)
const hubUptimeSecEl = document.getElementById('hubUptimeSec');
if(hubUptimeSecEl){
  setInterval(()=>{
    if(!stateData || !stateData.usage || !stateData.usage.gatewayStartedAt) return;
    const secs = Math.floor((Date.now() - new Date(stateData.usage.gatewayStartedAt).getTime()) / 1000);
    hubUptimeSecEl.textContent = secs + 's';
  }, 1000);
}
loadDetectedAgents();
refreshData();
setInterval(refreshData, 3000);

// Live push channel: the gateway emits a 'usage' event the instant a request
// starts or ends (SSE). We refresh immediately on it, so the topology reflects
// real traffic in real time; the 3s poll above remains the fallback when the
// subscription is unavailable.
(function subscribeUsageEvents(){
  try{
    const serverKey = '__EMO_API_KEY__';
    const key = (serverKey && !serverKey.startsWith('__')) ? serverKey : (localStorage.getItem('emoApiKey') || 'emo.web');
    const es = new EventSource('/api/gateway/events?key=' + encodeURIComponent(key));
    es.addEventListener('usage', () => { void refreshData(); });
    // On error EventSource reconnects automatically; polling covers the gap.
  }catch(e){ /* push unavailable: polling fallback */ }
})();

// ── Swarm role model selects (router groups only) ──────────────────────────
function getSwarmModelOptions(){
  const groups = Array.isArray(routerGroups) ? routerGroups : [];
  // Use created (enabled) router groups as the only selectable role models.
  return groups.filter(g => g && g.enabled !== false && g.name).map(g => String(g.name));
}
function renderSwarmRoleModels(){
  const opts = getSwarmModelOptions();
  const html = opts.length
    ? opts.map(m=>'<option value="'+esc(m)+'">'+esc(m)+'</option>').join('')
    : '<option value="" disabled selected>' + esc(t('swarmNoGroupsOption') || 'أنشئ مجموعة راوتر أولاً') + '</option>';
  ['Architect','Coder','Reviewer','Tester'].forEach(role=>{
    const sel = document.getElementById('swarmModel'+role);
    if(!sel) return;
    const prev = sel.value || '';
    sel.innerHTML = html;
    if(opts.length){
      sel.disabled = false;
      sel.value = opts.indexOf(prev) >= 0 ? prev : opts[0];
    } else {
      sel.disabled = true;
      sel.value = '';
    }
  });
}

let _swarmAbort = null;
function stopLiveSwarm(){
  if(_swarmAbort){
    try { _swarmAbort.abort(); } catch(e){}
  }
}

async function runLiveSwarm(){
  const input = document.getElementById('swarmGoalInput');
  const btn = document.getElementById('btnRunSwarmExec');
  const stopBtn = document.getElementById('btnStopSwarmExec');
  const box = document.getElementById('swarmOutputBox');
  const modeSelect = document.getElementById('swarmModeSelect');
  if(!input || !box || !btn) return;
  if(_swarmAbort){
    showToast(t('swarmAlreadyRunning') || 'هناك مهمة قيد التنفيذ', 'error');
    return;
  }
  const systemInstructions = input.value.trim();
  if(!systemInstructions){
    alert(t('swarmGoalRequired') || 'يرجى كتابة تعليمات النظام أولاً');
    input.focus();
    return;
  }
  const groupOptions = getSwarmModelOptions();
  if(!groupOptions.length){
    showToast(t('swarmNeedGroup') || 'أنشئ مجموعة راوتر أولاً واخترها للأدوار', 'error');
    return;
  }
  const runLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'جارٍ التنفيذ...';
  if(stopBtn) stopBtn.disabled = false;
  box.style.display = 'block';
  box.textContent = 'جارٍ تنسيق المهمة وتوزيعها على الوكلاء...\\n\\n';
  _swarmAbort = new AbortController();

  try {
    const serverKey = '__EMO_API_KEY__';
    const key = (serverKey && !serverKey.startsWith('__')) ? serverKey : (localStorage.getItem('emoApiKey') || 'emo.web');
    // Per-role model selection from created router groups only.
    const roleModel = (suffix) => {
      const el = document.getElementById('swarmModel' + suffix);
      return (el && el.value) ? el.value : groupOptions[0];
    };
    const workers = [
      { role: 'architect', provider: roleModel('Architect'), task: 'Analyze requirements and propose architecture, data models, and component boundaries based on the provided system instructions.' },
      { role: 'coder', provider: roleModel('Coder'), task: 'Implement complete, robust, production-quality code following the provided system instructions and architecture.' },
      { role: 'reviewer', provider: roleModel('Reviewer'), task: 'Review for correctness, security, and quality according to the provided system instructions.' },
      { role: 'tester', provider: roleModel('Tester'), task: 'Design and write thorough tests and validation cases aligned with the provided system instructions.' },
    ];
    const res = await fetch('/v1/agents/swarm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify({
        goal: systemInstructions,
        systemInstructions: systemInstructions,
        mode: modeSelect ? modeSelect.value : 'auto',
        workers: workers
      }),
      signal: _swarmAbort.signal
    });
    if(!res.ok){
      const err = await res.json().catch(()=>({}));
      box.textContent += '\\nخطأ: ' + (err.error?.message || res.statusText);
      return;
    }
    const data = await res.json();
    box.textContent = data.synthesis || JSON.stringify(data, null, 2);
  } catch(e) {
    if(e && e.name === 'AbortError'){
      box.textContent += '\\n⏹ تم إيقاف المهمة بناءً على طلبك.';
    } else {
      box.textContent += '\\nفشل الاتصال بالخادم: ' + e.message;
    }
  } finally {
    _swarmAbort = null;
    btn.disabled = false;
    btn.textContent = t('btnExecute') || runLabel || 'تشغيل';
    if(stopBtn) stopBtn.disabled = true;
  }
}
</script>
</body>
</html>`;

export function registerGatewayUi(app: FastifyInstance, opts?: { apiKey?: string }): void {
  const apiKey = opts?.apiKey || 'emo.web';
  const rendered = HTML.replace(/__EMO_API_KEY__/g, () => apiKey);
  const handler = async (_req: any, reply: any) => reply.type('text/html; charset=utf-8').send(rendered);
  app.get('/', handler);
  app.get('/ui', handler);
}
