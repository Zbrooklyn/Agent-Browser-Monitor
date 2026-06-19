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
