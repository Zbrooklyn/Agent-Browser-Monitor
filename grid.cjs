// Agent Browsers — mission control for many AI-driven browsers, watched from a phone.
// Pure Node (built-in WebSocket client + http + SSE) + a PowerShell call for port discovery.
// Watch-only. Expose it however you like (a tailnet via `tailscale serve` is the easy private option). See README.md.
//
// Usage:  node grid.cjs [bindHost] [bindPort]
//   also honors env: HOST, PORT, TILE_Q/TILE_W/TILE_H, HQ_Q/HQ_W/HQ_H, STUCK_MS
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ---- config (flags first, then env, then defaults) -------------------------
const BIND_HOST = process.argv[2] || process.env.HOST || '127.0.0.1';
const BIND_PORT = parseInt(process.argv[3] || process.env.PORT || '8090', 10);
const TILE = { format: 'jpeg', quality: +(process.env.TILE_Q || 55), maxWidth: +(process.env.TILE_W || 800),  maxHeight: +(process.env.TILE_H || 500),  everyNthFrame: 1 }; // cheap tile frames
const HQ   = { format: 'jpeg', quality: +(process.env.HQ_Q   || 82), maxWidth: +(process.env.HQ_W   || 1920), maxHeight: +(process.env.HQ_H   || 1200), everyNthFrame: 1 }; // crisp focus frames
const FLOOR_MS = 700;                         // ~1.4 fps floor so streams never go blank
const STUCK_MS = +(process.env.STUCK_MS || 90000); // no visual change while live => "stuck"

const sessions = new Map(); // port -> { port, id, title, url, wsUrl, ws, lastFrame, lastSentAt, lastPaintAt, frames, tabs }
const hq = new Map();       // slug -> { ws, lastFrame, lastSentAt, lastPaintAt, subs:Set, capT } — on-demand high-res focus
const feedClients = new Set(); // res objects subscribed to the one multiplexed tile feed

// ---- slugs (stable, human-readable identity) -------------------------------
function slugify(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
// multi-label public suffixes where the meaningful name is the label *before* the suffix
const PSL2 = ['pages.dev', 'github.io', 'vercel.app', 'netlify.app', 'web.app', 'workers.dev', 'herokuapp.com', 'onrender.com', 'fly.dev', 'ngrok.io', 'ngrok-free.app'];
function deriveSlug(url, title) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (h && h !== 'localhost' && !/^\d+(\.\d+)+$/.test(h) && !h.includes(':')) { // skip localhost + IPv4/IPv6
      let base;
      const suf = PSL2.find(x => h === x || h.endsWith('.' + x));
      if (suf) base = (h.slice(0, h.length - suf.length).replace(/\.$/, '').split('.').pop()) || suf.split('.')[0];
      else { const p = h.split('.'); base = p.length >= 2 ? p[p.length - 2] : h; }
      if (base && base !== 'blank') return slugify(base);
    }
  } catch {}
  const t = slugify(title); if (t && t !== 'about-blank') return t;
  return '';
}
function uniqueSlug(base, selfPort) {
  const used = new Set([...sessions.values()].filter(s => s.port !== selfPort).map(s => s.id).filter(Boolean));
  if (!base) { let n = 1; while (used.has('session-' + n)) n++; return 'session-' + n; }
  if (!used.has(base)) return base;
  let n = 2; while (used.has(base + '-' + n)) n++; return base + '-' + n;
}
function sessionBySlug(slug) { for (const s of sessions.values()) if (s.id === slug) return s; return null; }

// ---- discovery (chrome.exe loopback debug ports via PowerShell) -------------
function discoverPorts() {
  return new Promise((resolve) => {
    const ps = "$pids=(Get-Process chrome -EA SilentlyContinue).Id; Get-NetTCPConnection -State Listen -EA SilentlyContinue | ?{ $_.OwningProcess -in $pids -and $_.LocalAddress -eq '127.0.0.1' } | Select -Expand LocalPort -Unique";
    execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000 }, (e, out) => {
      resolve((out || '').split(/\s+/).filter(x => /^\d+$/.test(x)).map(Number));
    });
  });
}
async function bestTarget(port) {
  try {
    const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const pages = t.filter(x => x.type === 'page' && x.webSocketDebuggerUrl);
    const best = pages.find(p => /^https?:/.test(p.url) && !/chrome-error/.test(p.url)) || pages[0] || null;
    return { best, tabs: pages.length };
  } catch { return { best: null, tabs: 0 }; }
}
async function refresh() {
  const ports = await discoverPorts();
  for (const port of ports) {
    const tgt = await bestTarget(port);
    if (!tgt.best) continue;
    let s = sessions.get(port);
    if (!s) {
      s = { port, id: null, title: tgt.best.title, url: tgt.best.url, tabs: tgt.tabs, wsUrl: tgt.best.webSocketDebuggerUrl, ws: null, lastFrame: null, lastSentAt: 0, lastPaintAt: 0, frames: 0 };
      s.id = uniqueSlug(deriveSlug(s.url, s.title), port);
      sessions.set(port, s); connect(s);
    } else {
      s.title = tgt.best.title; s.url = tgt.best.url; s.tabs = tgt.tabs;
      // one-time upgrade: a generic session-N slug that now has a real domain earns a real name
      if (/^session-\d+$/.test(s.id)) { const better = deriveSlug(s.url, s.title); if (better) s.id = uniqueSlug(better, port); }
      if (s.wsUrl !== tgt.best.webSocketDebuggerUrl) { s.wsUrl = tgt.best.webSocketDebuggerUrl; try { s.ws && s.ws.close(); } catch {} connect(s); }
    }
  }
  for (const [port, s] of sessions) { if (!ports.includes(port)) { try { s.ws && s.ws.close(); } catch {} sessions.delete(port); } }
}

// ---- per-session tile screencast -> multiplexed feed ------------------------
function feedSend(id, data) { const pl = `data: ${id}\t${data}\n\n`; for (const c of feedClients) { try { c.write(pl); } catch {} } }
function connect(s) {
  try {
    const ws = new WebSocket(s.wsUrl); s.ws = ws; let id = 0;
    const send = (m, p = {}) => { try { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); } catch {} };
    ws.onopen = () => { send('Page.enable'); send('Page.startScreencast', TILE); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.method === 'Page.screencastFrame') {
        send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
        s.frames++; s.lastFrame = m.params.data; s.lastSentAt = Date.now(); s.lastPaintAt = Date.now();
        feedSend(s.id, m.params.data);
      }
    };
    ws.onclose = () => { s.ws = null; };
    ws.onerror = () => {};
  } catch {}
}

// ---- on-demand high-res focus stream (2nd CDP session, by slug) ------------
function hqConnect(slug) {
  let h = hq.get(slug); if (h) return h;
  const s = sessionBySlug(slug); if (!s || !s.wsUrl) return null;
  h = { ws: null, lastFrame: null, lastSentAt: 0, lastPaintAt: 0, subs: new Set(), capT: null }; hq.set(slug, h);
  const push = (data) => { h.lastFrame = data; h.lastSentAt = Date.now(); const pl = `data: ${data}\n\n`; for (const c of h.subs) { try { c.write(pl); } catch {} } };
  try {
    const ws = new WebSocket(s.wsUrl); h.ws = ws; let id = 0;
    const send = (m, p = {}) => { const i = ++id; try { ws.send(JSON.stringify({ id: i, method: m, params: p })); } catch {} return i; };
    ws.onopen = () => { send('Page.enable'); send('Page.startScreencast', HQ); send('Page.captureScreenshot', { format: 'jpeg', quality: HQ.quality }); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.method === 'Page.screencastFrame') { send('Page.screencastFrameAck', { sessionId: m.params.sessionId }); h.lastPaintAt = Date.now(); push(m.params.data); }
      else if (m.id !== undefined && m.result && typeof m.result.data === 'string') { push(m.result.data); } // captureScreenshot seed/refresh
    };
    ws.onclose = () => { h.ws = null; };
    ws.onerror = () => {};
    h.capT = setInterval(() => { if (h.subs.size && h.ws && Date.now() - h.lastPaintAt > 1000) send('Page.captureScreenshot', { format: 'jpeg', quality: HQ.quality }); }, 1200);
  } catch {}
  return h;
}
function hqMaybeClose(slug) { const h = hq.get(slug); if (h && h.subs.size === 0) { clearInterval(h.capT); try { h.ws && h.ws.close(); } catch {} hq.delete(slug); } }

