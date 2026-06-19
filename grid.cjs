// grid.cjs — BUILT ARTIFACT. Do not edit by hand.
// Source: grid.src.cjs + src/*.cjs. Regenerate with: node build.cjs
// Single self-contained file, zero external dependencies.

const __mod_state = (() => { const module = { exports: {} }; const exports = module.exports;
// src/state.cjs — pure session-state classification (NO side effects, requireable by tests).
// Bundled back into the single-file grid.cjs by the build step; at runtime it carries zero external deps.
//
// active  = a navigation/load happened OR the page painted within ACTIVE_MS (it's doing something)
// stuck   = a top-frame navigation started and never finished for >HANG_MS (genuinely hung) — a STILL page is idle, never stuck
// idle    = loaded + quiet (the normal resting state; not an alert)

const ACTIVE_MS = +(process.env.ACTIVE_MS || 4000);  // paint OR navigation within this window => "active"
const HANG_MS   = +(process.env.STUCK_MS  || 25000); // a navigation still loading this long with no load event => "stuck"

// classify a session. `now` is injectable so tests are deterministic (defaults to wall clock at call time).
function stateOf(s, now) {
  if (now === undefined) now = Date.now();
  if (!s || !s.ws || !s.lastFrame) return 'idle';                       // not connected / nothing seen yet
  if (s.loadingSince && now - s.loadingSince > HANG_MS) return 'stuck'; // top-frame navigation that never completed
  if (now - (s.lastActivityAt || 0) < ACTIVE_MS) return 'active';      // recent paint or navigation
  return 'idle';
}

// needs you = a hung page, or a URL/title that looks like it wants a human (login / captcha / 2FA / auth / consent)
const NEEDS_RE = /login|sign[-_ ]?in|signin|log[-_ ]?in|password|captcha|recaptcha|challenge|verif|two[-_ ]?factor|2fa|one[-_ ]?time[-_ ]?code|\botp\b|accounts\.google|\/oauth|\/auth\b|authorize|consent|are you (a )?human/i;

function needsAttention(s, now) {
  return stateOf(s, now) === 'stuck' || NEEDS_RE.test((((s && s.url) || '') + ' ' + ((s && s.title) || '')));
}

module.exports = { ACTIVE_MS, HANG_MS, NEEDS_RE, stateOf, needsAttention };

return module.exports; })();

const __mod_slug = (() => { const module = { exports: {} }; const exports = module.exports;
// src/slug.cjs — pure slug + port-parse helpers (NO side effects, requireable by tests).
// Bundled inline into grid.cjs by the build step. Stateful helpers (uniqueSlug, sessionBySlug)
// stay in grid.src.cjs because they read the live sessions Map.

// stable, human-readable identity from arbitrary text
function slugify(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

// multi-label public suffixes where the meaningful name is the label *before* the suffix
const PSL2 = ['pages.dev', 'github.io', 'vercel.app', 'netlify.app', 'web.app', 'workers.dev', 'herokuapp.com', 'onrender.com', 'fly.dev', 'ngrok.io', 'ngrok-free.app'];

// derive a slug from a page's URL (preferred) or title; '' when neither yields anything usable
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

// parse a whitespace-separated list of numeric ports into a deduped number[]
const parsePorts = (out) => [...new Set((out || '').split(/\s+/).filter(x => /^\d+$/.test(x)).map(Number))];

module.exports = { slugify, PSL2, deriveSlug, parsePorts };

return module.exports; })();

const __mod_cdp = (() => { const module = { exports: {} }; const exports = module.exports;
// src/cdp.cjs — pure reducer for tile-session CDP messages (NO side effects, requireable by tests).
// Mutates the session-state object `s` and RETURNS a list of side-effect actions for the caller to perform,
// so the socket handler stays a thin, fully-guarded shell. Bundled inline into grid.cjs by the build step.
//
// Returned actions (each at most once per message):
//   { ack: <sessionId> }   → caller sends Page.screencastFrameAck
//   { forward: <data> }    → caller pushes the JPEG to the multiplexed feed
//
// Every property access is guarded so a malformed/partial frame can never throw out of the hot loop.
function reduceTileMessage(s, m, now, rateMs) {
  const acts = [];
  if (!m || typeof m !== 'object') return acts;
  const p = m.params || {};

  if (m.method === 'Page.screencastFrame') {
    acts.push({ ack: p.sessionId });                              // always ack so frames keep flowing
    if (typeof p.data === 'string') {
      s.frames = (s.frames || 0) + 1; s.lastFrame = p.data; s.lastPaintAt = now; s.lastActivityAt = now; // a real paint = visible activity
      if (now - (s.lastSentAt || 0) >= rateMs) { s.lastSentAt = now; acts.push({ forward: p.data }); }   // per-tile rate-cap
    }
  } else if (m.method === 'Page.frameStartedLoading') {
    s.lastActivityAt = now; if (!s.mainFrame || p.frameId === s.mainFrame) { if (!s.loadingSince) s.loadingSince = now; }
  } else if (m.method === 'Page.frameStoppedLoading') {
    s.lastActivityAt = now; if (!s.mainFrame || p.frameId === s.mainFrame) s.loadingSince = 0;
  } else if (m.method === 'Page.loadEventFired' || m.method === 'Page.domContentEventFired') {
    s.lastActivityAt = now; s.loadingSince = 0;
  } else if (m.method === 'Page.frameNavigated' && p.frame && !p.frame.parentId) {
    s.mainFrame = p.frame.id; s.lastActivityAt = now;
  } else if (m.id !== undefined && m.result && typeof m.result.data === 'string') {
    // captureScreenshot seed — re-seeds a non-painting tile; deliberately does NOT touch lastPaintAt/lastActivityAt
    s.lastFrame = m.result.data; s.lastSentAt = now; acts.push({ forward: m.result.data });
  } else if (m.result && m.result.frameTree && m.result.frameTree.frame) {
    s.mainFrame = m.result.frameTree.frame.id;                    // learn the top frame (ignore subframe loads)
  } else if (m.result && m.result.result && typeof m.result.result.value === 'string') {
    // Runtime.evaluate(document.readyState) — catches a page already hung-loading when we attached
    if (m.result.result.value !== 'complete') { if (!s.loadingSince) s.loadingSince = now; } else s.loadingSince = 0;
  }
  return acts;
}

module.exports = { reduceTileMessage };

return module.exports; })();

const __mod_security = (() => { const module = { exports: {} }; const exports = module.exports;
// src/security.cjs — pure same-origin / CSRF guard (NO side effects, requireable by tests).
// Bundled inline into grid.cjs by the build step.
//
// THREAT: a malicious web page open *inside a watched browser* scripts fetch() at the dashboard's
// control endpoints (/api/input, /api/kill). A browser always attaches the page's real Origin to a
// cross-origin request, so we allow only origins on the trusted local/tailnet surface and reject the
// rest. A request with NO Origin header is a non-browser client (curl/native) — not the drive-by
// threat — and is allowed; set TOKEN to gate those too.
function isLocalOrigin(origin) {
  if (!origin) return true;                                              // non-browser client (no Origin) — gate with TOKEN if needed
  let h; try { h = new URL(origin).hostname; } catch { return false; }   // unparseable Origin → reject
  h = h.replace(/^\[|\]$/g, '');                                         // URL.hostname wraps IPv6 in [] — strip for comparison
  if (h === '127.0.0.1' || h === 'localhost' || h === '::1') return true;
  if (/\.ts\.net$/i.test(h)) return true;                                // tailscale serve hostnames
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;   // tailscale CGNAT 100.64.0.0/10
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true; // private LAN (RFC 1918)
  return false;                                                          // any public origin → reject
}

// security headers applied to every response: block MIME-sniffing and keep the dashboard URL
// (which may carry ?token=) out of Referer headers when a watched-page navigation occurs.
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

module.exports = { isLocalOrigin, SECURITY_HEADERS };

return module.exports; })();

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
const TOKEN = process.env.TOKEN || '';            // optional shared secret: when set, the dashboard + control require it
const TILE = { format: 'jpeg', quality: +(process.env.TILE_Q || 55), maxWidth: +(process.env.TILE_W || 800),  maxHeight: +(process.env.TILE_H || 500),  everyNthFrame: 1 }; // cheap tile frames
const HQ   = { format: 'jpeg', quality: +(process.env.HQ_Q   || 82), maxWidth: +(process.env.HQ_W   || 1920), maxHeight: +(process.env.HQ_H   || 1200), everyNthFrame: 1 }; // crisp focus frames
const FLOOR_MS = 700;                         // ~1.4 fps floor so streams never go blank
const TILE_MIN_MS = +(process.env.TILE_MIN_MS || 80);  // per-tile push rate-cap (~12.5 fps/tile). CDP emits ~120fps/tile; forwarding every frame floods a phone link. Keep the freshest frame in lastFrame, forward at most one per window — ~10x bandwidth cut, no perceptible thumbnail loss.
// session-state classification lives in src/state.cjs (pure + unit-tested); bundled inline by the build step.
const { ACTIVE_MS, HANG_MS, NEEDS_RE, stateOf, needsAttention } = __mod_state;

const sessions = new Map(); // port -> { port, id, title, url, wsUrl, ws, lastFrame, lastSentAt, lastPaintAt, frames, tabs }
const hq = new Map();       // slug -> { ws, lastFrame, lastSentAt, lastPaintAt, subs:Set, capT } — on-demand high-res focus
const feedClients = new Set(); // res objects subscribed to the one multiplexed tile feed

// ---- slugs (stable, human-readable identity) -------------------------------
// pure helpers (slugify / deriveSlug / parsePorts) live in src/slug.cjs (unit-tested); bundled inline by the build step
const { slugify, deriveSlug, parsePorts } = __mod_slug;
// pure CDP tile-message reducer (unit-tested) — keeps the hot loop a thin guarded shell
const { reduceTileMessage } = __mod_cdp;
function uniqueSlug(base, selfPort) {
  const used = new Set([...sessions.values()].filter(s => s.port !== selfPort).map(s => s.id).filter(Boolean));
  if (!base) { let n = 1; while (used.has('session-' + n)) n++; return 'session-' + n; }
  if (!used.has(base)) return base;
  let n = 2; while (used.has(base + '-' + n)) n++; return base + '-' + n;
}
function sessionBySlug(slug) { for (const s of sessions.values()) if (s.id === slug) return s; return null; }

// ---- discovery: Chromium loopback debug ports -------------------------------
// Manual override `PORTS=9222,9223` works on every OS. Otherwise auto-detect: PowerShell
// on Windows, lsof on macOS/Linux. bestTarget() probes /json, so any non-CDP port is ignored.
// parsePorts imported from ./src/slug.cjs above
function discoverPorts() {
  if (process.env.PORTS) return Promise.resolve(parsePorts(process.env.PORTS.replace(/,/g, ' ')));
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const ps = "$pids=(Get-Process chrome,chromium,msedge,brave,vivaldi,thorium -EA SilentlyContinue).Id; Get-NetTCPConnection -State Listen -EA SilentlyContinue | ?{ $_.OwningProcess -in $pids -and $_.LocalAddress -eq '127.0.0.1' } | Select -Expand LocalPort -Unique";
      // resolve(null) on a FAILED sweep (timeout/crash) so refresh() can tell "discovery failed" from "no browsers" and not wipe every tile
      execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000 }, (e, out) => resolve(e ? null : parsePorts(out)));
    } else {
      // macOS / Linux: loopback LISTEN ports owned by a Chromium-family process (+c 0 keeps full command names)
      const names = 'chrome|chromium|brave|msedge|edge|vivaldi|thorium';
      const byName = `lsof +c 0 -nP -iTCP@127.0.0.1 -sTCP:LISTEN 2>/dev/null | grep -iE '${names}' | grep -oE '127\\.0\\.0\\.1:[0-9]+' | grep -oE '[0-9]+$' | sort -u`;
      execFile('bash', ['-lc', byName], { timeout: 8000 }, (e, out) => {
        const ports = parsePorts(out);
        if (ports.length) return resolve(ports);
        // fallback: every loopback LISTEN port; bestTarget() filters out non-CDP services
        const any = `lsof +c 0 -nP -iTCP@127.0.0.1 -sTCP:LISTEN 2>/dev/null | grep -oE '127\\.0\\.0\\.1:[0-9]+' | grep -oE '[0-9]+$' | sort -u`;
        execFile('bash', ['-lc', any], { timeout: 8000 }, (e2, out2) => resolve(parsePorts(out2)));
      });
    }
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
let refreshing = false;
async function refresh() {
  if (refreshing) return;                 // never let a slow sweep overlap the next tick (was spawning piled-up PowerShells)
  refreshing = true;
  try {
    const ports = await discoverPorts();
    if (!ports) return;                    // discovery FAILED this sweep — keep every existing tile, try again next tick
    for (const port of ports) {
      const tgt = await bestTarget(port);
      if (!tgt.best) continue;
      let s = sessions.get(port);
      if (!s) {
        s = { port, id: null, title: tgt.best.title, url: tgt.best.url, tabs: tgt.tabs, wsUrl: tgt.best.webSocketDebuggerUrl, ws: null, lastFrame: null, lastSentAt: 0, lastPaintAt: 0, lastActivityAt: Date.now(), loadingSince: 0, mainFrame: null, frames: 0, miss: 0 };
        s.id = uniqueSlug(deriveSlug(s.url, s.title), port);
        sessions.set(port, s); connect(s);
      } else {
        s.title = tgt.best.title; s.url = tgt.best.url; s.tabs = tgt.tabs;
        // one-time upgrade: a generic session-N slug that now has a real domain earns a real name
        if (/^session-\d+$/.test(s.id)) { const better = deriveSlug(s.url, s.title); if (better) s.id = uniqueSlug(better, port); }
        if (s.wsUrl !== tgt.best.webSocketDebuggerUrl) { s.wsUrl = tgt.best.webSocketDebuggerUrl; try { s.ws && s.ws.close(); } catch {} connect(s); }
        else if (!s.ws) connect(s);   // CDP socket dropped on a still-alive page → reconnect so the tile doesn't freeze forever
      }
    }
    // prune is DEBOUNCED: a port must be absent for 2 consecutive good sweeps (~10s) before its tile is removed,
    // so a single partial sweep can't blank the wall
    for (const [port, s] of sessions) {
      if (ports.includes(port)) { s.miss = 0; }
      else if ((s.miss = (s.miss || 0) + 1) >= 2) { try { s.ws && s.ws.close(); } catch {} sessions.delete(port); }
    }
  } finally { refreshing = false; }
}

