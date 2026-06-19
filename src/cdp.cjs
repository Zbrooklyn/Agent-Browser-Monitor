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