// ---- fps floor: re-send last frame to keep streams warm when idle ----------
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) { if (s.lastFrame && feedClients.size && now - s.lastSentAt >= FLOOR_MS) { s.lastSentAt = now; feedSend(s.id, s.lastFrame); } }
  for (const h of hq.values()) { if (h.lastFrame && h.subs.size && now - h.lastSentAt >= FLOOR_MS) { h.lastSentAt = now; const pl = `data: ${h.lastFrame}\n\n`; for (const c of h.subs) { try { c.write(pl); } catch {} } } }
}, FLOOR_MS);
refresh(); setInterval(refresh, 5000);

// ---- session state (for alerting; rendered in Pass 2) ----------------------
function stateOf(s) {
  if (!s.ws || !s.lastFrame) return 'idle';
  const dt = Date.now() - s.lastPaintAt;
  if (dt < 2500) return 'active';
  if (dt >= STUCK_MS) return 'stuck';
  return 'idle';
}
function needsAttention(s) { return stateOf(s) === 'stuck' || /login|signin|sign-in|captcha|challenge|verify|accounts\.google|\/auth/i.test(s.url || ''); }

const MARK = '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="9" height="9" rx="2.2" fill="#2ecc40"/><rect x="13" y="2" width="9" height="9" rx="2.2" fill="#3a3a40"/><rect x="2" y="13" width="9" height="9" rx="2.2" fill="#3a3a40"/><rect x="13" y="13" width="9" height="9" rx="2.2" fill="#3a3a40"/></svg>';
const ICO1 = '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2.2"/></svg>';
const ICO2 = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="8" height="14" rx="1.8"/><rect x="13" y="5" width="8" height="14" rx="1.8"/></svg>';
const ICO3 = '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="5.3" height="14" rx="1.5"/><rect x="9.35" y="5" width="5.3" height="14" rx="1.5"/><rect x="16.2" y="5" width="5.3" height="14" rx="1.5"/></svg>';
const ICOTAB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="13" height="13" rx="2"/><path d="M8 19h9a2 2 0 0 0 2-2V8"/></svg>';
const ICOLINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';
const ICODL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>';
const ICOFIT = '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';
const ICOSEL = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/></svg>';
const ICOZAP = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>';
const ICOSRCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>';
const ICOSLID = '<svg viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>';
const ICOFUN = '<svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
const ICOROT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 9"/><path d="M3 21v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 15"/></svg>';
const ICOSTAR = '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18l-5.8 3 1.1-6.5L2.6 9.9l6.5-.9z"/></svg>';
const ICOCHK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';