// ---- per-session tile screencast -> multiplexed feed ------------------------
function feedSend(id, data) { const pl = `data: ${id}\t${data}\n\n`; for (const c of feedClients) { try { c.write(pl); } catch {} } }
function connect(s) {
  try {
    const ws = new WebSocket(s.wsUrl); s.ws = ws; let id = 0;
    const send = (m, p = {}) => { try { ws.send(JSON.stringify({ id: ++id, method: m, params: p })); } catch {} };
    s.send = send;   // exposed so the idle-recapture sweep can re-seed a stalled/blank tile
    // focus-emulation + active lifecycle keep rAF/animations running even though these windows are backgrounded/occluded
    // (Chrome throttles rendering of unfocused tabs → animated pages would otherwise look frozen in the stream)
    // captureScreenshot seed: a static / just-opened page emits NO screencast frames, so without a seed the tile is blank until something moves
    ws.onopen = () => { send('Page.enable'); send('Page.getFrameTree'); send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }); send('Emulation.setFocusEmulationEnabled', { enabled: true }); send('Page.setWebLifecycleState', { state: 'active' }); send('Page.startScreencast', TILE); send('Page.captureScreenshot', { format: 'jpeg', quality: TILE.quality }); s.lastActivityAt = Date.now(); };
    // hot loop: fully guarded. reduceTileMessage (src/cdp.cjs, unit-tested) mutates s + returns side-effect actions;
    // a malformed/partial CDP frame can never throw out of this handler.
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      let acts; try { acts = reduceTileMessage(s, m, Date.now(), TILE_MIN_MS); } catch { return; }
      for (const a of acts) {
        if ('ack' in a) send('Page.screencastFrameAck', { sessionId: a.ack });
        else if ('forward' in a) feedSend(s.id, a.forward);
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
  h = { ws: null, lastFrame: null, lastSentAt: 0, lastPaintAt: 0, subs: new Set(), capT: null, send: null, vw: 0, vh: 0, lmId: 0 }; hq.set(slug, h);
  const push = (data) => { h.lastFrame = data; h.lastSentAt = Date.now(); const pl = `data: ${data}\n\n`; for (const c of h.subs) { try { c.write(pl); } catch {} } };
  try {
    const ws = new WebSocket(s.wsUrl); h.ws = ws; let id = 0;
    const send = (m, p = {}) => { const i = ++id; try { ws.send(JSON.stringify({ id: i, method: m, params: p })); } catch {} return i; };
    h.send = send;                                   // exposed so /api/input can dispatch on this focus socket
    ws.onopen = () => { send('Page.enable'); send('Emulation.setFocusEmulationEnabled', { enabled: true }); send('Page.setWebLifecycleState', { state: 'active' }); send('Page.startScreencast', HQ); send('Page.captureScreenshot', { format: 'jpeg', quality: HQ.quality }); h.lmId = send('Page.getLayoutMetrics'); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      try {
        const p = m.params || {};
        if (m.method === 'Page.screencastFrame') {
          send('Page.screencastFrameAck', { sessionId: p.sessionId });
          const md = p.metadata; if (md) { if (md.deviceWidth) h.vw = md.deviceWidth; if (md.deviceHeight) h.vh = md.deviceHeight; } // viewport CSS px → click mapping
          h.lastPaintAt = Date.now(); if (typeof p.data === 'string') push(p.data);
        }
        else if (m.id === h.lmId && m.result && m.result.cssLayoutViewport) { const lv = m.result.cssLayoutViewport; if (!h.vw) h.vw = lv.clientWidth; if (!h.vh) h.vh = lv.clientHeight; } // fallback viewport size for a static page
        else if (m.id !== undefined && m.result && typeof m.result.data === 'string') { push(m.result.data); } // captureScreenshot seed/refresh
      } catch { /* a malformed focus-stream frame must never throw out of the hot loop */ }
    };
    ws.onclose = () => { h.ws = null; };
    ws.onerror = () => {};
    h.capT = setInterval(() => { if (h.subs.size && h.ws && Date.now() - h.lastPaintAt > 1000) send('Page.captureScreenshot', { format: 'jpeg', quality: HQ.quality }); }, 1200);
  } catch {}
  return h;
}
function hqMaybeClose(slug) { const h = hq.get(slug); if (h && h.subs.size === 0) { clearInterval(h.capT); try { h.ws && h.ws.close(); } catch {} hq.delete(slug); } }

// ---- input back-channel (Path A: light click/type into the FOCUSED session) -
// Coordinates arrive as 0..1 fractions of the page content; we scale by the real
// viewport CSS size captured above. Only the on-demand focus session is driveable.
const KEYMAP = {
  Enter:     { vk: 13, key: 'Enter',     code: 'Enter',     text: '\r' },
  Backspace: { vk: 8,  key: 'Backspace', code: 'Backspace' },
  Tab:       { vk: 9,  key: 'Tab',       code: 'Tab' },
};
function dispatchInput(j) {
  const h = hq.get(j && j.slug); if (!h || !h.send || !h.ws) return false;
  const vw = h.vw || HQ.maxWidth, vh = h.vh || HQ.maxHeight;
  const X = Math.round(Math.max(0, Math.min(1, +j.xf || 0)) * vw);
  const Y = Math.round(Math.max(0, Math.min(1, +j.yf || 0)) * vh);
  if (j.kind === 'click') {
    h.send('Input.dispatchMouseEvent', { type: 'mouseMoved',    x: X, y: Y, button: 'none' });
    h.send('Input.dispatchMouseEvent', { type: 'mousePressed',  x: X, y: Y, button: 'left', buttons: 1, clickCount: 1 });
    h.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: X, y: Y, button: 'left', buttons: 0, clickCount: 1 });
  } else if (j.kind === 'wheel') {
    const dX = Math.round((+j.dxf || 0) * vw + (+j.dx || 0));   // client sends fractions of the viewport (dxf/dyf); accept raw px too
    const dY = Math.round((+j.dyf || 0) * vh + (+j.dy || 0));
    h.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: X, y: Y, deltaX: dX, deltaY: dY });
  } else if (j.kind === 'text') {
    if (typeof j.text === 'string' && j.text) h.send('Input.insertText', { text: j.text });
    else return false;
  } else if (j.kind === 'key') {
    const K = KEYMAP[j.key]; if (!K) return false;
    const t = K.text ? 'keyDown' : 'rawKeyDown';
    h.send('Input.dispatchKeyEvent', { type: t, windowsVirtualKeyCode: K.vk, nativeVirtualKeyCode: K.vk, key: K.key, code: K.code, ...(K.text ? { text: K.text } : {}) });
    h.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: K.vk, nativeVirtualKeyCode: K.vk, key: K.key, code: K.code });
  } else return false;
  return true;
}

// ---- fps floor: re-send last frame to keep streams warm when idle ----------
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) { if (s.lastFrame && feedClients.size && now - s.lastSentAt >= FLOOR_MS) { s.lastSentAt = now; feedSend(s.id, s.lastFrame); } }
  for (const h of hq.values()) { if (h.lastFrame && h.subs.size && now - h.lastSentAt >= FLOOR_MS) { h.lastSentAt = now; const pl = `data: ${h.lastFrame}\n\n`; for (const c of h.subs) { try { c.write(pl); } catch {} } } }
}, FLOOR_MS);
// ---- idle re-capture: any tile that stopped painting (static page, post-navigation, stalled screencast) gets a fresh
//      screenshot so it never blanks or freezes — mirrors the focus stream's capT. Only runs while someone is watching.
setInterval(() => {
  if (!feedClients.size) return;
  const now = Date.now();
  for (const s of sessions.values()) { if (s.ws && s.send && now - s.lastPaintAt > 1200) s.send('Page.captureScreenshot', { format: 'jpeg', quality: TILE.quality }); }
}, 1300);
refresh(); setInterval(refresh, 5000);

// ---- session state — classify on real activity, NOT pixel-motion ----------
// active  = a navigation/load happened OR the page painted within ACTIVE_MS (it's doing something)
// stuck   = a navigation started and never finished for >HANG_MS (genuinely hung) — a STILL page is idle, never stuck
// idle    = loaded + quiet (the normal resting state; not an alert)
// stateOf / needsAttention / NEEDS_RE imported from ./src/state.cjs above (pure + unit-tested)
// close (kill) a watched session: Page.close over its own CDP socket, plus the documented HTTP close as a fallback
function killSession(slug) {
  const s = sessionBySlug(slug);
  if (!s) return false;
  try { if (s.ws && s.send) s.send('Page.close'); } catch {}
  try { const tid = ((s.wsUrl || '').match(/\/devtools\/page\/([^/?]+)/) || [])[1]; if (tid) fetch(`http://127.0.0.1:${s.port}/json/close/${tid}`).catch(() => {}); } catch {}
  try { s.ws && s.ws.close(); } catch {}
  sessions.delete(s.port);   // drop the tile now so it vanishes on the next poll; refresh() re-adds one only if that port still has another page
  return true;
}

const MARK = '<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="9" height="9" rx="2.2" fill="#3ecf8e"/><rect x="13" y="2" width="9" height="9" rx="2.2" fill="#3a3a40"/><rect x="2" y="13" width="9" height="9" rx="2.2" fill="#3a3a40"/><rect x="13" y="13" width="9" height="9" rx="2.2" fill="#3a3a40"/></svg>';
const ICO1 = '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2.2"/></svg>';
const ICO2 = '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="8" height="14" rx="1.8"/><rect x="13" y="5" width="8" height="14" rx="1.8"/></svg>';
const ICO3 = '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="5.3" height="14" rx="1.5"/><rect x="9.35" y="5" width="5.3" height="14" rx="1.5"/><rect x="16.2" y="5" width="5.3" height="14" rx="1.5"/></svg>';
const ICOTAB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="13" height="13" rx="2"/><path d="M8 19h9a2 2 0 0 0 2-2V8"/></svg>';
const ICOLINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';
const ICODL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'; // camera (Save frame) — was a download arrow
const ICOFIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>'; // image icon (Cover images) — was corners, clashed with Fullscreen
const ICOSEL = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/></svg>';
const ICOZAP = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>';
const ICOSRCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>';
const ICOSLID = '<svg viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>';
const ICOFUN = '<svg viewBox="0 0 24 24"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg>';
const ICOROT = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M16.48 2.52c3.27 1.55 5.61 4.72 5.97 8.48h1.5C23.44 4.84 18.29 0 12 0l-.66.03 3.81 3.81 1.33-1.32zM10.23 1.75c-.59-.59-1.54-.59-2.12 0L1.75 8.11c-.59.59-.59 1.54 0 2.12l12.02 12.02c.59.59 1.54.59 2.12 0l6.36-6.36c.59-.59.59-1.54 0-2.12L10.23 1.75zm4.6 19.44L2.81 9.17l6.36-6.36 12.02 12.02-6.36 6.36zM7.52 21.48C4.25 19.94 1.91 16.76 1.55 13H.05C.56 19.16 5.71 24 12 24l.66-.03-3.81-3.81-1.33 1.32z"/></svg>'; // screen-rotation (not the old refresh-looking arrows)
const ICOSTAR = '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18l-5.8 3 1.1-6.5L2.6 9.9l6.5-.9z"/></svg>';
const ICOPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICOMOVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>';
const ICODOTS = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
const ICOCURSOR = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M5 2.5l14.5 8.2-6.1 1.2-1 .2-.5.9-2.9 5.6z"/></svg>'; // arrow cursor — "take control"
const ICOTOUCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 11V8.5a1.5 1.5 0 0 1 3 0V11"/><path d="M15 11.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a7 7 0 0 1-5.3-2.4L4 14.5s1.2-1.2 2.6-.2L8 15.3V9.5a1.5 1.5 0 0 1 3 0V11"/></svg>'; // finger-tap — direct-touch pointer mode
const ICOKEYB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>';
const ICOEXP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ICORELOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>';
const ICOBELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const ICOTRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></svg>';
const ICOCHK = '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>';
const ICOPOWER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>'; // power — close/kill a session
const BUILD = '2026-06-19-kill';                                  // single source of truth for the build id (shown in UI + used as the SW version) — bump to invalidate the SW cache on each release