const GRID = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b0b0b">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Agents">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="icon" href="/icon-192.png">
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}</script>
<title>Agent Browsers</title>
<style>
:root{color-scheme:dark;--bg:#0b0b0d;--panel:#141417;--line:#26262c;--line2:#34343c;--muted:#8a8a93;--live:#2ecc40}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:#e6e6ea;font:14px system-ui,Segoe UI,Roboto,sans-serif;height:100%;-webkit-font-smoothing:antialiased;overscroll-behavior:none}
::selection{background:#2ecc4055}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:#2a2a30;border-radius:6px}::-webkit-scrollbar-thumb:hover{background:#3a3a42}::-webkit-scrollbar-track{background:transparent}
#top{position:sticky;top:0;z-index:10}
#hdr{display:flex;gap:12px;align-items:center;padding:11px 14px;padding-top:calc(11px + env(safe-area-inset-top));background:rgba(18,18,21,.86);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.brand{display:flex;gap:9px;align-items:center;font-weight:650;font-size:15px;letter-spacing:-.01em}
.mark{width:22px;height:22px;flex:0 0 auto}
#count{display:inline-flex;gap:7px;align-items:center;padding:4px 11px;border-radius:999px;background:#1c1c20;border:1px solid var(--line);font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
#count b{color:#e6e6ea;font-weight:650}
/* R3 mobile filter button (B-badge for needs-attention); hidden on desktop where the chips bar handles filtering */
#filterbtn{display:none;position:relative;align-items:center;gap:7px;height:36px;padding:0 13px;background:#1c1c20;border:1px solid var(--line);border-radius:10px;color:#c8ccd2;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;flex:0 0 auto}
#filterbtn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#filterbtn.act{background:#2ecc4022;border-color:#2ecc4066;color:#7ee08a}
.fbadge{display:none;position:absolute;top:-7px;right:-7px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:var(--amber);color:#1a1205;font-size:11px;font-weight:800;align-items:center;justify-content:center;border:2px solid #121215;font-variant-numeric:tabular-nums}
.fbadge.on{display:flex}
.dot{width:8px;height:8px;border-radius:50%;background:#555;flex:0 0 auto}
.dot.live{background:var(--live);box-shadow:0 0 7px #2ecc40aa;animation:pulse 1.9s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
#bar{display:flex;gap:6px;align-items:center;padding:8px 12px;background:rgba(14,14,17,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);overflow:hidden}
/* only the filter segment scrolls within its own track; search + actions stay pinned at any width */
#chips{flex:0 1 auto;min-width:0;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
#chips::-webkit-scrollbar{display:none}
/* one segmented control instead of floating pills — all controls share a 34px height */
.seg{display:inline-flex;flex:0 0 auto;align-items:center;height:34px;background:#1c1c20;border:1px solid var(--line);border-radius:9px;padding:3px;gap:2px}
.seg button,.seg .chip{height:100%;padding:0 12px;border:none;border-radius:6px;background:transparent;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;display:flex;align-items:center;justify-content:center}
.seg button svg,.seg .chip svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.seg .chip.on,.seg button.on{background:var(--live);color:#06210d}
.seg .chip.need.on{background:#e8a33d;color:#241400}
#tools button{width:32px;padding:0}
#optmenu{position:absolute;right:12px;top:calc(100% + 4px);min-width:208px;background:#16161a;border:1px solid var(--line2);border-radius:13px;padding:6px;box-shadow:0 16px 40px #000c;display:none;z-index:60}
#optmenu.open{display:block}
.msec{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);padding:8px 11px 4px;font-weight:700}
.mrow{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:9px;color:#dcdce2;font-size:13px;font-weight:550;cursor:pointer;white-space:nowrap}
.mrow:hover{background:#1f1f25}
.mrow svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
.mrow .ck{margin-left:auto;width:16px;height:16px;opacity:0}
.mrow.on .ck{opacity:1;stroke:var(--live)}
.mrow.on{color:#fff}
.msep{height:1px;background:var(--line);margin:5px 8px}
.mrow.rowflex{justify-content:space-between;cursor:default}
.miniseg{display:inline-flex;background:#0e0e11;border:1px solid var(--line);border-radius:8px;padding:2px;gap:2px}
.miniseg button{width:36px;height:32px;border:none;border-radius:6px;background:transparent;color:var(--muted);font-weight:700;font-size:13px;cursor:pointer}
.miniseg button.on{background:var(--live);color:#06210d}
#colrow{display:none}
/* sheet sections that exist only on mobile (Show filter + Select); hidden on desktop where chips bar + tools cover them */
.mob{display:none}
#showrow{padding:4px 8px 8px}
.showseg{display:flex;width:100%;gap:6px}
.showseg button{flex:1;height:40px;border:1px solid var(--line);border-radius:9px;background:#0e0e11;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.showseg button.on{background:var(--live);border-color:var(--live);color:#06210d}
.showseg button.need.on{background:#e8a33d;border-color:#e8a33d;color:#241400}
#searchwrap{margin-left:auto;padding:3px}
#searchwrap #searchbtn{width:32px;height:100%;padding:0;border:none;border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center}
#searchwrap #searchbtn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2}
#searchwrap.open #searchbtn{color:#e6e6ea}
#searchwrap input{width:0;min-width:0;opacity:0;border:none;background:transparent;outline:none;color:#e6e6ea;font-size:13px;padding:0;transition:width .18s ease,opacity .18s}
#searchwrap.open input{width:130px;opacity:1;padding-right:6px}
#sortsel{flex:0 0 auto;height:36px;border-radius:9px;background:#1c1c20;border:1px solid var(--line);color:#cfcfd6;font-size:12.5px;font-weight:600;cursor:pointer;padding:0 28px 0 11px;appearance:none;-webkit-appearance:none;background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%238a8a93%22 stroke-width=%223%22 stroke-linecap=%22round%22><path d=%22M6 9l6 6 6-6%22/></svg>');background-repeat:no-repeat;background-position:right 9px center}
.tile .check{position:absolute;top:8px;left:8px;width:24px;height:24px;border-radius:50%;border:2px solid #fff;background:#0009;display:none;align-items:center;justify-content:center;z-index:3;color:#fff;font-size:14px;font-weight:800}
body.select .tile{cursor:copy}
body.select .tile .check{display:flex}
body.select .tile .badge,body.select .tile .tabs{display:none}
.tile.sel .check{background:var(--live);border-color:var(--live);color:#06210d}
.tile.sel{border-color:var(--live);box-shadow:0 0 0 2px var(--live)}
#watchfab{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom));display:none;align-items:center;gap:8px;padding:12px 22px;border:none;border-radius:999px;background:var(--live);color:#06210d;font-size:14px;font-weight:700;cursor:pointer;z-index:55;box-shadow:0 8px 24px #0008}
#watchfab.show{display:inline-flex}
body.embed #top{display:none!important}
#lay{display:inline-flex;background:#1c1c20;border:1px solid var(--line);border-radius:10px;padding:3px;gap:2px}
#lay button{width:36px;height:30px;border:none;border-radius:7px;background:transparent;color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .14s,color .14s}
#lay button svg{width:18px;height:18px;fill:currentColor}
#lay button:hover{color:#d4d4da}
#lay button.on{background:var(--live);color:#06210d}
#grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:12px;padding-bottom:calc(12px + env(safe-area-inset-bottom))}
/* custom pull-to-refresh (PWA standalone suppresses the native gesture) */
#ptr{position:fixed;top:calc(env(safe-area-inset-top) - 6px);left:50%;transform:translate(-50%,0);z-index:40;width:38px;height:38px;border-radius:50%;background:#1c1c20;border:1px solid var(--line2);box-shadow:0 4px 16px #000a;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:transform .18s ease,opacity .15s}
#ptr svg{width:20px;height:20px;fill:none;stroke:var(--muted);stroke-width:2.4;stroke-linecap:round}
#ptr.ready svg{stroke:var(--live)}
#ptr.spin svg{stroke:var(--live);animation:ptrspin .7s linear infinite}
@keyframes ptrspin{to{transform:rotate(360deg)}}
.tile{position:relative;background:#000;border:1px solid var(--line);border-radius:13px;overflow:hidden;aspect-ratio:16/10;cursor:pointer;transition:border-color .15s,transform .15s,box-shadow .15s}
@media(hover:hover){.tile:hover{border-color:var(--line2);transform:translateY(-2px);box-shadow:0 8px 24px #0009}}
.tile img{width:100%;height:100%;object-fit:contain;display:block;background:#000;opacity:0;transition:opacity .35s}
.tile.ready img{opacity:1}
body.fit-cover .tile img,body.fit-cover #fimg{object-fit:cover}
/* hold-to-reorder: lifted tile follows the finger; others dim; page scroll locked during the drag */
body.dragging{touch-action:none}
body.dragging .tile{transition:none}
body.dragging #grid .tile:not(.drag){opacity:.5}
.tile.drag{opacity:.95;transform:scale(1.04);box-shadow:0 16px 40px #000d;z-index:6;border-color:var(--live)!important}
.tile .sk{position:absolute;inset:0;background:linear-gradient(100deg,#161619 30%,#202026 50%,#161619 70%);background-size:220% 100%;animation:shim 1.25s linear infinite}
@keyframes shim{0%{background-position:120% 0}100%{background-position:-120% 0}}
.tile.ready .sk{display:none}
.tile .badge{position:absolute;top:9px;left:9px;display:inline-flex;gap:5px;align-items:center;padding:3px 8px;border-radius:999px;background:#000a;font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--live)}
.tile .badge i{width:6px;height:6px;border-radius:50%;background:var(--live);box-shadow:0 0 6px #2ecc40;animation:pulse 1.9s ease-in-out infinite}
.tile.state-idle .badge{color:#9aa0a6}.tile.state-idle .badge i{background:#9aa0a6;box-shadow:none;animation:none}
.tile.state-stuck .badge{color:#e8a33d}.tile.state-stuck .badge i{background:#e8a33d;box-shadow:0 0 6px #e8a33d}
.tile.needs{border-color:#e8a33d!important;box-shadow:0 0 0 1px #e8a33d, 0 0 18px #e8a33d3a}
#needs{display:none;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;background:#e8a33d1f;border:1px solid #e8a33d66;color:#f0b860;font-size:12.5px;font-weight:650;cursor:pointer;text-decoration:none}
#needs.on{display:inline-flex}
#needs i{width:7px;height:7px;border-radius:50%;background:#e8a33d;box-shadow:0 0 7px #e8a33d;animation:pulse 1.6s ease-in-out infinite}
.tile .tabs{position:absolute;top:9px;right:44px;display:none;gap:5px;align-items:center;padding:3px 8px 3px 7px;border-radius:999px;background:#000a;font-size:11.5px;font-weight:650;color:#d4d4da;font-variant-numeric:tabular-nums}
.tile.multi .tabs{display:inline-flex}
.tile .tabs svg{width:13px;height:13px;flex:0 0 auto;opacity:.85}
/* pin / favorite: a subtle star top-right; gold when pinned; pinned tiles float to the top */
.pin{position:absolute;top:8px;right:8px;width:30px;height:30px;border:none;border-radius:8px;background:#0007;color:#fff;opacity:.38;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:4;padding:0;transition:opacity .15s,color .15s}
.pin svg{width:15px;height:15px;fill:currentColor;stroke:none}
@media(hover:hover){.tile:hover .pin{opacity:.85}}
.tile.pinned .pin{opacity:1;color:#e8c33d}
body.select .pin,body.dragging .pin{display:none}
.tile .lbl{position:absolute;left:0;right:0;bottom:0;padding:9px 11px 10px;background:linear-gradient(transparent,#000 92%);display:flex;flex-direction:column;gap:1px}
.tile .t{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .d{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:#9a9aa3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#empty{display:none;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;color:var(--muted);min-height:62vh;padding:40px 24px}
#empty.on{display:flex}
#empty .mark{width:54px;height:54px;opacity:.5}
#empty h2{margin:0;font-size:17px;color:#cfcfd6;font-weight:650}
#empty p{margin:0;max-width:340px;line-height:1.5;font-size:13px}
#focus{position:fixed;inset:0;background:#000;display:none;z-index:50}
#focus.on{display:block}
#fimg{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;touch-action:none;transform-origin:0 0}
/* fill-the-glass: rotate the view 90° (element takes swapped dims; applyZoom adds the rotate transform) */
#focus.rot #fimg{inset:auto;top:50%;left:50%;width:100vh;height:100vw;transform-origin:center}
.fbtn.on{color:var(--live)}
#fbar{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:12px;padding:11px 13px;padding-top:calc(11px + env(safe-area-inset-top));background:linear-gradient(#000c,#0000);z-index:52;transition:opacity .25s}
.glass{background:#000b;backdrop-filter:blur(8px);border:1px solid #ffffff1f}
#back{display:flex;align-items:center;gap:5px;color:#fff;font-size:14px;font-weight:550;padding:9px 14px;border-radius:11px;cursor:pointer}
#back:active{background:#000d}
#fid{display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;flex:1}
#fname{font-weight:650;font-size:14.5px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;cursor:text}
#fname.editing{overflow:visible;outline:none;background:#ffffff1f;border-radius:6px;padding:1px 7px;box-shadow:0 0 0 1px #2ecc4088}
.fsub{display:flex;align-items:center;gap:7px;min-width:0;max-width:100%}
#fdom{font:12px ui-monospace,SFMono-Regular,Consolas,monospace;color:#9a9aa3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto}
#ftime{font-size:11px;color:#9a9aa3;white-space:nowrap;flex:0 0 auto}
#ftime.stuck{color:#e8a33d}
#fdot{flex:0 0 auto}
#fdot.active{background:var(--live);box-shadow:0 0 7px #2ecc40aa;animation:pulse 1.9s ease-in-out infinite}
#fdot.idle{background:#9aa0a6;box-shadow:none;animation:none}
#fdot.stuck{background:#e8a33d;box-shadow:0 0 7px #e8a33d;animation:pulse 1.6s ease-in-out infinite}
.fbtn{flex:0 0 auto;width:42px;height:42px;border-radius:11px;color:#fff;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.fbtn:active{background:#000d}
.fbtn svg{width:18px;height:18px}
#fnav{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));display:flex;gap:2px;align-items:center;border-radius:13px;padding:4px;z-index:52;transition:opacity .25s}
#fnav button{width:48px;height:42px;border:none;background:transparent;color:#fff;font-size:21px;cursor:pointer;border-radius:9px;display:flex;align-items:center;justify-content:center}
#fnav button:active{background:#ffffff22}
#fzap svg{width:18px;height:18px;fill:currentColor;stroke:none}
#flbl{color:#cfcfd6;font-size:12.5px;font-weight:600;padding:0 13px;min-width:54px;text-align:center;font-variant-numeric:tabular-nums}
#focus.idle #fbar,#focus.idle #fnav{opacity:0;pointer-events:none}
/* embed mode: chrome-less single stream */
body.embed #hdr,body.embed #grid,body.embed #fbar,body.embed #fnav{display:none!important}
body.embed #focus{display:block}
/* ---- phone tuning (placed last so it wins the cascade): compact header, thumb-sized tap targets, bottom-sheet Options ---- */
@media(max-width:540px){
  #hdr{gap:9px}
  /* R3: one row — name + inline live-count on the left, search + Filter pushed right; tiles start immediately */
  .brand{flex:0 1 auto;min-width:0}.brand>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #count{display:inline-flex;background:none;border:none;padding:0;height:auto;flex:0 0 auto;font-size:12.5px}
  #needs,#needs.on{display:none}                          /* needs-attention shows as the badge on Filter, not a pill (#needs.on beats the base .on rule) */
  #bar{display:none}                                      /* chips + tools move into the Filter sheet */
  #lay{display:none}#colrow{display:flex}                 /* columns live in the sheet → header stays clean */
  #filterbtn{display:inline-flex;height:44px}
  #searchwrap{height:44px;padding:0}#searchwrap #searchbtn{width:44px;height:44px}
  #searchwrap.open input{width:84px}
  .showseg button{height:44px}                            /* thumb-sized filter buttons in the sheet */
  .miniseg button{width:44px;height:40px}
  .mob{display:block}.mrow.mob{display:flex}              /* reveal Show + Select sections in the sheet */
  #optmenu{position:fixed;left:0;right:0;bottom:0;top:auto;min-width:0;border-radius:18px 18px 0 0;padding:8px 10px calc(12px + env(safe-area-inset-bottom));transform:translateY(110%);transition:transform .22s ease;display:block;box-shadow:0 -10px 40px #000c}
  #optmenu.open{transform:none}
  .mrow{padding:14px 12px;font-size:14px}
  .msec{padding:11px 12px 5px}
}
</style></head><body>
<header id="top"><div id="hdr"><span class="brand">${MARK}<span>Agent Browsers</span></span><span id="count"><i class="dot"></i><b id="cnum">0</b><span class="lbl">&nbsp;live</span></span><a id="needs" href="/?show=needs"><i></i><b id="needn">0</b><span class="lbl">&nbsp;need you</span></a><div id="searchwrap" class="seg"><button id="searchbtn" aria-label="Search">${ICOSRCH}</button><input id="q" placeholder="filter…" autocomplete="off"></div><button id="filterbtn" aria-label="Filter &amp; options"><span class="fbadge" id="filterbadge">0</span>${ICOFUN}<span id="filterlbl">Filter</span></button><span id="lay"><button data-c="1" title="Single pane" aria-label="Single pane">${ICO1}</button><button data-c="2" title="Two columns" aria-label="Two columns">${ICO2}</button><button data-c="3" title="Three columns" aria-label="Three columns">${ICO3}</button></span></div>
<div id="bar"><div id="chips" class="seg"><button class="chip" data-show="">All</button><button class="chip" data-show="live">Live</button><button class="chip" data-show="idle">Idle</button><button class="chip" data-show="multi">Multi</button><button class="chip need" data-show="needs">Needs</button></div><div id="tools" class="seg"><button id="selbtn" title="Select sessions to watch together" aria-label="Select">${ICOSEL}</button><button id="optbtn" title="Sort &amp; view options" aria-label="Options">${ICOSLID}</button></div></div><div id="optmenu"><div class="msec mob">Show</div><div id="showrow" class="mob"><span class="showseg"><button data-show="">All</button><button data-show="live">Live</button><button data-show="idle">Idle</button><button data-show="multi">Multi</button><button class="need" data-show="needs">Needs</button></span></div><div class="msep mob"></div><div class="msec">Sort</div><div class="mrow" data-sort="">Active first<span class="ck">${ICOCHK}</span></div><div class="mrow" data-sort="name">Name A–Z<span class="ck">${ICOCHK}</span></div><div class="mrow" data-sort="newest">Newest<span class="ck">${ICOCHK}</span></div><div class="msep"></div><div class="msec">View</div><div class="mrow rowflex" id="colrow"><span>Columns</span><span class="miniseg"><button data-c="1">1</button><button data-c="2">2</button><button data-c="3">3</button></span></div><div class="mrow" id="fitrow">${ICOFIT}Cover images<span class="ck">${ICOCHK}</span></div><div class="mrow mob" id="selrow">${ICOSEL}Select to watch…</div><div class="mrow" id="activerow">${ICOZAP}Jump to most active</div></div></header>
<div id="ptr"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg></div>
<div id="grid"></div>
<button id="watchfab">Watch&nbsp;<b id="watchn">0</b></button>
<div id="empty">${MARK}<h2>No agent browsers detected</h2><p>Launch a Playwright or pool browser on this machine and it appears here automatically.</p></div>
<div id="focus"><img id="fimg"><div id="fbar"><button id="back" class="glass">&#x2039;&nbsp;Back</button><div id="fid"><span id="fname" title="Tap to rename"></span><span class="fsub"><span class="dot" id="fdot"></span><span id="fdom"></span><span id="ftime"></span></span></div><button id="fsave" class="fbtn glass" aria-label="Save frame" title="Save frame">${ICODL}</button><button id="fcopy" class="fbtn glass" aria-label="Copy link" title="Copy link">${ICOLINK}</button><button id="frot" class="fbtn glass" aria-label="Rotate to fill" title="Rotate to fill">${ICOROT}</button><button id="ffs" class="fbtn glass" aria-label="Fullscreen" title="Fullscreen">&#x26F6;</button></div><div id="fnav" class="glass"><button id="fzap" aria-label="Jump to most active" title="Jump to most active">${ICOZAP}</button><button id="prev" aria-label="Previous">&#x2039;</button><span id="flbl"></span><button id="next" aria-label="Next">&#x203A;</button></div></div>
<script>
const grid=document.getElementById('grid'),cnum=document.getElementById('cnum'),hdot=document.querySelector('#count .dot'),empty=document.getElementById('empty');
const focus=document.getElementById('focus'),fimg=document.getElementById('fimg'),flbl=document.getElementById('flbl'),back=document.getElementById('back'),prev=document.getElementById('prev'),next=document.getElementById('next');
const fname=document.getElementById('fname'),fdom=document.getElementById('fdom'),fdot=document.getElementById('fdot'),ftime=document.getElementById('ftime'),ffs=document.getElementById('ffs'),fcopy=document.getElementById('fcopy'),fsave=document.getElementById('fsave'),frot=document.getElementById('frot'),fzap=document.getElementById('fzap');
const qbox=document.getElementById('q'),needsEl=document.getElementById('needs'),neednEl=document.getElementById('needn');
const filterbtn=document.getElementById('filterbtn'),filterlbl=document.getElementById('filterlbl'),filterbadge=document.getElementById('filterbadge');
const selbtn=document.getElementById('selbtn'),optbtn=document.getElementById('optbtn'),optmenu=document.getElementById('optmenu'),fitrow=document.getElementById('fitrow'),activerow=document.getElementById('activerow'),selrow=document.getElementById('selrow'),watchfab=document.getElementById('watchfab'),watchn=document.getElementById('watchn');
let selectMode=false; const selSet=new Set();
const tiles=new Map(),meta=new Map(); let order=[],all=[];
let customOrder=null;try{customOrder=JSON.parse(localStorage.getItem('order')||'null');}catch(_){}   // user's drag-reordered tile order
let pins=new Set();try{pins=new Set(JSON.parse(localStorage.getItem('pins')||'[]'));}catch(_){}      // favorited tiles (sort to top)
let dragId=null,lastDragEnd=0;
let focusSlug=null,focusES=null,feedES=null,editing=false;
let watch=null;            // array of slugs for /watch, else null
let embed=false;           // /embed mode
const params=new URLSearchParams(location.search);
const _dec=document.createElement('textarea');
function decodeEntities(s){if(!s||s.indexOf('&')<0)return s;_dec.innerHTML=s;return _dec.value;} // titles from CDP arrive HTML-encoded (e.g. &amp;)
let names={};try{names=JSON.parse(localStorage.getItem('names')||'{}');}catch(_){}   // user-given custom session names
function nameOf(s){return names[s.id]||decodeEntities(s.title||s.id);}
function domainOf(u){try{const x=new URL(u);return x.hostname.replace(/^www\\./,'')+(x.pathname.replace(/\\/$/,'')||'');}catch{return u||'';}}

// ---------- multiplexed tile feed (ONE connection) ----------
function openFeed(){ if(feedES)return; feedES=new EventSource('/api/feed');
  feedES.onmessage=e=>{const i=e.data.indexOf('\\t');if(i<0)return;const id=e.data.slice(0,i),data=e.data.slice(i+1);
    const t=tiles.get(id); if(t&&t.visible){t.img.src='data:image/jpeg;base64,'+data;t.el.classList.add('ready');}}; }
function closeFeed(){ if(feedES){feedES.close();feedES=null;} }
document.addEventListener('visibilitychange',()=>{ if(document.hidden)closeFeed(); else openFeed(); });

// ---------- focus (HQ, 2nd connection by slug) ----------
const io=new IntersectionObserver(es=>{for(const e of es){const t=tiles.get(e.target.dataset.id);if(t)t.visible=e.isIntersecting;}},{root:null,rootMargin:'120px'});
function viewFocus(slug){
  if(focusSlug===slug&&focus.classList.contains('on')){syncFocusBar();return;}
  focusSlug=slug;focus.classList.add('on');focus.classList.remove('idle');resetZoom();syncFocusBar();
  fimg.removeAttribute('src');if(focusES)focusES.close();
  focusES=new EventSource('/api/hq/'+slug);focusES.onmessage=e=>fimg.src='data:image/jpeg;base64,'+e.data;
  if(params.get('full')==='1')requestFS();}
function viewGrid(){focus.classList.remove('on','idle');if(focusES){focusES.close();focusES=null;}focusSlug=null;document.title='Agent Browsers';}
function fmtAgo(ms){if(ms==null)return '';const s=Math.round(ms/1000);if(s<2)return 'live';if(s<60)return s+'s ago';const m=Math.round(s/60);if(m<60)return m+'m ago';return Math.round(m/60)+'h ago';}
function syncFocusBar(){const m=meta.get(focusSlug)||{};const st=m.state||'idle';if(!editing)fname.textContent=m.title||focusSlug;
  fdom.textContent=m.url||'';                                  // full URL, not just the domain
  fdot.className='dot '+st;                                    // dot colored by live/idle/stuck state
  const ago=st==='active'?'live':(st==='stuck'?'stuck '+fmtAgo(m.lastChangeMs):fmtAgo(m.lastChangeMs));
  ftime.textContent=ago?('· '+ago):'';ftime.className=st==='stuck'?'stuck':'';
  const i=order.indexOf(focusSlug);flbl.textContent=order.length>1?((i+1)+' / '+order.length):'';prev.style.visibility=next.style.visibility=order.length>1?'':'hidden';
  document.title=(m.title?m.title.replace(/(?: · Agent Browsers)+$/,'')+' · ':'')+'Agent Browsers';} // strip repeats so a self-viewing session can't compound the title

// ---------- routing ----------
function qstr(){const s=params.toString();return s?('?'+s):'';}
function render(){
  const path=decodeURIComponent(location.pathname);
  let m;
  if((m=path.match(/^\\/embed\\/([^/]+)/))){embed=true;document.body.classList.add('embed');watch=null;viewFocus(m[1]);return;}
  embed=false;document.body.classList.remove('embed');
  if(path==='/active'){const a=mostActive();if(a)viewFocus(a);else viewGrid();return;}
  if((m=path.match(/^\\/watch\\/(.+)/))){watch=m[1].split('+').filter(Boolean);viewGrid();applyGrid();return;}
  watch=null;
  if((m=path.match(/^\\/([^/]+)/))&&path!=='/'){viewFocus(m[1]);return;}
  viewGrid();applyGrid();
}
function nav(path,replace){const url=path+qstr();if(location.pathname+location.search!==url){replace?history.replaceState({},'',url):history.pushState({},'',url);}render();}
function openFocus(slug){nav('/'+slug);}
function mostActive(){let best=null,bt=-1;for(const s of all){const v=s.state==='active'?2:s.state==='idle'?1:0;if(v>bt){bt=v;best=s.id;}}return best;}
addEventListener('popstate',render);
back.onclick=()=>nav('/');
function step(d){if(order.length<2)return;buzz();let i=order.indexOf(focusSlug);if(i<0)i=0;i=(i+d+order.length)%order.length;nav('/'+order[i],true);}
prev.onclick=e=>{e.stopPropagation();step(-1);};next.onclick=e=>{e.stopPropagation();step(1);};

// ---------- focus chrome: idle-hide, fullscreen, copy-link ----------
function toggleChrome(){focus.classList.toggle('idle');buzz(8);}   // immersive: a tap on the image hides/shows ALL chrome (no auto-hide timer)
function nativeFS(){return document.fullscreenElement||document.webkitFullscreenElement;}
function requestFS(){const r=focus.requestFullscreen||focus.webkitRequestFullscreen;if(r){try{const p=r.call(focus);if(p&&p.catch)p.catch(()=>{});}catch(_){}}}
ffs.onclick=e=>{e.stopPropagation();if(nativeFS()){(document.exitFullscreen||document.webkitExitFullscreen).call(document);}else requestFS();};
fcopy.onclick=async e=>{e.stopPropagation();const url=location.origin+'/'+focusSlug;try{await navigator.clipboard.writeText(url);fcopy.style.color='#2ecc40';setTimeout(()=>fcopy.style.color='',900);}catch(_){}};
fsave.onclick=e=>{e.stopPropagation();if(!fimg.src)return;const a=document.createElement('a');a.href=fimg.src;a.download=(focusSlug||'frame')+'-'+Date.now()+'.jpg';document.body.appendChild(a);a.click();a.remove();fsave.style.color='#2ecc40';setTimeout(()=>fsave.style.color='',900);};
frot.onclick=e=>{e.stopPropagation();toggleRot();};
fzap.onclick=e=>{e.stopPropagation();buzz();nav('/active');};
// tap the title to rename the session (persists, feeds the tile name); Enter saves, Esc cancels, blank reverts
fname.onclick=e=>{if(!focusSlug||editing)return;e.stopPropagation();editing=true;fname.contentEditable='true';fname.classList.add('editing');
  fname.textContent=names[focusSlug]||(meta.get(focusSlug)||{}).title||focusSlug;fname.focus();
  const r=document.createRange();r.selectNodeContents(fname);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);};
function commitRename(save){if(!editing)return;editing=false;fname.contentEditable='false';fname.classList.remove('editing');
  if(save){const v=fname.textContent.trim().replace(/\\s+/g,' ');if(v)names[focusSlug]=v;else delete names[focusSlug];try{localStorage.setItem('names',JSON.stringify(names));}catch(_){}}
  const s=all.find(x=>x.id===focusSlug),mm=meta.get(focusSlug);if(s&&mm)mm.title=nameOf(s);   // refresh meta so the bar shows the new name immediately
  applyGrid();syncFocusBar();}
fname.addEventListener('keydown',e=>{if(!editing)return;e.stopPropagation();if(e.key==='Enter'){e.preventDefault();commitRename(true);}else if(e.key==='Escape'){e.preventDefault();commitRename(false);}});
fname.addEventListener('blur',()=>commitRename(true));
addEventListener('keydown',e=>{if(!focus.classList.contains('on'))return;if(e.key==='Escape')nav('/');else if(e.key==='ArrowRight')step(1);else if(e.key==='ArrowLeft')step(-1);else if(e.key==='f')ffs.onclick(e);});

// ---------- pinch-zoom + pan on focus image ----------
function buzz(ms){try{navigator.vibrate&&navigator.vibrate(ms||10);}catch(_){}}
let z=1,tx=0,ty=0,pts=new Map(),pinch=null,swipe=null,multi=false;
function applyZoom(){fimg.style.transform=focus.classList.contains('rot')?('translate(-50%,-50%) rotate(90deg) scale('+z+')'):('translate('+tx+'px,'+ty+'px) scale('+z+')');}
function resetZoom(){z=1;tx=0;ty=0;applyZoom();}
function toggleRot(){focus.classList.toggle('rot');frot.classList.toggle('on',focus.classList.contains('rot'));resetZoom();buzz();}   // fill the glass: rotate the view 90° so a landscape page fills a portrait phone
fimg.addEventListener('pointerdown',e=>{pts.set(e.pointerId,{x:e.clientX,y:e.clientY});try{fimg.setPointerCapture(e.pointerId);}catch(_){}
  if(pts.size===1){swipe={x:e.clientX,y:e.clientY,t:Date.now()};multi=false;}
  if(pts.size===2){multi=true;const p=[...pts.values()];pinch={d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),z};}});
fimg.addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;if(focus.classList.contains('rot'))return;const prev=pts.get(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pts.size===2&&pinch){const p=[...pts.values()];const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);z=Math.max(1,Math.min(5,pinch.z*d/pinch.d));if(z===1){tx=0;ty=0;}applyZoom();}
  else if(pts.size===1&&z>1){tx+=e.clientX-prev.x;ty+=e.clientY-prev.y;applyZoom();}});
function liftPtr(e){
  // single-finger flick on an un-zoomed image: ←/→ switch session, swipe-down closes
  if(pts.size===1&&!multi&&z===1&&swipe){const dx=e.clientX-swipe.x,dy=e.clientY-swipe.y,dt=Date.now()-swipe.t;
    if(Math.abs(dx)<10&&Math.abs(dy)<10){toggleChrome();}            // a tap toggles all chrome (works rotated too)
    else if(!focus.classList.contains('rot')){                       // swipe nav/close only when not rotated
      if(dt<600&&Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.3){step(dx<0?1:-1);}
      else if(dt<600&&dy>90&&dy>Math.abs(dx)){buzz();nav('/');}}}
  pts.delete(e.pointerId);if(pts.size<2)pinch=null;if(pts.size===0)swipe=null;}
fimg.addEventListener('pointerup',liftPtr);fimg.addEventListener('pointercancel',liftPtr);
fimg.addEventListener('dblclick',()=>{z>1?resetZoom():(z=2,applyZoom());});

// ---------- tiles ----------
function setTabs(x,n){x.tn.textContent=n;x.el.classList.toggle('multi',n>1);}
function addTile(s){const el=document.createElement('div');el.className='tile';el.dataset.id=s.id;
  el.innerHTML='<div class="sk"></div><img><div class="check">&#x2713;</div><span class="badge"><i></i><span class="bt">LIVE</span></span><button class="pin" aria-label="Pin">${ICOSTAR}</button><span class="tabs">${ICOTAB}<span class="tn"></span></span><div class="lbl"><span class="t"></span><span class="d"></span></div>';
  const img=el.querySelector('img'),t=el.querySelector('.t'),d=el.querySelector('.d'),tn=el.querySelector('.tn'),bt=el.querySelector('.bt'),pin=el.querySelector('.pin');
  t.textContent=nameOf(s);d.textContent=domainOf(s.url);el.onclick=()=>tileClick(s.id);setupDrag(el,s.id);
  pin.addEventListener('pointerdown',e=>e.stopPropagation());           // don't start a drag from the star
  pin.onclick=e=>{e.stopPropagation();togglePin(s.id);};
  grid.appendChild(el);const x={el,img,t,d,tn,bt,visible:true};tiles.set(s.id,x);setTabs(x,s.tabs);if(selSet.has(s.id))el.classList.add('sel');if(pins.has(s.id))el.classList.add('pinned');io.observe(el);}
function togglePin(id){if(pins.has(id))pins.delete(id);else pins.add(id);try{localStorage.setItem('pins',JSON.stringify([...pins]));}catch(_){}const x=tiles.get(id);if(x)x.el.classList.toggle('pinned',pins.has(id));buzz(12);applyGrid();}
function tileClick(id){if(Date.now()-lastDragEnd<350)return;buzz();if(selectMode)toggleSel(id);else openFocus(id);}
// long-press a tile, then drag to reorder; the order persists and becomes the default ordering
function setupDrag(el,id){let lp=null,on=false,sx=0,sy=0;
  el.addEventListener('pointerdown',e=>{if(selectMode||focus.classList.contains('on'))return;sx=e.clientX;sy=e.clientY;on=false;
    lp=setTimeout(()=>{on=true;beginDrag(id);buzz(20);try{el.setPointerCapture(e.pointerId);}catch(_){}},380);});
  el.addEventListener('pointermove',e=>{if(!on){if(Math.abs(e.clientX-sx)>10||Math.abs(e.clientY-sy)>10)clearTimeout(lp);return;}e.preventDefault();dragOver(e.clientX,e.clientY);});
  const end=()=>{clearTimeout(lp);if(on){on=false;endDrag();}};
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);}
function beginDrag(id){dragId=id;document.body.classList.add('dragging');const x=tiles.get(id);if(x)x.el.classList.add('drag');}
function dragOver(x,y){if(!dragId)return;const el=document.elementFromPoint(x,y);if(!el)return;const tile=el.closest('.tile');if(!tile||!tile.dataset.id||tile.dataset.id===dragId)return;
  const from=order.indexOf(dragId),to=order.indexOf(tile.dataset.id);if(from<0||to<0)return;
  order.splice(to,0,order.splice(from,1)[0]);order.forEach((sid,i)=>{const tt=tiles.get(sid);if(tt)tt.el.style.order=i;});}
function endDrag(){const x=tiles.get(dragId);if(x)x.el.classList.remove('drag');document.body.classList.remove('dragging');dragId=null;lastDragEnd=Date.now();
  customOrder=order.slice();try{localStorage.setItem('order',JSON.stringify(customOrder));}catch(_){}}
function toggleSel(id){const x=tiles.get(id);if(!x)return;if(selSet.has(id)){selSet.delete(id);x.el.classList.remove('sel');}else{selSet.add(id);x.el.classList.add('sel');}watchn.textContent=selSet.size;watchfab.classList.toggle('show',selSet.size>0);}
function removeTile(id){const x=tiles.get(id);if(x){io.unobserve(x.el);x.el.remove();tiles.delete(id);}}
function setState(x,s){x.el.classList.remove('state-active','state-idle','state-stuck');x.el.classList.add('state-'+(s.state||'idle'));x.el.classList.toggle('needs',!!s.needs);x.bt.textContent=s.state==='stuck'?'STUCK':s.state==='active'?'LIVE':'IDLE';}

// ---------- which sessions to show (watch set + query filters + sort) ----------
function applyGrid(){
  if(dragId)return;                                            // don't reshuffle mid-drag
  const q=(params.get('q')||'').toLowerCase(),show=params.get('show'),sort=params.get('sort');
  let list=all.slice();
  if(watch)list=list.filter(s=>watch.includes(s.id));
  if(q)list=list.filter(s=>(s.id+' '+(s.title||'')+' '+(s.url||'')).toLowerCase().includes(q));
  if(show==='live')list=list.filter(s=>s.live);
  else if(show==='idle')list=list.filter(s=>s.state==='idle');
  else if(show==='multi')list=list.filter(s=>s.tabs>1);
  else if(show==='needs')list=list.filter(s=>s.needs);
  if(sort==='name')list.sort((a,b)=>a.id.localeCompare(b.id));
  else if(sort==='newest')list.sort((a,b)=>b.port-a.port);
  else if(customOrder){const ix=id=>{const i=customOrder.indexOf(id);return i<0?1e9:i;};list.sort((a,b)=>(ix(a.id)-ix(b.id))||((b.state==='active')-(a.state==='active')));} // user's drag order
  else list.sort((a,b)=>(b.state==='active')-(a.state==='active')); // default "Active first": stable partition, active on top
  if(pins.size)list.sort((a,b)=>(pins.has(a.id)?0:1)-(pins.has(b.id)?0:1)); // favorites float to the top (stable, after any sort)
  const want=new Set(list.map(s=>s.id));
  for(const id of [...tiles.keys()])if(!want.has(id))removeTile(id);
  for(const s of list){if(!tiles.has(s.id))addTile(s);const x=tiles.get(s.id);x.t.textContent=nameOf(s);x.d.textContent=domainOf(s.url);setState(x,s);setTabs(x,s.tabs);x.el.classList.toggle('pinned',pins.has(s.id));x.el.style.order=list.indexOf(s);}
  order=list.map(s=>s.id);
  empty.classList.toggle('on',list.length===0&&!focus.classList.contains('on'));
  grid.style.display=focus.classList.contains('on')?'none':(list.length===0?'none':'');
}

// ---------- poll session list ----------
async function poll(){let list=[];try{list=await(await fetch('/api/sessions')).json();}catch{}
  all=list;
  const liveN=list.filter(s=>s.live).length;cnum.textContent=liveN;hdot.classList.toggle('live',liveN>0);
  const needN=list.filter(s=>s.needs).length;neednEl.textContent=needN;needsEl.classList.toggle('on',needN>0);
  // mobile: needs-attention rides as an amber count badge on the Filter button (B) — name + live-count stay put
  filterbadge.textContent=needN;filterbadge.classList.toggle('on',needN>0);
  filterbtn.setAttribute('aria-label',needN>0?(needN+' need you · filter & options'):'Filter & options');
  notify(list);
  meta.clear();for(const s of list)meta.set(s.id,{title:nameOf(s),url:s.url,live:s.live,state:s.state,needs:s.needs,lastChangeMs:s.lastChangeMs});
  applyGrid();
  const slugs=new Set(list.map(s=>s.id));
  if(focusSlug!=null&&!slugs.has(focusSlug)&&list.length){ if(embed){/*keep waiting*/} else {viewGrid();if(location.pathname!=='/')history.replaceState({},'','/'+qstr());applyGrid();} }
  else if(focusSlug!=null&&focus.classList.contains('on'))syncFocusBar();
  if(location.pathname==='/active'){const a=mostActive();if(a&&a!==focusSlug)viewFocus(a);}
}

// ---------- layout + query wiring ----------
const colBtns=()=>document.querySelectorAll('[data-c]'); // header switcher + Options sheet share one source of truth
function setCols(n){if(!(n==='1'||n==='2'||n==='3'))return;
  grid.style.gridTemplateColumns='repeat('+n+',1fr)';
  colBtns().forEach(b=>b.classList.toggle('on',b.dataset.c===String(n)));
  localStorage.setItem('cols',n);
  if(n==='2')params.delete('cols');else params.set('cols',n); // 2 is default → omit
  history.replaceState({},'',location.pathname+qstr());}
colBtns().forEach(b=>b.onclick=e=>{e.stopPropagation();setCols(b.dataset.c);});
// init from query/localStorage
if(params.get('fit')==='cover')document.body.classList.add('fit-cover');
const initCols=params.get('cols')||localStorage.getItem('cols')||(innerWidth<=540?'1':'2'); // bigger tiles on phones by default
grid.style.gridTemplateColumns='repeat('+initCols+',1fr)';colBtns().forEach(b=>b.classList.toggle('on',b.dataset.c===initCols));
// reflect current query state onto the toolbar (desktop chips + mobile sheet share [data-show])
const FILTERLBL={'':'Filter',live:'Live',idle:'Idle',multi:'Multi',needs:'Needs'};
function syncBar(){const show=params.get('show')||'';[...document.querySelectorAll('[data-show]')].forEach(c=>c.classList.toggle('on',(c.dataset.show||'')===show));
  filterlbl.textContent=FILTERLBL[show]||'Filter';filterbtn.classList.toggle('act',!!show);   // Filter button names the active filter
  const sort=params.get('sort')||'';[...optmenu.querySelectorAll('[data-sort]')].forEach(r=>r.classList.toggle('on',(r.dataset.sort||'')===sort));
  fitrow.classList.toggle('on',params.get('fit')==='cover');}
// filter chips + sheet Show buttons -> ?show (and exit /watch back to the grid); close the sheet after a sheet pick
[...document.querySelectorAll('[data-show]')].forEach(c=>c.onclick=()=>{const v=c.dataset.show;if(v)params.set('show',v);else params.delete('show');nav('/');syncBar();optmenu.classList.remove('open');});
// options sheet opens from either the desktop Options button or the mobile Filter button
optbtn.onclick=e=>{e.stopPropagation();optmenu.classList.toggle('open');};
filterbtn.onclick=e=>{e.stopPropagation();optmenu.classList.toggle('open');};
document.addEventListener('click',e=>{if(!optmenu.contains(e.target)&&!optbtn.contains(e.target)&&!filterbtn.contains(e.target))optmenu.classList.remove('open');});
[...optmenu.querySelectorAll('[data-sort]')].forEach(r=>r.onclick=()=>{const v=r.dataset.sort;if(v)params.set('sort',v);else params.delete('sort');history.replaceState({},'',location.pathname+qstr());applyGrid();syncBar();});
fitrow.onclick=()=>{const on=!document.body.classList.contains('fit-cover');document.body.classList.toggle('fit-cover',on);if(on)params.set('fit','cover');else params.delete('fit');history.replaceState({},'',location.pathname+qstr());syncBar();};
activerow.onclick=()=>{optmenu.classList.remove('open');nav('/active');};
selbtn.onclick=()=>{selectMode=!selectMode;document.body.classList.toggle('select',selectMode);selbtn.classList.toggle('on',selectMode);if(!selectMode){selSet.clear();[...tiles.values()].forEach(x=>x.el.classList.remove('sel'));watchfab.classList.remove('show');}};
selrow.onclick=()=>{optmenu.classList.remove('open');selbtn.onclick();};   // sheet Select row reuses the select toggle
watchfab.onclick=()=>{if(!selSet.size)return;buzz(20);const set=[...selSet];selectMode=false;document.body.classList.remove('select');selbtn.classList.remove('on');watchfab.classList.remove('show');[...tiles.values()].forEach(x=>x.el.classList.remove('sel'));nav('/watch/'+set.join('+'));};
// collapsible search reflects to ?q
const searchbtn=document.getElementById('searchbtn'),searchwrap=document.getElementById('searchwrap');
searchbtn.onclick=()=>{searchwrap.classList.toggle('open');if(searchwrap.classList.contains('open'))setTimeout(()=>qbox.focus(),10);};
qbox.addEventListener('blur',()=>{if(!qbox.value.trim())searchwrap.classList.remove('open');});
if(params.get('q')){searchwrap.classList.add('open');qbox.value=params.get('q');}
qbox.addEventListener('input',()=>{const v=qbox.value.trim();if(v)params.set('q',v);else params.delete('q');history.replaceState({},'',location.pathname+qstr());applyGrid();});
syncBar();

// notify when a session newly needs attention (in-app pill always; OS notification if granted + page open)
let prevNeeds=new Set();
function notify(list){
  const cur=new Set(list.filter(s=>s.needs).map(s=>s.id));
  if('Notification' in window && Notification.permission==='granted'){
    for(const s of list) if(s.needs && !prevNeeds.has(s.id)) try{new Notification('Needs you · '+(s.title||s.id),{body:domainOf(s.url),icon:'/icon-192.png',tag:s.id});}catch(_){}
  }
  prevNeeds=cur;
}
// keep the phone awake while watching; re-acquire when returning to the tab
let wl=null;async function lockWake(){try{if('wakeLock' in navigator&&!document.hidden)wl=await navigator.wakeLock.request('screen');}catch(_){}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)lockWake();});
// ask for notification permission + wake lock on the first interaction (browsers require a gesture)
addEventListener('pointerdown',function once(){if('Notification' in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});lockWake();removeEventListener('pointerdown',once);},{once:true});

// pull-to-refresh: PWA standalone kills the native gesture, so own it on the grid — re-poll + reconnect the stream
(function(){
  const ptr=document.getElementById('ptr'); const TH=70; let sy=0,dist=0,pulling=false,refreshing=false;
  const canPull=()=>!refreshing&&window.scrollY<=0&&!focus.classList.contains('on')&&!optmenu.classList.contains('open')&&!document.body.classList.contains('select');
  addEventListener('touchstart',e=>{if(e.touches.length!==1||!canPull()){pulling=false;return;}sy=e.touches[0].clientY;dist=0;pulling=true;ptr.style.transition='none';},{passive:true});
  addEventListener('touchmove',e=>{if(!pulling)return;const dy=e.touches[0].clientY-sy;
    if(dy<=0||window.scrollY>0){pulling=false;ptr.style.transition='';ptr.style.transform='';ptr.style.opacity='';ptr.classList.remove('ready');return;}
    e.preventDefault();dist=Math.min(dy*0.5,108);
    ptr.style.transform='translate(-50%,'+dist+'px)';ptr.style.opacity=Math.min(dist/TH,1);ptr.classList.toggle('ready',dist>=TH);},{passive:false});
  function end(){if(!pulling)return;pulling=false;ptr.style.transition='';if(dist>=TH)doRefresh();else{ptr.style.transform='';ptr.style.opacity='';ptr.classList.remove('ready');}dist=0;}
  addEventListener('touchend',end);addEventListener('touchcancel',end);
  async function doRefresh(){refreshing=true;buzz(15);ptr.classList.remove('ready');ptr.classList.add('spin');
    ptr.style.transform='translate(-50%,'+TH+'px)';ptr.style.opacity='1';
    closeFeed();openFeed();const t0=Date.now();try{await poll();}catch(_){}
    setTimeout(()=>{ptr.classList.remove('spin');ptr.style.transform='';ptr.style.opacity='';refreshing=false;},Math.max(0,520-(Date.now()-t0)));}
})();

render();
openFeed();
lockWake();
poll();setInterval(poll,3000);
</script></body></html>`;

const MANIFEST = JSON.stringify({
  name: 'Agent Browsers', short_name: 'Agents', start_url: '/', scope: '/',
  display: 'standalone', background_color: '#0b0b0b', theme_color: '#0b0b0b', orientation: 'any',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
});
// network pass-through SW (no content caching). Bump SW_VER on releases so the browser detects an update, clears any stale caches, and reloads open clients.
const SW_VER = '2026-06-12b';
const SW = "const V='" + SW_VER + "';self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())await caches.delete(k);await self.clients.claim();for(const c of await self.clients.matchAll())try{c.navigate(c.url);}catch(e){}})()));self.addEventListener('fetch',e=>{});";

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/api/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([...sessions.values()].map(s => ({ id: s.id, port: s.port, title: s.title, url: s.url, tabs: s.tabs || 1, live: !!(s.ws && s.lastFrame), state: stateOf(s), needs: needsAttention(s), lastChangeMs: s.lastPaintAt ? (Date.now() - s.lastPaintAt) : null }))));
  } else if (u === '/api/feed') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('retry: 1000\n\n');
    for (const s of sessions.values()) if (s.lastFrame) res.write(`data: ${s.id}\t${s.lastFrame}\n\n`); // replay current screens
    feedClients.add(res); req.on('close', () => feedClients.delete(res));
  } else if (u.startsWith('/api/hq/')) {
    const slug = decodeURIComponent(u.slice('/api/hq/'.length));
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write('retry: 1000\n\n');
    const h = hqConnect(slug);
    if (h) { if (h.lastFrame) res.write(`data: ${h.lastFrame}\n\n`); h.subs.add(res); req.on('close', () => { h.subs.delete(res); hqMaybeClose(slug); }); }
    else res.end();
  } else if (u === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions: sessions.size, feedClients: feedClients.size, hq: hq.size, slugs: [...sessions.values()].map(s => s.id) }));
  } else if (/^\/s\/\d+$/.test(u)) {                 // port alias -> slug redirect
    const port = parseInt(u.split('/')[2], 10); const s = sessions.get(port);
    res.writeHead(302, { Location: s ? '/' + s.id : '/' }); res.end();
  } else if (u === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' }); res.end(MANIFEST);
  } else if (u === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' }); res.end(SW);
  } else if (u === '/icon-192.png' || u === '/icon-512.png' || u === '/icon-maskable-512.png') {
    try { const b = fs.readFileSync(path.join(__dirname, u)); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' }); res.end(b); }
    catch { res.writeHead(404); res.end(); }
  } else {
    // always revalidate the app shell so a server restart is picked up on the next load (the stream is online-only anyway)
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(GRID); // catch-all: /, /{slug}, /watch/.., /embed/.., /active
  }
});
server.listen(BIND_PORT, BIND_HOST, () => console.log(`[grid] on http://${BIND_HOST}:${BIND_PORT}  (tile ${TILE.maxWidth}q${TILE.quality}, hq ${HQ.maxWidth}q${HQ.quality})`));