const GRID = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0b0b0b">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Agents">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="icon" href="/icon-192.png">
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').then(reg=>{reg.update();setInterval(()=>reg.update(),60000);reg.addEventListener('updatefound',()=>{const w=reg.installing;w&&w.addEventListener('statechange',()=>{if(w.state==='activated')location.reload();});});}).catch(()=>{});let _r=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!_r){_r=true;location.reload();}});}</script>
<title>Agent Browsers</title>
<style>
:root{color-scheme:dark;--bg:#0b0b0d;--panel:#141417;--line:#26262c;--line2:#34343c;--muted:#8a8a93;--live:#3ecf8e;--amber:#e0a44e;--gold:#e8c66a}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:#e6e6ea;font:14px system-ui,Segoe UI,Roboto,sans-serif;height:100%;-webkit-font-smoothing:antialiased;overscroll-behavior:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
/* custom touch gestures own the long-press/drag — re-enable native text behavior only where typing happens */
input,textarea,[contenteditable="true"]{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}
::selection{background:#3ecf8e55}
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
#filterbtn.act{background:#3ecf8e22;border-color:#3ecf8e66;color:#7ee08a}
.fbadge{display:none;position:absolute;top:-7px;right:-7px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:var(--amber);color:#1a1205;font-size:11px;font-weight:800;align-items:center;justify-content:center;border:2px solid #121215;font-variant-numeric:tabular-nums}
.fbadge.on{display:flex}
.dot{width:8px;height:8px;border-radius:50%;background:#555;flex:0 0 auto}
.dot.live{background:var(--live);box-shadow:0 0 7px #3ecf8eaa;animation:pulse 1.9s ease-in-out infinite}
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
.seg .chip.need.on{background:#e0a44e;color:#241400}
#tools button{width:32px;padding:0}
#optmenu{position:absolute;right:12px;top:calc(100% + 4px);min-width:208px;background:#16161a;border:1px solid var(--line2);border-radius:13px;padding:6px;box-shadow:0 16px 40px #000c;display:none;z-index:60}
#optmenu.open{display:block}
.sheetgrip{display:none}
#scrim{position:fixed;inset:0;background:transparent;opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:55}
.msec{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);padding:8px 11px 4px;font-weight:700}
.mrow{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:9px;color:#dcdce2;font-size:13px;font-weight:550;cursor:pointer;white-space:nowrap}
.mrow:hover{background:#1f1f25}
.mrow svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}
.mrow .ck{margin-left:auto;width:16px;height:16px;opacity:0}
.mrow.on .ck{opacity:1;stroke:var(--live)}
/* boolean on/off switch — always visible so OFF is a state you can see, not a blank row */
.swt{margin-left:auto;flex:0 0 auto;width:40px;height:23px;border-radius:999px;background:#33333b;position:relative;transition:background .18s}
.swt::after{content:"";position:absolute;top:2.5px;left:2.5px;width:18px;height:18px;border-radius:50%;background:#8a8a93;transition:transform .18s,background .18s}
.mrow.on .swt{background:var(--live)}
.mrow.on .swt::after{transform:translateX(17px);background:#06210d}
.mrow.on{color:var(--live);font-weight:650}  /* selected sort / active toggle row reads green + bold, not a faint check */
.msep{height:1px;background:var(--line);margin:5px 8px}
.mrow.danger{color:#e3786f}      /* destructive action (Clear saved data) reads as a caution */
#buildtag{padding:7px 11px 3px;font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--muted);text-align:center;letter-spacing:.02em}
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
.showseg button.need.on{background:#e0a44e;border-color:#e0a44e;color:#241400}
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
/* connection-state strip: slides down over the top when the live feed drops */
#netbanner{position:fixed;top:0;left:0;right:0;z-index:70;display:flex;align-items:center;justify-content:center;gap:8px;padding:calc(7px + env(safe-area-inset-top)) 12px 7px;background:#e0a44e;color:#241400;font-size:12.5px;font-weight:700;letter-spacing:.01em;transform:translateY(-115%);transition:transform .24s ease;pointer-events:none}
#netbanner.show{transform:none}
.nspin{width:13px;height:13px;border:2px solid #2414003d;border-top-color:#241400;border-radius:50%;animation:nspin .7s linear infinite}
@keyframes nspin{to{transform:rotate(360deg)}}
/* custom pull-to-refresh (PWA standalone suppresses the native gesture) */
#ptr{position:fixed;top:calc(env(safe-area-inset-top) - 6px);left:50%;transform:translate(-50%,0);z-index:40;width:38px;height:38px;border-radius:50%;background:#1c1c20;border:1px solid var(--line2);box-shadow:0 4px 16px #000a;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:transform .18s ease,opacity .15s}
#ptr svg{width:20px;height:20px;fill:none;stroke:var(--muted);stroke-width:2.4;stroke-linecap:round}
#ptr.ready svg{stroke:var(--live)}
#ptr.spin svg{stroke:var(--live);animation:ptrspin .7s linear infinite}
@keyframes ptrspin{to{transform:rotate(360deg)}}
.tile{position:relative;background:#000;border:1px solid var(--line);border-radius:13px;overflow:hidden;aspect-ratio:16/10;cursor:pointer;transition:border-color .15s,transform .15s,box-shadow .15s}
@media(hover:hover){.tile:hover{border-color:var(--line2);transform:translateY(-2px);box-shadow:0 8px 24px #0009}}
.tile img{width:100%;height:100%;object-fit:contain;display:block;background:#000;opacity:0;transition:opacity .35s;-webkit-user-drag:none;user-select:none;pointer-events:none}
.tile.ready img{opacity:1}
body.fit-cover .tile img,body.fit-cover #fimg{object-fit:cover}
/* hold-to-reorder: lifted tile follows the finger; others dim; page scroll locked during the drag */
body.dragging{touch-action:none}
body.dragging #grid .tile:not(.drag):not(.ph){opacity:.55}         /* displaced tiles keep their transition so the FLIP slide animates */
.tile.drag{position:fixed;margin:0;opacity:.96;transform:scale(1.03);box-shadow:0 18px 44px #000e;z-index:60;border-color:var(--live)!important;transition:none;will-change:left,top}
.tile.ph{background:#3ecf8e12;border:2px dashed var(--live);box-shadow:none}   /* the gap that opens where the tile will drop */
.tile.ph>*{display:none}
/* reorder mode: tiles own the touch from the start (touch-action:none) so a drag never fights page-scroll; tap-to-open is disabled */
body.reorder #grid .tile{touch-action:none;outline:2px dashed #ffffff3a;outline-offset:-3px;cursor:grab}
body.reorder .tile .pin{display:none}
#donebar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom));z-index:58;display:none}
body.reorder #donebar{display:block}
#donebtn{background:var(--live);color:#06140b;font-weight:700;border:none;border-radius:999px;padding:13px 30px;font-size:15px;box-shadow:0 12px 34px #000b;cursor:pointer}
#donebtn:active{transform:scale(.96)}
/* one-time first-run tip */
#hint{position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:56;display:none;align-items:center;gap:12px;padding:13px 14px;border-radius:14px;background:rgba(28,28,32,.95);backdrop-filter:blur(10px);border:1px solid var(--line2);box-shadow:0 12px 36px #000b}
#hint.show{display:flex}
#hint span{flex:1;font-size:12.8px;line-height:1.45;color:#cfcfd6}
#hintok{flex:0 0 auto;border:none;border-radius:9px;background:var(--live);color:#06210d;font-size:13px;font-weight:700;padding:12px 18px;cursor:pointer}
#hintok:active{transform:scale(.96)}
.tile .sk{position:absolute;inset:0;background:linear-gradient(100deg,#161619 30%,#202026 50%,#161619 70%);background-size:220% 100%;animation:shim 1.25s linear infinite}
@keyframes shim{0%{background-position:120% 0}100%{background-position:-120% 0}}
.tile.ready .sk{display:none}
.tile .badge{position:absolute;top:9px;left:9px;display:inline-flex;gap:5px;align-items:center;padding:3px 8px;border-radius:999px;background:#0b0b0dcc;backdrop-filter:blur(6px);border:1px solid #ffffff14;font-size:10px;font-weight:600;letter-spacing:.05em;color:var(--live)}
.tile .badge i{width:6px;height:6px;border-radius:50%;background:var(--live);box-shadow:0 0 6px #3ecf8e;animation:pulse 1.9s ease-in-out infinite}
.tile.state-idle .badge{color:#9aa0a6}.tile.state-idle .badge i{background:#9aa0a6;box-shadow:none;animation:none}
.tile.state-stuck .badge{color:#e0a44e}.tile.state-stuck .badge i{background:#e0a44e;box-shadow:0 0 6px #e0a44e}
.tile.needs{border-color:#e0a44e!important;box-shadow:0 0 0 1px #e0a44e, 0 0 18px #e0a44e3a}
#needs{display:none;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;background:#e0a44e1f;border:1px solid #e0a44e66;color:#f0b860;font-size:12.5px;font-weight:650;cursor:pointer;text-decoration:none}
#needs.on{display:inline-flex}
#needs i{width:7px;height:7px;border-radius:50%;background:#e0a44e;box-shadow:0 0 7px #e0a44e;animation:pulse 1.6s ease-in-out infinite}
.tile .tabs{position:absolute;top:9px;right:44px;display:none;gap:5px;align-items:center;padding:3px 8px 3px 7px;border-radius:999px;background:#000a;font-size:11.5px;font-weight:650;color:#d4d4da;font-variant-numeric:tabular-nums}
.tile.multi .tabs{display:inline-flex}
.tile .tabs svg{width:13px;height:13px;flex:0 0 auto;opacity:.85}
/* pin / favorite: a subtle star top-right; gold when pinned; pinned tiles float to the top */
.pin{position:absolute;top:8px;right:8px;width:30px;height:30px;border:none;border-radius:8px;background:#0007;color:#fff;opacity:0;pointer-events:none;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:4;padding:0;transition:opacity .15s,color .15s}
.pin svg{width:15px;height:15px;fill:currentColor;stroke:none}
@media(hover:hover){.tile:hover .pin{opacity:.8;pointer-events:auto}}
.tile.pinned .pin{opacity:1;pointer-events:auto;color:#e8c66a}
body.select .pin,body.dragging .pin{display:none}
.tile .lbl{position:absolute;left:0;right:0;bottom:0;padding:9px 11px 10px;background:linear-gradient(transparent,#000 92%);display:flex;flex-direction:column;gap:1px}
.tile .t{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .d{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:#9a9aa3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#empty{display:none;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;color:var(--muted);min-height:62vh;padding:40px 24px}
#empty.on{display:flex}
#empty .mark{width:54px;height:54px;opacity:.5}
#empty h2{margin:0 0 8px;font-size:17px;color:#cfcfd6;font-weight:650}
#empty p{margin:0;max-width:360px;line-height:1.5;font-size:13px}
#empty code.ecmd{display:inline-block;font:13px/1.4 ui-monospace,Menlo,Consolas,monospace;background:#0c0c0f;border:1px solid var(--line2);color:#cdd6e6;padding:9px 14px;border-radius:9px;user-select:all;-webkit-user-select:all;word-break:break-all;max-width:360px}
#empty .esub{font-size:12px;color:var(--muted);opacity:.82;max-width:360px}
#empty .emsg-off{display:none}
body.offline #empty .emsg{display:none}
body.offline #empty .emsg-off{display:block}
#focus{position:fixed;inset:0;background:#000;display:none;z-index:50}
#focus.on{display:block}
#fimg{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;touch-action:none;transform-origin:0 0;-webkit-user-drag:none;-webkit-touch-callout:none;user-select:none}
/* fill-the-glass: rotate the view 90° (element takes swapped dims; applyZoom adds the rotate transform) */
#focus.rot #fimg{inset:auto;top:50%;left:50%;width:100vh;height:100vw;transform-origin:center}
.fbtn.on{color:var(--live);background:#3ecf8e26;box-shadow:inset 0 0 0 1px #3ecf8e66}
/* Path A: take-control mode — tap=click, drag=scroll, Type pill summons the keyboard */
/* dock the page BETWEEN the bars while controlling so the chrome never covers the page top/bottom (insets measured live into --ctop/--cbot) */
#focus.ctl #fimg{cursor:crosshair;top:var(--ctop,58px);bottom:auto;height:calc(100% - var(--ctop,58px) - var(--cbot,84px))}  /* <img> is replaced: top+bottom+height:auto shrinks it — use explicit height so contain centers the page in the docked gap */
#focus.ctl #fbar{background:#0d0d10f2;border-bottom:1px solid var(--line)}                     /* solid top status bar (no gradient) so the gutter reads intentional */
#fcursor{position:absolute;left:-99px;top:-99px;width:34px;height:34px;margin:-17px 0 0 -17px;border:2px solid var(--live);border-radius:50%;box-shadow:0 0 12px #3ecf8eaa;pointer-events:none;z-index:53;opacity:0;transform:scale(.6);transition:opacity .2s,transform .2s}
#fcursor.show{opacity:1;transform:scale(1)}
#fcursor i{position:absolute;left:50%;top:50%;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:var(--live);box-shadow:0 0 6px #3ecf8e}  /* precise center point for trackpad mode */
#fcursor.clicking{transform:scale(1.4);background:#3ecf8e3a}                                  /* quick pulse on a touch-tap ripple */
/* trackpad mode: a real mouse-pointer arrow, hotspot (tip) at the click point — not the ring */
#focus.tpad #fcursor{width:26px;height:26px;margin:-2px 0 0 -4px;border:none;border-radius:0;box-shadow:none;background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 24 24'><path d='M4 2L4 19L8.5 14.8L11.7 21.4L14.3 20L11 13.7L17 13.7Z' fill='%23fff' stroke='%23161616' stroke-width='1.5' stroke-linejoin='round'/></svg>") no-repeat 0 0;filter:drop-shadow(0 1px 2px #000a);transform-origin:4px 2px}
#focus.tpad #fcursor i{display:none}                                                          /* the arrow tip IS the precise point; drop the ring's center dot */
#focus.tpad #fcursor.show{transform:none}                                                     /* arrow shows at natural size (no ring scale-in) */
#focus.tpad #fcursor.clicking{transform:scale(.78);background:none}                           /* quick "press" from the tip on click */
#fpmode{display:none;width:46px;padding:11px 0;justify-content:center}                        /* icon-only square: a 3rd text pill overflows the bar at phone width */
#fpmode span{display:none}                                                                     /* the icon (finger=touch · arrow=trackpad) carries the mode; green tint = trackpad active */
#focus.ctl #fpmode{display:inline-flex}                                                       /* pointer-mode toggle only while controlling */
#ftype{position:absolute;left:-9999px;top:0;width:8px;height:8px;opacity:0;border:0;padding:0}
#fctlbar{position:absolute;right:13px;bottom:calc(16px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:8px;z-index:54;transition:opacity .25s}
#fctlbar button{align-items:center;gap:7px;padding:11px 15px;border:none;border-radius:13px;color:#fff;font-size:14px;font-weight:650;cursor:pointer}
#fctlbar button svg{width:18px;height:18px}
#fctl{display:inline-flex}
#ftypebtn{display:none}
#focus.ctl #ftypebtn{display:inline-flex}
#fctl.on{color:#06210d;background:var(--live);box-shadow:0 0 16px #3ecf8e66}
#focus.ctl #fnav{display:none}          /* pager hidden while controlling — bottom belongs to the control pills */
#fnav #fzap{display:none}                /* drop the redundant jump-to-active to slim the pager (beats #fnav button) */
#focus.idle #fctlbar{opacity:0;pointer-events:none}
/* control mode: the floating pill-cluster becomes a full-width solid toolbar so the page can dock above it, never under it */
#focus.ctl #fctlbar{left:0;right:0;bottom:var(--kb,0px);justify-content:center;gap:10px;padding:11px 12px calc(11px + env(safe-area-inset-bottom));background:#0d0d10f2;border-top:1px solid var(--line);transition:bottom .18s ease}  /* --kb lifts the toolbar above the on-screen keyboard */
#fbar{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:12px;padding:11px 13px;padding-top:calc(11px + env(safe-area-inset-top));background:linear-gradient(#000c,#0000);z-index:52;transition:opacity .25s}
.glass{background:#000b;backdrop-filter:blur(8px);border:1px solid #ffffff1f}
#back{display:flex;align-items:center;gap:5px;color:#fff;font-size:14px;font-weight:550;padding:9px 14px;border-radius:11px;cursor:pointer}
#back:active{background:#000d}
#fid{display:flex;flex-direction:column;justify-content:center;gap:1px;min-width:0;flex:1}
.fnamerow{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%}
#fname{font-weight:650;font-size:15px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0;cursor:text;letter-spacing:.01em}
#fname.editing{overflow:visible;outline:none;background:#ffffff1f;border-radius:6px;padding:1px 7px;box-shadow:0 0 0 1px #3ecf8e88}
.fsub{display:flex;align-items:center;gap:7px;min-width:0;max-width:100%;padding-left:16px}
#fdom{font:11.5px ui-monospace,SFMono-Regular,Consolas,monospace;color:#8b8b93;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto}
#ftime{font-size:11px;color:#8b8b93;white-space:nowrap;flex:0 0 auto}
#ftime.stuck{color:#e0a44e}
#fdot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:#9aa0a6}
#fdot.active{background:var(--live);box-shadow:0 0 8px #3ecf8eaa;animation:pulse 1.9s ease-in-out infinite}
#fdot.idle{background:#9aa0a6;box-shadow:none;animation:none}
#fdot.stuck{background:#e0a44e;box-shadow:0 0 7px #e0a44e;animation:pulse 1.6s ease-in-out infinite}
.fbtn{flex:0 0 auto;width:42px;height:42px;border-radius:11px;color:#fff;font-size:17px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.fbtn:active{background:#000d}
.fbtn svg{width:18px;height:18px}
/* overflow menu: secondary focus actions live here so the bar stays Back · title · rotate · ⋯ */
#fmenu{position:absolute;top:calc(60px + env(safe-area-inset-top));right:13px;z-index:53;display:none;flex-direction:column;min-width:200px;padding:6px;border-radius:14px;box-shadow:0 14px 44px #000c}
#fmenu.on{display:flex}
#fmenu button{display:flex;align-items:center;gap:12px;width:100%;background:none;border:none;color:#e8e8ee;font-size:14.5px;font-weight:550;padding:11px 12px;border-radius:9px;cursor:pointer;text-align:left}
#fmenu button:active{background:#ffffff16}
#fmenu button svg{width:17px;height:17px;flex:0 0 auto;opacity:.9}
#fmenu .pinrow svg{fill:currentColor;stroke:none;opacity:1}
#fmenu .pinrow.on{color:#e8c66a}
#fmenu .sep{height:1px;background:#ffffff14;margin:4px 8px;padding:0}
#fmenu button.danger{color:#e3786f}
#fmenu button.danger:active{background:#e3786f22}
#fnav{position:absolute;left:13px;bottom:calc(16px + env(safe-area-inset-bottom));display:flex;gap:2px;align-items:center;border-radius:13px;padding:4px;z-index:52;transition:opacity .25s}  /* left-anchored so it never collides with the right-anchored control pills */
#fnav button{width:48px;height:42px;border:none;background:transparent;color:#fff;font-size:21px;cursor:pointer;border-radius:9px;display:flex;align-items:center;justify-content:center}
#fnav button:active{background:#ffffff22}
#fzap svg{width:18px;height:18px;fill:currentColor;stroke:none}
#flbl{color:#cfcfd6;font-size:13px;font-weight:600;padding:0 12px;min-width:56px;text-align:center;white-space:nowrap;flex:0 0 auto;font-variant-numeric:tabular-nums}
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
  #optmenu{position:fixed;left:0;right:0;bottom:0;top:auto;min-width:0;border-radius:18px 18px 0 0;padding:0 10px calc(10px + env(safe-area-inset-bottom));transform:translateY(110%);transition:transform .26s cubic-bezier(.22,1,.36,1);display:block;box-shadow:0 -10px 40px #000c;max-height:92vh;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
  #optmenu.open{transform:none}
  #optmenu.dragging{transition:none}
  .sheetgrip{display:block;position:sticky;top:0;margin:0 -10px;padding:8px 0 4px;background:#16161a;z-index:1;cursor:grab;touch-action:none}
  .sheetgrip::before{content:"";display:block;width:38px;height:4px;border-radius:3px;background:#4a4a52;margin:0 auto}
  body.sheet-open #scrim{opacity:1;pointer-events:auto}
  body.sheet-open #top{z-index:60}   /* the sheet lives inside #top (a z:10 stacking context) — lift it above the scrim (z:55) so sheet taps land on items, not the scrim */
  .mrow{padding:9px 12px;font-size:14px}
  .msec{padding:7px 12px 3px}
  #optmenu .msep{margin:3px 0}
  #buildtag{padding-top:4px}
}
/* respect reduced-motion: kill the pulses/spinners/slides for users who ask for it */
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}
:focus-visible{outline:2px solid var(--live);outline-offset:2px}
</style></head><body>
<header id="top"><div id="hdr"><span class="brand">${MARK}<span>Agent Browsers</span></span><span id="count"><i class="dot"></i><b id="cnum">0</b><span class="lbl">&nbsp;live</span></span><a id="needs" href="/?show=needs"><i></i><b id="needn">0</b><span class="lbl">&nbsp;need you</span></a><div id="searchwrap" class="seg"><button id="searchbtn" aria-label="Search">${ICOSRCH}</button><input id="q" placeholder="filter…" aria-label="Filter sessions by name" autocomplete="off"></div><button id="filterbtn" aria-label="Filter &amp; options"><span class="fbadge" id="filterbadge">0</span>${ICOFUN}<span id="filterlbl">Filter</span></button><span id="lay"><button data-c="1" title="Single pane" aria-label="Single pane">${ICO1}</button><button data-c="2" title="Two columns" aria-label="Two columns">${ICO2}</button><button data-c="3" title="Three columns" aria-label="Three columns">${ICO3}</button></span></div>
<div id="bar"><div id="chips" class="seg"><button class="chip" data-show="">All</button><button class="chip" data-show="live">Live</button><button class="chip" data-show="idle">Idle</button><button class="chip" data-show="multi">Multi</button><button class="chip need" data-show="needs">Needs</button></div><div id="tools" class="seg"><button id="selbtn" title="Select sessions to watch together" aria-label="Select">${ICOSEL}</button><button id="optbtn" title="Sort &amp; view options" aria-label="Options">${ICOSLID}</button></div></div><div id="optmenu"><div class="sheetgrip" id="sheetgrip"></div><div class="msec mob">Show</div><div id="showrow" class="mob"><span class="showseg"><button data-show="">All</button><button data-show="live">Live</button><button data-show="idle">Idle</button><button data-show="multi">Multi</button><button class="need" data-show="needs">Needs</button></span></div><div class="msep mob"></div><div class="msec">Sort</div><div class="mrow" data-sort="">Active first<span class="ck">${ICOCHK}</span></div><div class="mrow" data-sort="name">Name A–Z<span class="ck">${ICOCHK}</span></div><div class="mrow" data-sort="newest">Newest<span class="ck">${ICOCHK}</span></div><div class="msep"></div><div class="msec">View</div><div class="mrow rowflex" id="colrow"><span>Columns</span><span class="miniseg"><button data-c="1">1</button><button data-c="2">2</button><button data-c="3">3</button></span></div><div class="mrow" id="fitrow">${ICOFIT}Cover images<span class="swt"></span></div><div class="mrow mob" id="selrow">${ICOSEL}Select to watch…</div><div class="mrow" id="reorderrow">${ICOMOVE}Reorder tiles…</div><div class="mrow" id="activerow">${ICOZAP}Jump to most active</div><div class="mrow" id="reloadrow">${ICORELOAD}Reload app</div><div class="msep"></div><div class="msec">Settings</div><div class="mrow" id="notifrow">${ICOBELL}Notifications<span class="swt"></span></div><div class="mrow danger" id="clearrow">${ICOTRASH}Clear saved data</div><div class="msep"></div><div id="buildtag">Agent Browsers · build ${BUILD}</div></div></header>
<div id="scrim"></div>
<div id="ptr"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg></div>
<div id="netbanner"><span class="nspin"></span><span>Reconnecting…</span></div>
<main id="grid" role="main" aria-label="Agent browsers"></main>
<button id="watchfab">Watch&nbsp;<b id="watchn">0</b></button>
<div id="donebar"><button id="donebtn">Done reordering</button></div>
<div id="hint"><span>Tap any tile to watch it full-screen. Pull down to refresh, and long-press a tile to reorder.</span><button id="hintok">Got it</button></div>
<div id="empty">${MARK}<div class="emsg"><h2>No agent browsers detected</h2><p>Start any Chromium with remote debugging and it shows up here automatically:</p><code class="ecmd">chrome --remote-debugging-port=9222</code><p class="esub">Works with Chrome, Edge or Brave &mdash; and with Playwright / pool browsers, which expose this by default.</p></div><div class="emsg-off"><h2>Can&rsquo;t reach the dashboard</h2><p>The server looks offline. This reconnects automatically the moment it&rsquo;s back.</p></div></div>
<div id="focus"><img id="fimg" draggable="false" alt=""><div id="fbar"><button id="back" class="glass">&#x2039;&nbsp;Back</button><div id="fid"><span class="fnamerow"><span class="dot" id="fdot"></span><span id="fname" title="Tap to rename"></span></span><span class="fsub"><span id="fdom"></span><span id="ftime"></span></span></div><button id="fmore" class="fbtn glass" aria-label="More actions" title="More">${ICODOTS}</button></div><div id="fmenu" class="glass"><button data-act="rotate">${ICOROT}<span>Rotate to fill</span></button><button class="pinrow" data-act="pin">${ICOSTAR}<span>Pin to top</span></button><button data-act="rename">${ICOPEN}<span>Rename</span></button><button data-act="copy">${ICOLINK}<span>Copy link</span></button><button data-act="save">${ICODL}<span>Save frame</span></button><div class="sep"></div><button data-act="fs">${ICOEXP}<span>Fullscreen</span></button><div class="sep"></div><button data-act="kill" class="danger">${ICOPOWER}<span>Close session</span></button></div><div id="fnav" class="glass"><button id="fzap" aria-label="Jump to most active" title="Jump to most active">${ICOZAP}</button><button id="prev" aria-label="Previous">&#x2039;</button><span id="flbl"></span><button id="next" aria-label="Next">&#x203A;</button></div><div id="fctlbar"><button id="ftypebtn" class="glass">${ICOKEYB}<span>Type</span></button><button id="fpmode" class="fbtn glass" aria-label="Pointer mode" title="Switch touch / trackpad pointer">${ICOTOUCH}<span>Touch</span></button><button id="fctl" class="glass" aria-label="Take control (tap to click)" title="Take control">${ICOCURSOR}<span>Control</span></button></div><input id="ftype" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Type into the page"><div id="fcursor"><i></i></div></div>
<script>
const grid=document.getElementById('grid'),cnum=document.getElementById('cnum'),hdot=document.querySelector('#count .dot'),empty=document.getElementById('empty');
const focus=document.getElementById('focus'),fimg=document.getElementById('fimg'),flbl=document.getElementById('flbl'),back=document.getElementById('back'),prev=document.getElementById('prev'),next=document.getElementById('next'),fnav=document.getElementById('fnav');
const fname=document.getElementById('fname'),fdom=document.getElementById('fdom'),fdot=document.getElementById('fdot'),ftime=document.getElementById('ftime'),frot=document.getElementById('frot'),fzap=document.getElementById('fzap'),fmore=document.getElementById('fmore'),fmenu=document.getElementById('fmenu');
const qbox=document.getElementById('q'),needsEl=document.getElementById('needs'),neednEl=document.getElementById('needn');
const filterbtn=document.getElementById('filterbtn'),filterlbl=document.getElementById('filterlbl'),filterbadge=document.getElementById('filterbadge'),scrim=document.getElementById('scrim');
const selbtn=document.getElementById('selbtn'),optbtn=document.getElementById('optbtn'),optmenu=document.getElementById('optmenu'),fitrow=document.getElementById('fitrow'),activerow=document.getElementById('activerow'),selrow=document.getElementById('selrow'),watchfab=document.getElementById('watchfab'),watchn=document.getElementById('watchn');
const reorderrow=document.getElementById('reorderrow'),donebtn=document.getElementById('donebtn');
let selectMode=false,reorderMode=false; const selSet=new Set();
const tiles=new Map(),meta=new Map(); let order=[],all=[];
let customOrder=null;try{customOrder=JSON.parse(localStorage.getItem('order')||'null');}catch(_){}   // user's drag-reordered tile order
let pins=new Set();try{pins=new Set(JSON.parse(localStorage.getItem('pins')||'[]'));}catch(_){}      // favorited tiles (sort to top)
let dragId=null,lastDragEnd=0;
let notifOn=(localStorage.getItem('notif')!=='0');   // Settings: mute "needs you" notifications (declared early — used in init + notify)
let focusSlug=null,focusES=null,feedES=null,editing=false;
let watch=null;            // array of slugs for /watch, else null
let embed=false;           // /embed mode
const params=new URLSearchParams(location.search);
// remembered preferences: a shared link's own params always win; otherwise seed each pref from this device's saved default
['show','sort','fit'].forEach(k=>{ if(!params.has(k)){ let v=null; try{v=localStorage.getItem('pref_'+k);}catch(_){} if(v) params.set(k,v); } });
function savePref(k,v){try{if(v)localStorage.setItem('pref_'+k,v);else localStorage.removeItem('pref_'+k);}catch(_){}}  // empty = back to default → forget it
const _dec=document.createElement('textarea');
function decodeEntities(s){if(!s||s.indexOf('&')<0)return s;_dec.innerHTML=s;return _dec.value;} // titles from CDP arrive HTML-encoded (e.g. &amp;)
let names={};try{names=JSON.parse(localStorage.getItem('names')||'{}');}catch(_){}   // user-given custom session names
function nameOf(s){return names[s.id]||decodeEntities(s.title||s.id);}
function domainOf(u){try{const x=new URL(u);return x.hostname.replace(/^www\\./,'')+(x.pathname.replace(/\\/$/,'')||'');}catch{return u||'';}}

// ---------- multiplexed tile feed (ONE connection) ----------
// connection state: a debounced "Reconnecting…" strip when the live feed/server drops (EventSource auto-retries)
const netbanner=document.getElementById('netbanner');
let netTimer=null,netDown=false;
function netStatus(ok){
  if(ok){netDown=false;if(netTimer){clearTimeout(netTimer);netTimer=null;}netbanner.classList.remove('show');document.body.classList.remove('offline');}
  else if(!netDown&&!netTimer){netTimer=setTimeout(()=>{netDown=true;netTimer=null;netbanner.classList.add('show');document.body.classList.add('offline');},1500);} // only surface a sustained drop (also swaps the empty-state copy to "can't reach the dashboard")
}
function openFeed(){ if(feedES)return; feedES=new EventSource('/api/feed');
  feedES.onopen=()=>netStatus(true);
  feedES.onerror=()=>netStatus(false);                            // EventSource is auto-reconnecting under the hood
  feedES.onmessage=e=>{netStatus(true);if(dragId)return;          // freeze stream repaints during a drag so JPEG decode doesn't fight the gesture on the main thread
    const i=e.data.indexOf('\\t');if(i<0)return;const id=e.data.slice(0,i),data=e.data.slice(i+1);
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
function viewGrid(){if(controlOn)setControl(false);focus.classList.remove('on','idle');if(focusES){focusES.close();focusES=null;}focusSlug=null;document.title='Agent Browsers';}
function fmtAgo(ms){if(ms==null)return '';const s=Math.round(ms/1000);if(s<2)return 'live';if(s<60)return s+'s ago';const m=Math.round(s/60);if(m<60)return m+'m ago';return Math.round(m/60)+'h ago';}
// keep the focus-bar title tight: a page <title> like "Stripe | Financial Infrastructure…" shows as just "Stripe"
function shortTitle(t){if(!t)return '';const p=t.split(/\\s[|\\u2013\\u2014\\u00b7-]\\s/)[0].trim();return p||t;}
function syncFocusBar(){const m=meta.get(focusSlug)||{};const st=m.state||'idle';if(!editing)fname.textContent=shortTitle(m.title)||focusSlug;
  focus.setAttribute('aria-label',(shortTitle(m.title)||focusSlug||'session')+' live view');   // focus img stays alt="" (data-URI); label the region instead
  const pr=fmenu&&fmenu.querySelector('.pinrow');if(pr)pr.classList.toggle('on',pins.has(focusSlug)); // reflect pin state in the menu
  fdom.textContent=m.url||'';                                  // full URL, not just the domain
  fdot.className='dot '+st;                                    // dot colored by live/idle/stuck state
  const ago=st==='active'?'live':(st==='stuck'?'stuck '+fmtAgo(m.lastChangeMs):fmtAgo(m.lastChangeMs));
  ftime.textContent=ago?('· '+ago):'';ftime.className=st==='stuck'?'stuck':'';
  const i=order.indexOf(focusSlug);const hasMany=order.length>1;flbl.textContent=hasMany?((i+1)+' / '+order.length):'';if(fnav)fnav.style.display=hasMany?'':'none';  // hide the pager entirely when there's nothing to page through
  document.title=(m.title?m.title.replace(/(?: · Agent Browsers)+$/,'')+' · ':'')+'Agent Browsers';} // strip repeats so a self-viewing session can't compound the title

// ---------- routing ----------
function qstr(){const s=params.toString();return s?('?'+s):'';}
function render(){
  const path=decodeURIComponent(location.pathname);
  try{localStorage.setItem('route',location.pathname);}catch(_){}   // remember where you are so a cold launch can return here
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
function doFullscreen(){if(nativeFS()){(document.exitFullscreen||document.webkitExitFullscreen).call(document);}else requestFS();}
async function doCopy(){if(!focusSlug)return;const url=location.origin+'/'+focusSlug;try{await navigator.clipboard.writeText(url);buzz(12);}catch(_){}}
function doSave(){if(!fimg.src)return;const a=document.createElement('a');a.href=fimg.src;a.download=(focusSlug||'frame')+'-'+Date.now()+'.jpg';document.body.appendChild(a);a.click();a.remove();buzz(12);}
function closeFMenu(){fmenu.classList.remove('on');}
fmore.onclick=e=>{e.stopPropagation();fmenu.classList.toggle('on');};
fmenu.onclick=e=>{const b=e.target.closest('button');if(!b)return;e.stopPropagation();const act=b.dataset.act;closeFMenu();
  if(act==='pin'){if(focusSlug){togglePin(focusSlug);syncFocusBar();}}
  else if(act==='rename')startRename();
  else if(act==='copy')doCopy();
  else if(act==='save')doSave();
  else if(act==='rotate')toggleRot();
  else if(act==='fs')doFullscreen();
  else if(act==='kill')killFocusSession();};
// close (kill) the focused browser tab via the guarded server endpoint — destructive, so confirm first
function killFocusSession(){if(!focusSlug)return;const slug=focusSlug;const name=shortTitle((meta.get(slug)||{}).title)||slug;
  if(!confirm('Close this browser session?\\n\\n'+name+'\\n\\nThe agent loses this tab — this cannot be undone.'))return;
  buzz(25);fetch('/api/kill',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify({slug})}).catch(()=>{});
  nav('/');setTimeout(()=>{try{poll();}catch(_){}},450);}
addEventListener('click',e=>{if(fmenu.classList.contains('on')&&!(e.target.closest&&e.target.closest('#fmenu,#fmore')))closeFMenu();});
fzap.onclick=e=>{e.stopPropagation();buzz();nav('/active');};
// tap the title (or pencil cue) to rename the session (persists, feeds the tile name); Enter saves, Esc cancels, blank reverts
function startRename(e){if(!focusSlug||editing)return;if(e)e.stopPropagation();editing=true;fname.contentEditable='true';fname.classList.add('editing');
  fname.textContent=names[focusSlug]||(meta.get(focusSlug)||{}).title||focusSlug;fname.focus();
  const r=document.createRange();r.selectNodeContents(fname);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);}
fname.onclick=startRename;
function commitRename(save){if(!editing)return;editing=false;fname.contentEditable='false';fname.classList.remove('editing');
  if(save){const v=fname.textContent.trim().replace(/\\s+/g,' ');if(v)names[focusSlug]=v;else delete names[focusSlug];try{localStorage.setItem('names',JSON.stringify(names));}catch(_){}}
  const s=all.find(x=>x.id===focusSlug),mm=meta.get(focusSlug);if(s&&mm)mm.title=nameOf(s);   // refresh meta so the bar shows the new name immediately
  applyGrid();syncFocusBar();}
fname.addEventListener('keydown',e=>{if(!editing)return;e.stopPropagation();if(e.key==='Enter'){e.preventDefault();commitRename(true);}else if(e.key==='Escape'){e.preventDefault();commitRename(false);}});
fname.addEventListener('blur',()=>commitRename(true));
addEventListener('keydown',e=>{if(!focus.classList.contains('on'))return;if(e.key==='Escape')nav('/');else if(e.key==='ArrowRight')step(1);else if(e.key==='ArrowLeft')step(-1);else if(e.key==='f')doFullscreen();});
// our long-press IS the drag gesture — kill the browser's native long-press/right-click menu everywhere except text fields
addEventListener('contextmenu',e=>{if(e.target&&e.target.closest&&e.target.closest('input,textarea,[contenteditable="true"]'))return;e.preventDefault();});

// ---------- pinch-zoom + pan on focus image ----------
function buzz(ms){try{navigator.vibrate&&navigator.vibrate(ms||10);}catch(_){}}
let z=1,tx=0,ty=0,pts=new Map(),pinch=null,swipe=null,multi=false;
function applyZoom(){fimg.style.transform=focus.classList.contains('rot')?('translate(-50%,-50%) rotate(90deg) scale('+z+')'):('translate('+tx+'px,'+ty+'px) scale('+z+')');}
function resetZoom(){z=1;tx=0;ty=0;applyZoom();}
function toggleRot(){focus.classList.toggle('rot');resetZoom();buzz();}   // fill the glass: rotate the view 90° so a landscape page fills a portrait phone
fimg.addEventListener('pointerdown',e=>{cancelMomentum();vel.x=0;vel.y=0;vel.t=Date.now();pts.set(e.pointerId,{x:e.clientX,y:e.clientY});try{fimg.setPointerCapture(e.pointerId);}catch(_){}
  if(pts.size===1){swipe={x:e.clientX,y:e.clientY,t:Date.now()};multi=false;tpMoved=false;}
  if(pts.size===2){multi=true;const p=[...pts.values()];if(controlOn&&ptrMode==='trackpad'){lastMid={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2};}else{pinch={d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),z};}}});
fimg.addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;if(focus.classList.contains('rot'))return;const prev=pts.get(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(controlOn&&ptrMode==='trackpad'){                                  // trackpad: 1 finger = move cursor, 2 fingers = scroll (no pinch-zoom)
    if(pts.size>=2){const p=[...pts.values()];const mx=(p[0].x+p[1].x)/2,my=(p[0].y+p[1].y)/2;if(lastMid)scrollDrag(mx,my,mx-lastMid.x,my-lastMid.y);lastMid={x:mx,y:my};return;}
    const dx=e.clientX-prev.x,dy=e.clientY-prev.y;if(Math.abs(dx)+Math.abs(dy)>1.5)tpMoved=true;moveCursor(dx,dy);return;}
  if(pts.size===2&&pinch){const p=[...pts.values()];const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
    const zNew=Math.max(1,Math.min(5,pinch.z*d/pinch.d));
    const Fx=(p[0].x+p[1].x)/2,Fy=(p[0].y+p[1].y)/2;        // zoom focal point = the pinch midpoint
    const r=fimg.getBoundingClientRect();                    // current (transformed) rect; transform-origin is 0 0
    tx+=(Fx-r.left)*(1-zNew/z);ty+=(Fy-r.top)*(1-zNew/z);    // shift origin so the content under the fingers stays put
    z=zNew;if(z===1){tx=0;ty=0;}applyZoom();}
  else if(pts.size===1&&z>1){tx+=e.clientX-prev.x;ty+=e.clientY-prev.y;applyZoom();}
  else if(controlOn&&pts.size===1){scrollDrag(e.clientX,e.clientY,e.clientX-prev.x,e.clientY-prev.y);}});
function liftPtr(e){
  // single-finger flick on an un-zoomed image: ←/→ switch session, swipe-down closes
  if(pts.size===1&&!multi&&z===1&&swipe){const dx=e.clientX-swipe.x,dy=e.clientY-swipe.y,dt=Date.now()-swipe.t;
    if(controlOn&&ptrMode==='trackpad'){                              // trackpad: a tap (no drag) clicks at the cursor; a drag only repositioned it
      if(!tpMoved&&Math.abs(dx)<10&&Math.abs(dy)<10)clickAtCursor();}
    else if(Math.abs(dx)<10&&Math.abs(dy)<10){controlOn?clickAt(e.clientX,e.clientY):toggleChrome();}   // touch mode: tap=click; else tap toggles chrome
    else if(controlOn&&!focus.classList.contains('rot')){startMomentum();}   // touch-mode drag: flick coasts after lift
    else if(!controlOn&&!focus.classList.contains('rot')){           // swipe nav/close only in watch mode, not rotated
      if(dt<600&&Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.3){step(dx<0?1:-1);}
      else if(dt<600&&dy>90&&dy>Math.abs(dx)){buzz();nav('/');}}}
  pts.delete(e.pointerId);if(pts.size<2){pinch=null;lastMid=null;}if(pts.size===0)swipe=null;}
fimg.addEventListener('pointerup',liftPtr);fimg.addEventListener('pointercancel',liftPtr);
fimg.addEventListener('dblclick',()=>{z>1?resetZoom():(z=2,applyZoom());});

// ---------- Path A: take control (tap=click · drag=scroll · Type=keyboard) ----------
let controlOn=false,vel={x:0,y:0,t:0},momRAF=0; const fctl=document.getElementById('fctl'),ftype=document.getElementById('ftype'),fcursor=document.getElementById('fcursor'),ftypebtn=document.getElementById('ftypebtn'),fpmode=document.getElementById('fpmode'),wq={dx:0,dy:0,t:0};
// pointer sub-mode: 'touch' = tap lands a click where you tap (direct); 'trackpad' = one-finger drag nudges a persistent cursor and a tap clicks at it (RDP mouse-mode). Remembered across sessions.
let ptrMode=(()=>{try{return localStorage.getItem('ptrMode')||'touch';}catch(_){return 'touch';}})();let curX=0,curY=0,tpMoved=false,lastMid=null;
// the page is contain-fitted; the cursor must stay on the real image, not the letterbox — these bounds clamp it
function imgContentRect(){const b=fimg.getBoundingClientRect();if(!fimg.naturalWidth||!fimg.naturalHeight)return{left:b.left,top:b.top,right:b.right,bottom:b.bottom};const ar=fimg.naturalWidth/fimg.naturalHeight,br=b.width/b.height;let dw,dh,ox,oy;if(ar>br){dw=b.width;dh=b.width/ar;ox=0;oy=(b.height-dh)/2;}else{dh=b.height;dw=b.height*ar;oy=0;ox=(b.width-dw)/2;}return{left:b.left+ox,top:b.top+oy,right:b.left+ox+dw,bottom:b.top+oy+dh};}
function placeCursor(){if(fcursor){fcursor.style.left=curX+'px';fcursor.style.top=curY+'px';}}
function centerCursor(){const r=imgContentRect();curX=(r.left+r.right)/2;curY=(r.top+r.bottom)/2;placeCursor();}
function showCursor(on){if(fcursor)fcursor.classList.toggle('show',on);}
function moveCursor(dx,dy){const A=1.6;const r=imgContentRect();curX=Math.max(r.left,Math.min(r.right,curX+dx*A));curY=Math.max(r.top,Math.min(r.bottom,curY+dy*A));placeCursor();showCursor(true);}
function clickAtCursor(){const f=imgFrac(curX,curY);if(!f)return;buzz(14);if(fcursor){fcursor.classList.add('clicking');setTimeout(()=>fcursor&&fcursor.classList.remove('clicking'),200);}sendInput({kind:'click',xf:f.xf,yf:f.yf});}
function syncPmodeBtn(){if(fpmode){fpmode.innerHTML=(ptrMode==='trackpad'?'${ICOCURSOR}<span>Trackpad</span>':'${ICOTOUCH}<span>Touch</span>');fpmode.classList.toggle('on',ptrMode==='trackpad');}}
function setPtrMode(m){ptrMode=m;try{localStorage.setItem('ptrMode',m);}catch(_){}focus.classList.toggle('tpad',m==='trackpad');syncPmodeBtn();if(controlOn&&m==='trackpad'){centerCursor();showCursor(true);}else{showCursor(false);}buzz(10);}
if(fpmode)fpmode.onclick=e=>{e.stopPropagation();setPtrMode(ptrMode==='trackpad'?'touch':'trackpad');};
syncPmodeBtn();
// measure the real bar heights (safe-area + content) AND the on-screen keyboard into CSS vars, so the docked page +
// toolbar always sit in the space that's actually visible — never hidden behind the keyboard (the RDP "keep what you're
// typing into in view" behavior). visualViewport reports the keyboard; without it (desktop) kb is 0 and nothing changes.
function layoutCtl(){if(!controlOn)return;
  const vv=window.visualViewport;
  const kb=vv?Math.max(0,Math.round(innerHeight-vv.height-vv.offsetTop)):0;   // height the keyboard steals from the bottom
  const tb=document.getElementById('fbar'),bb=document.getElementById('fctlbar');
  const top=(tb&&tb.offsetHeight)||58,barH=(bb&&bb.offsetHeight)||84;
  focus.style.setProperty('--kb',kb+'px');                                    // lifts the toolbar above the keyboard
  focus.style.setProperty('--ctop',top+'px');
  focus.style.setProperty('--cbot',(barH+kb)+'px');                           // page docks above the toolbar, which is above the keyboard
}
if(window.visualViewport){visualViewport.addEventListener('resize',()=>{if(controlOn)requestAnimationFrame(layoutCtl);});visualViewport.addEventListener('scroll',()=>{if(controlOn)requestAnimationFrame(layoutCtl);});}
function setControl(on){controlOn=on;focus.classList.toggle('ctl',on);if(fctl)fctl.classList.toggle('on',on);if(on){if(focus.classList.contains('rot'))toggleRot();resetZoom();focus.classList.remove('idle');if(ptrMode==='trackpad')focus.classList.add('tpad');
    requestAnimationFrame(()=>{layoutCtl();if(controlOn&&ptrMode==='trackpad'){centerCursor();showCursor(true);}});   // dock the page, THEN center the cursor in the docked box
  }else{if(ftype)ftype.blur();lastMid=null;if(fcursor)fcursor.classList.remove('show');}buzz(on?14:8);}
addEventListener('resize',()=>{if(controlOn)requestAnimationFrame(layoutCtl);});                 // keyboard open / rotate / bar reflow re-docks the page
if(fctl)fctl.onclick=e=>{e.stopPropagation();setControl(!controlOn);};
// map a client point to a 0..1 fraction within the contain-fitted image (null = on the letterbox)
function imgFrac(cx,cy){if(!fimg.naturalWidth||!fimg.naturalHeight)return null;const b=fimg.getBoundingClientRect();const ar=fimg.naturalWidth/fimg.naturalHeight,br=b.width/b.height;let dw,dh,ox,oy;if(ar>br){dw=b.width;dh=b.width/ar;ox=0;oy=(b.height-dh)/2;}else{dh=b.height;dw=b.height*ar;oy=0;ox=(b.width-dw)/2;}const xf=(cx-b.left-ox)/dw,yf=(cy-b.top-oy)/dh;if(xf<0||xf>1||yf<0||yf>1)return null;return{xf,yf};}
function sendInput(p){try{fetch('/api/input',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,body:JSON.stringify(Object.assign({slug:focusSlug},p))});}catch(_){}}
function clickAt(cx,cy){const f=imgFrac(cx,cy);if(!f)return;if(fcursor){fcursor.style.left=cx+'px';fcursor.style.top=cy+'px';fcursor.classList.add('show');setTimeout(()=>fcursor.classList.remove('show'),650);}buzz(10);sendInput({kind:'click',xf:f.xf,yf:f.yf});}
// the page is contain-fitted into the image box; scroll against the actual content rect (not the letterboxed box) so the page tracks the finger 1:1
function imgContent(){const b=fimg.getBoundingClientRect();const ar=(fimg.naturalWidth||1)/(fimg.naturalHeight||1),br=b.width/b.height;let dw,dh;if(ar>br){dw=b.width;dh=b.width/ar;}else{dh=b.height;dw=b.height*ar;}return{dw,dh};}
function sampleVel(dxc,dyc){const n=Date.now(),dt=Math.max(1,n-vel.t),k=.55;vel.x=k*(dxc/dt)+(1-k)*vel.x;vel.y=k*(dyc/dt)+(1-k)*vel.y;vel.t=n;}   // EMA px/ms for the flick
function scrollDrag(cx,cy,dxc,dyc){sampleVel(dxc,dyc);wq.dx+=dxc;wq.dy+=dyc;const n=Date.now();if(n-wq.t<33)return;const c=imgContent();const f=imgFrac(cx,cy)||{xf:.5,yf:.5};sendInput({kind:'wheel',xf:f.xf,yf:f.yf,dxf:-wq.dx/c.dw,dyf:-wq.dy/c.dh});wq.dx=0;wq.dy=0;wq.t=n;}
function cancelMomentum(){if(momRAF){cancelAnimationFrame(momRAF);momRAF=0;}}
function startMomentum(){cancelMomentum();let vx=vel.x,vy=vel.y;const sp=Math.hypot(vx,vy);if(sp<0.3)return;const cap=2.5;if(sp>cap){vx*=cap/sp;vy*=cap/sp;}const c=imgContent();let last=Date.now();const step=()=>{const n=Date.now(),dt=Math.min(40,n-last);last=n;sendInput({kind:'wheel',xf:.5,yf:.5,dxf:-vx*dt/c.dw,dyf:-vy*dt/c.dh});const fr=Math.pow(.94,dt/16);vx*=fr;vy*=fr;momRAF=Math.hypot(vx,vy)>0.02?requestAnimationFrame(step):0;};momRAF=requestAnimationFrame(step);}
if(ftypebtn)ftypebtn.onclick=e=>{e.stopPropagation();if(ftype)ftype.focus();buzz(10);};
if(ftype){ftype.addEventListener('input',()=>{const v=ftype.value;if(v){sendInput({kind:'text',text:v});ftype.value='';}});
  ftype.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();sendInput({kind:'key',key:'Enter'});}else if(e.key==='Backspace'){e.preventDefault();sendInput({kind:'key',key:'Backspace'});}else if(e.key==='Tab'){e.preventDefault();sendInput({kind:'key',key:'Tab'});}});}

// ---------- tiles ----------
function setTabs(x,n){x.tn.textContent=n;x.el.classList.toggle('multi',n>1);}
function addTile(s){const el=document.createElement('div');el.className='tile';el.dataset.id=s.id;el.setAttribute('role','button');el.tabIndex=0;
  el.innerHTML='<div class="sk"></div><img draggable="false" alt=""><div class="check">&#x2713;</div><span class="badge"><i></i><span class="bt">LIVE</span></span><button class="pin" aria-label="Pin">${ICOSTAR}</button><span class="tabs">${ICOTAB}<span class="tn"></span></span><div class="lbl"><span class="t"></span><span class="d"></span></div>';
  const img=el.querySelector('img'),t=el.querySelector('.t'),d=el.querySelector('.d'),tn=el.querySelector('.tn'),bt=el.querySelector('.bt'),pin=el.querySelector('.pin');
  t.textContent=nameOf(s);d.textContent=domainOf(s.url);el.setAttribute('aria-label',nameOf(s));el.onclick=()=>tileClick(s.id);  // thumbnail stays alt="" (decorative); the button's aria-label is the accessible name
  el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();tileClick(s.id);}});  // keyboard-activate the tile
  setupDrag(el,s.id);
  pin.addEventListener('pointerdown',e=>e.stopPropagation());           // don't start a drag from the star
  pin.onclick=e=>{e.stopPropagation();togglePin(s.id);};
  grid.appendChild(el);const x={el,img,t,d,tn,bt,visible:true};tiles.set(s.id,x);setTabs(x,s.tabs);if(selSet.has(s.id))el.classList.add('sel');if(pins.has(s.id))el.classList.add('pinned');io.observe(el);}
function togglePin(id){if(pins.has(id))pins.delete(id);else pins.add(id);try{localStorage.setItem('pins',JSON.stringify([...pins]));}catch(_){}const x=tiles.get(id);if(x)x.el.classList.toggle('pinned',pins.has(id));buzz(12);applyGrid();}
function tileClick(id){if(reorderMode)return;if(Date.now()-lastDragEnd<350)return;buzz();if(selectMode)toggleSel(id);else openFocus(id);}
// Two ways to reorder: (1) Reorder mode — tiles have touch-action:none so a drag starts on a tiny move with no
// scroll fight (the reliable path); (2) normal mode — a ~300ms long-press arms it (convenience). Order persists.
function setupDrag(el,id){let lp=null,on=false,sx=0,sy=0,cx=0,cy=0,pend=false,pid=0;
  const arm=()=>{on=true;pend=false;clearTimeout(lp);beginDrag(id,cx,cy);buzz(reorderMode?14:20);try{el.setPointerCapture(pid);}catch(_){}};
  el.addEventListener('pointerdown',e=>{if(selectMode||focus.classList.contains('on'))return;sx=cx=e.clientX;sy=cy=e.clientY;on=false;pend=true;pid=e.pointerId;
    if(!reorderMode)lp=setTimeout(()=>{if(pend)arm();},300);});                          // long-press only in normal mode
  el.addEventListener('pointermove',e=>{cx=e.clientX;cy=e.clientY;
    if(on){e.preventDefault();moveDrag(cx,cy);return;}
    if(!pend)return;const d=Math.max(Math.abs(cx-sx),Math.abs(cy-sy));
    if(reorderMode){if(d>6){e.preventDefault();arm();}}                                   // reorder mode: arm on a small move, immediately
    else if(d>14){clearTimeout(lp);pend=false;}});                                        // moved before the long-press fired = scroll intent, let it go
  const end=e=>{if(e&&on){dragPX=e.clientX;dragPY=e.clientY;}clearTimeout(lp);pend=false;if(on){on=false;endDrag();}}; // capture the exact release point
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);}
let dragOX=0,dragOY=0;                                          // pointer offset inside the lifted tile
let dragPh=null,dragLastIdx=-1;                                  // placeholder element + last insertion index
let gCols=1,gGap=12,gPadL=12,gPadT=12,gTW=0,gTH=0;             // cached grid geometry (transform-immune slot math)
function beginDrag(id,px,py){dragId=id;document.body.classList.add('dragging');const x=tiles.get(id);if(!x)return;const el=x.el;
  const r=el.getBoundingClientRect();dragOX=px-r.left;dragOY=py-r.top;                  // lock the grab point so the tile sits under the finger
  const cs=getComputedStyle(grid);gCols=cs.gridTemplateColumns.split(' ').length;gGap=parseFloat(cs.rowGap)||12;
  gPadL=parseFloat(cs.paddingLeft)||12;gPadT=parseFloat(cs.paddingTop)||12;gTW=r.width;gTH=r.height;  // tile size from the dragged tile
  dragPh=document.createElement('div');dragPh.className='tile ph';dragPh.style.order=el.style.order||order.indexOf(id);grid.appendChild(dragPh); // reserve the slot in-flow so the others slide to open a gap
  dragLastIdx=-1;
  el.style.width=r.width+'px';el.style.height=r.height+'px';el.style.left=r.left+'px';el.style.top=r.top+'px';el.classList.add('drag');}
let dragRAF=0,moveRAF=0,dragPX=0,dragPY=0;
function moveDrag(px,py){dragPX=px;dragPY=py;const x=tiles.get(dragId);if(x){x.el.style.left=(px-dragOX)+'px';x.el.style.top=(py-dragOY)+'px';} // lifted tile follows EVERY move (cheap)
  if(!moveRAF)moveRAF=requestAnimationFrame(()=>{moveRAF=0;dragOver(dragPX,dragPY);});  // reorder work throttled to one frame
  if(!dragRAF)dragRAF=requestAnimationFrame(edgeTick);}
function edgeTick(){if(!dragId){dragRAF=0;return;}                  // auto-scroll when the finger nears a viewport edge (tall/phone grids)
  const EZ=80,MAX=16,h=innerHeight;let v=0;
  if(dragPY<EZ)v=-Math.ceil((EZ-dragPY)/EZ*MAX);else if(dragPY>h-EZ)v=Math.ceil((dragPY-(h-EZ))/EZ*MAX);
  if(v){const before=scrollY;scrollBy(0,v);if(scrollY!==before){const x=tiles.get(dragId);if(x){x.el.style.left=(dragPX-dragOX)+'px';x.el.style.top=(dragPY-dragOY)+'px';}dragOver(dragPX,dragPY);}else v=0;}
  dragRAF=v?requestAnimationFrame(edgeTick):0;}
// Insertion slot from GRID GEOMETRY (fixed cell centers) — immune to in-flight FLIP transforms, and one rect read
// instead of one per tile. Moving the placeholder slides the real tiles to open a gap (FLIP). Crossing a cell
// center (~half a tile) is required to change slots → built-in hysteresis, no jitter oscillation.
function dragOver(x,y){if(!dragId||!dragPh)return;
  const px=x-dragOX+gTW/2,py=y-dragOY+gTH/2;                    // the lifted tile's CENTER (what the user sees), not the raw finger point
  const others=order.filter(id=>id!==dragId);
  const gr=grid.getBoundingClientRect();
  let col=Math.round((px-(gr.left+gPadL+gTW/2))/(gTW+gGap));    // nearest cell to the tile center — symmetric (no off-by-one) and
  let row=Math.round((py-(gr.top+gPadT+gTH/2))/(gTH+gGap));     // accounts for the placeholder occupying a cell
  col=Math.max(0,Math.min(gCols-1,col));row=Math.max(0,row);
  let idx=Math.max(0,Math.min(others.length,row*gCols+col));
  if(idx===dragLastIdx)return;                                   // slot unchanged → no DOM churn, no flicker
  dragLastIdx=idx;
  const movers=others.map(id=>tiles.get(id)).filter(Boolean);
  const first=movers.map(t=>[t,t.el.getBoundingClientRect()]);   // FLIP: capture before
  for(let i=0;i<others.length;i++){const t=tiles.get(others[i]);if(t)t.el.style.order=(i<idx?i:i+1);} // open the gap at idx
  dragPh.style.order=idx;
  order=others.slice();order.splice(idx,0,dragId);               // keep the data model in sync for persistence
  const moved=[];                                                // FLIP: invert each displaced tile to its old spot…
  for(const [t,a] of first){const b=t.el.getBoundingClientRect(),mx=a.left-b.left,my=a.top-b.top;
    if(!mx&&!my)continue;t.el.style.transition='none';t.el.style.transform='translate('+mx+'px,'+my+'px)';moved.push(t);}
  void grid.offsetWidth;                                         // …one reflow for all…
  for(const t of moved){t.el.style.transition='transform .16s ease';t.el.style.transform='';}}  // …then play them home
function endDrag(){if(dragId&&dragPh)dragOver(dragPX,dragPY);   // FINAL reorder at the real release point — the rAF throttle may have skipped the last move, which dropped tiles in the wrong slot
  if(dragRAF){cancelAnimationFrame(dragRAF);dragRAF=0;}if(moveRAF){cancelAnimationFrame(moveRAF);moveRAF=0;}const x=tiles.get(dragId);if(x){x.el.classList.remove('drag');const s=x.el.style;s.width=s.height=s.left=s.top=s.pointerEvents='';}
  if(dragPh){dragPh.remove();dragPh=null;}
  order.forEach((sid,i)=>{const tt=tiles.get(sid);if(tt){const s=tt.el.style;s.order=i;s.transition='';s.transform='';}}); // settle final order, clear FLIP
  document.body.classList.remove('dragging');dragId=null;dragLastIdx=-1;lastDragEnd=Date.now();
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
  if(pins.size&&!customOrder)list.sort((a,b)=>(pins.has(a.id)?0:1)-(pins.has(b.id)?0:1)); // favorites float to top in AUTO sort only — a manual drag order is respected exactly (else a pin yanks a just-dropped tile out of place)
  const want=new Set(list.map(s=>s.id));
  for(const id of [...tiles.keys()])if(!want.has(id))removeTile(id);
  for(const s of list){if(!tiles.has(s.id))addTile(s);const x=tiles.get(s.id);x.t.textContent=nameOf(s);x.d.textContent=domainOf(s.url);x.el.setAttribute('aria-label',nameOf(s));setState(x,s);setTabs(x,s.tabs);x.el.classList.toggle('pinned',pins.has(s.id));x.el.style.order=list.indexOf(s);}
  order=list.map(s=>s.id);
  empty.classList.toggle('on',list.length===0&&!focus.classList.contains('on'));
  grid.style.display=focus.classList.contains('on')?'none':(list.length===0?'none':'');
}

// ---------- poll session list ----------
async function poll(){let list=null;try{list=await(await fetch('/api/sessions')).json();}catch{}
  if(list===null){netStatus(false);return;}   // server unreachable → keep the last good grid up + show the banner, don't flash empty
  netStatus(true);
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
if(initCols!=='2')params.set('cols',initCols);   // reflect non-default columns in the URL so it stays shareable
grid.style.gridTemplateColumns='repeat('+initCols+',1fr)';colBtns().forEach(b=>b.classList.toggle('on',b.dataset.c===initCols));
// reflect current query state onto the toolbar (desktop chips + mobile sheet share [data-show])
const FILTERLBL={'':'Filter',live:'Live',idle:'Idle',multi:'Multi',needs:'Needs'};
function syncBar(){const show=params.get('show')||'';[...document.querySelectorAll('[data-show]')].forEach(c=>c.classList.toggle('on',(c.dataset.show||'')===show));
  filterlbl.textContent=FILTERLBL[show]||'Filter';filterbtn.classList.toggle('act',!!show);   // Filter button names the active filter
  const sort=params.get('sort')||'';[...optmenu.querySelectorAll('[data-sort]')].forEach(r=>r.classList.toggle('on',(r.dataset.sort||'')===sort));
  fitrow.classList.toggle('on',params.get('fit')==='cover');}
// filter chips + sheet Show buttons -> ?show (and exit /watch back to the grid); close the sheet after a sheet pick
[...document.querySelectorAll('[data-show]')].forEach(c=>c.onclick=()=>{const v=c.dataset.show;if(v){params.set('show',v);savePref('show',v);}else{params.delete('show');savePref('show','');}nav('/');syncBar();closeSheet();});
// options sheet opens from either the desktop Options button or the mobile Filter button.
// One open/close path so the scrim, body state, and any in-progress swipe always stay in sync.
function openSheet(){optmenu.style.transform='';optmenu.classList.add('open');document.body.classList.add('sheet-open');}
function closeSheet(){optmenu.classList.remove('open');document.body.classList.remove('sheet-open');optmenu.style.transform='';buzz(6);}
function toggleSheet(e){if(e)e.stopPropagation();optmenu.classList.contains('open')?closeSheet():openSheet();}
optbtn.onclick=toggleSheet;
filterbtn.onclick=toggleSheet;
scrim.onclick=closeSheet;                                                   // tap the dimmed backdrop to dismiss
document.addEventListener('click',e=>{if(optmenu.classList.contains('open')&&!optmenu.contains(e.target)&&!optbtn.contains(e.target)&&!filterbtn.contains(e.target))closeSheet();});
// swipe the grab handle down to dismiss (mobile bottom-sheet gesture); release past ~90px commits, else it springs back
// Swipe down anywhere on the sheet to dismiss. A drag only begins after ~8px of
// downward movement, so taps on rows still register; armed only when the sheet is
// scrolled to its top so it never fights native scroll on a short viewport.
(function(){let sy=0,dy=0,armed=false,drag=false,pid=null;
  optmenu.addEventListener('pointerdown',e=>{if(optmenu.scrollTop>0)return;
    if(e.target.closest('button,a,input,.mrow,.showseg,.miniseg,.swt'))return;   // never arm the dismiss-drag on a control — a tap's micro-roll would capture the pointer and eat the item's click
    sy=e.clientY;dy=0;armed=true;drag=false;pid=e.pointerId;});
  optmenu.addEventListener('pointermove',e=>{if(!armed||e.pointerId!==pid)return;dy=e.clientY-sy;
    if(dy<=0){if(!drag)armed=false;return;}
    if(!drag&&dy>8){drag=true;optmenu.classList.add('dragging');try{optmenu.setPointerCapture(pid);}catch(_){}}
    if(drag){e.preventDefault();optmenu.style.transform='translateY('+dy+'px)';}},{passive:false});
  function end(){if(!armed)return;armed=false;if(drag){drag=false;optmenu.classList.remove('dragging');if(dy>90)closeSheet();else optmenu.style.transform='';}}
  optmenu.addEventListener('pointerup',end);optmenu.addEventListener('pointercancel',end);})();
[...optmenu.querySelectorAll('[data-sort]')].forEach(r=>r.onclick=()=>{const v=r.dataset.sort;if(v){params.set('sort',v);savePref('sort',v);}else{params.delete('sort');savePref('sort','');}history.replaceState({},'',location.pathname+qstr());applyGrid();syncBar();});
fitrow.onclick=()=>{const on=!document.body.classList.contains('fit-cover');document.body.classList.toggle('fit-cover',on);if(on){params.set('fit','cover');savePref('fit','cover');}else{params.delete('fit');savePref('fit','');}history.replaceState({},'',location.pathname+qstr());syncBar();};
activerow.onclick=()=>{closeSheet();nav('/active');};
document.getElementById('reloadrow').onclick=()=>{closeSheet();buzz(15);location.reload();};   // hard reload: fresh fetch of app + latest build
// Settings: mute/unmute "needs you" notifications (persisted)
const notifrow=document.getElementById('notifrow');
notifrow.classList.toggle('on',notifOn);
notifrow.onclick=()=>{notifOn=!notifOn;try{localStorage.setItem('notif',notifOn?'1':'0');}catch(_){}notifrow.classList.toggle('on',notifOn);buzz(10);
  if(notifOn&&'Notification' in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});};
// Settings: wipe everything this device remembers, then start fresh
document.getElementById('clearrow').onclick=()=>{closeSheet();
  if(!confirm('Clear all saved names, pins, tile order, preferences, and last view on this device?'))return;
  ['order','pins','names','cols','route','pref_show','pref_sort','pref_fit','notif','seenhint'].forEach(k=>{try{localStorage.removeItem(k);}catch(_){}});
  buzz(20);location.href='/';};
selbtn.onclick=()=>{if(reorderMode)setReorder(false);selectMode=!selectMode;document.body.classList.toggle('select',selectMode);selbtn.classList.toggle('on',selectMode);if(!selectMode){selSet.clear();[...tiles.values()].forEach(x=>x.el.classList.remove('sel'));watchfab.classList.remove('show');}};
selrow.onclick=()=>{closeSheet();selbtn.onclick();};   // sheet Select row reuses the select toggle
function setReorder(on){reorderMode=on;document.body.classList.toggle('reorder',on);buzz(on?20:8);}  // edit mode: tiles own the touch so drag-reorder never fights scroll
reorderrow.onclick=()=>{closeSheet();if(selectMode)selbtn.onclick();setReorder(true);};
donebtn.onclick=()=>setReorder(false);
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
  if(notifOn && 'Notification' in window && Notification.permission==='granted'){
    for(const s of list) if(s.needs && !prevNeeds.has(s.id)) try{new Notification('Needs you · '+(s.title||s.id),{body:domainOf(s.url),icon:'/icon-192.png',tag:s.id});}catch(_){}
  }
  prevNeeds=cur;
}
// keep the phone awake while watching; re-acquire when returning to the tab
let wl=null;async function lockWake(){try{if('wakeLock' in navigator&&!document.hidden)wl=await navigator.wakeLock.request('screen');}catch(_){}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)lockWake();});
// ask for notification permission + wake lock on the first interaction (browsers require a gesture)
addEventListener('pointerdown',function once(){if(notifOn&&'Notification' in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});lockWake();removeEventListener('pointerdown',once);},{once:true});

// one-time first-run tip (re-appears after "Clear saved data" since it clears 'seenhint')
const hint=document.getElementById('hint'),hintok=document.getElementById('hintok');
hintok.onclick=()=>{hint.classList.remove('show');try{localStorage.setItem('seenhint','1');}catch(_){}};
(function(){let seen=true;try{seen=!!localStorage.getItem('seenhint');}catch(_){}if(seen||embed)return;
  setTimeout(()=>{if(!focus.classList.contains('on')&&!document.body.classList.contains('select')&&!document.body.classList.contains('reorder'))hint.classList.add('show');},1000);})();

// pull-to-refresh: PWA standalone kills the native gesture, so own it on the grid — re-poll + reconnect the stream
(function(){
  const ptr=document.getElementById('ptr'); const TH=70; let sy=0,dist=0,pulling=false,refreshing=false;
  const canPull=()=>!refreshing&&window.scrollY<=0&&!focus.classList.contains('on')&&!optmenu.classList.contains('open')&&!document.body.classList.contains('select')&&!document.body.classList.contains('reorder');
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

// reopen where you left off: a bare cold launch ('/') returns to your last view; an explicit link/path always wins.
// reflect seeded prefs into the address too so the URL stays shareable.
(function(){let t=location.pathname;if(t==='/'){let r;try{r=localStorage.getItem('route');}catch(_){}if(r)t=r;}history.replaceState({},'',t+qstr());})();
render();
openFeed();
lockWake();
poll();setInterval(poll,3000);
</script></body></html>`;

const MANIFEST = JSON.stringify({
  name: 'Agent Browsers', short_name: 'Agents',
  id: '/', start_url: '/', scope: '/', lang: 'en', dir: 'ltr',
  description: 'Mission control for AI-driven browsers — watch a whole fleet of Playwright/CDP browsers live from your phone.',
  display: 'standalone', display_override: ['standalone', 'minimal-ui'],
  background_color: '#0b0b0b', theme_color: '#0b0b0b', orientation: 'any',
  categories: ['productivity', 'utilities', 'developer'],
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ],
  screenshots: [
    { src: '/screenshot-wide.png', sizes: '1389x868', type: 'image/png', form_factor: 'wide', label: 'Live grid of agent browsers' },
    { src: '/screenshot-narrow.png', sizes: '390x844', type: 'image/png', form_factor: 'narrow', label: 'Watch the fleet from your phone' }
  ],
  shortcuts: [
    { name: 'Most active session', short_name: 'Active', url: '/active' },
    { name: 'All browsers', short_name: 'Grid', url: '/' }
  ]
});
// Network-FIRST service worker. BUILD is the version — clients check for it every 60s and auto-reload (controllerchange),
// so navigations always fetch the latest HTML online (self-update intact). The shell is cached only as an OFFLINE
// fallback: if the server is unreachable, the PWA still opens to the app (which then shows the "Reconnecting…" banner)
// instead of a dead white screen. Live data/streams (/api/*) always bypass the cache.
const SW_VER = BUILD;
const SW = `const V='${SW_VER}';const SHELL='shell-'+V;const ASSETS=['/','/manifest.webmanifest','/icon-192.png','/icon-512.png','/icon-maskable-512.png'];
self.addEventListener('install',e=>{e.waitUntil((async()=>{try{const c=await caches.open(SHELL);await c.addAll(ASSETS);}catch(_){}await self.skipWaiting();})());});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==SHELL)await caches.delete(k);await self.clients.claim();})());});
self.addEventListener('fetch',e=>{const req=e.request;if(req.method!=='GET')return;const url=new URL(req.url);if(url.pathname.indexOf('/api/')===0)return;
  if(req.mode==='navigate'){e.respondWith((async()=>{try{return await fetch(req);}catch(_){const c=await caches.open(SHELL);return (await c.match('/'))||Response.error();}})());return;}
  e.respondWith((async()=>{const c=await caches.open(SHELL);const hit=await c.match(req);if(hit)return hit;try{const r=await fetch(req);if(r&&r.ok)c.put(req,r.clone());return r;}catch(_){return hit||Response.error();}})());});`;

// Control is real input, so guard /api/input. The dangerous vector is a malicious web page
// open inside a watched browser scripting fetch() at the dashboard; such a request carries a
// public Origin, so we allow only local/tailnet origins (loopback, *.ts.net, tailscale CGNAT,
// private LAN). No Origin header (non-browser client) is allowed; set TOKEN to gate those too.
// pure same-origin guard + security headers live in src/security.cjs (unit-tested); bundled inline by the build step
const { isLocalOrigin, SECURITY_HEADERS } = __mod_security;
function localOrigin(req) { return isLocalOrigin(req.headers.origin); }
function reqToken(req) {
  try { const q = new URL(req.url, 'http://x').searchParams.get('token'); if (q) return q; } catch {}
  if (req.headers['x-token']) return req.headers['x-token'];
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)abm_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function authed(req) { return !TOKEN || reqToken(req) === TOKEN; }

const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  for (const k in SECURITY_HEADERS) res.setHeader(k, SECURITY_HEADERS[k]); // nosniff + no-referrer on every response (writeHead merges, never overrides)
  // optional shared-secret gate: ?token=… sets a year-long cookie, then the device is unlocked
  if (TOKEN) {
    let q = ''; try { q = new URL(req.url, 'http://x').searchParams.get('token') || ''; } catch {}
    if (q === TOKEN) {
      res.writeHead(302, { 'Set-Cookie': `abm_token=${encodeURIComponent(TOKEN)}; Path=/; Max-Age=31536000; SameSite=Lax`, 'Location': u });
      res.end(); return;
    }
    if (!authed(req)) {
      res.writeHead(401, { 'Content-Type': 'text/html' });
      res.end('<meta name=viewport content="width=device-width,initial-scale=1"><body style="font:16px system-ui;background:#0f1115;color:#e6e6ea;padding:42px"><h2>Agent Browsers</h2><p>This dashboard is locked. Open it once with <code>?token=YOUR_TOKEN</code> to unlock this device.</p></body>');
      return;
    }
  }
  if (req.method === 'POST' && u === '/api/input') {     // Path A: light click/type into the focused session
    if (!localOrigin(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"err":"origin"}'); return; }
    let body = ''; req.on('data', c => { body += c; if (body.length > 16384) req.destroy(); });
    req.on('end', () => { let j = null; try { j = JSON.parse(body); } catch {} const ok = !!(j && dispatchInput(j)); res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' }); res.end(`{"ok":${ok}}`); });
    return;
  }
  if (req.method === 'POST' && u === '/api/kill') {     // close (kill) a watched session — same-origin guarded, like /api/input
    if (!localOrigin(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"err":"origin"}'); return; }
    let body = ''; req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => { let j = null; try { j = JSON.parse(body); } catch {} const ok = !!(j && j.slug && killSession(j.slug)); res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' }); res.end(`{"ok":${ok}}`); });
    return;
  }
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
  } else if (u === '/screenshot-wide.png' || u === '/screenshot-narrow.png') {
    const file = u === '/screenshot-wide.png' ? 'hero-desktop.png' : 'hero-mobile.png';   // PWA install-card screenshots
    try { const b = fs.readFileSync(path.join(__dirname, 'docs', file)); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' }); res.end(b); }
    catch { res.writeHead(404); res.end(); }
  } else {
    // always revalidate the app shell so a server restart is picked up on the next load (the stream is online-only anyway)
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(GRID); // catch-all: /, /{slug}, /watch/.., /embed/.., /active
  }
});
server.listen(BIND_PORT, BIND_HOST, () => console.log(`[grid] on http://${BIND_HOST}:${BIND_PORT}  (tile ${TILE.maxWidth}q${TILE.quality}, hq ${HQ.maxWidth}q${HQ.quality})`));
