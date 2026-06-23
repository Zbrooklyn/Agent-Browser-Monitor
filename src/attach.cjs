// src/attach.cjs — PURE: the ordered CDP commands the monitor sends when it attaches to a
// watched browser.
//
// INVARIANT: a monitor OBSERVES; it never reshapes what it observes. Every CDP command that
// mutates the watched page is gated behind an explicit opt-in, so the DEFAULT attach is strictly
// read-only (enable + screencast + a seed screenshot). This is the single source of truth that
// test/passivity.test.cjs asserts against — if anyone adds a mutating command to the default
// path, that test fails. (Pure + unit-tested; bundled inline by build.cjs.)

// CDP methods that change the watched browser's state. Sending any of these makes the monitor
// INVASIVE: it can fight an automation client (Playwright/Puppeteer) that manages the same page,
// which shows up as the watched page flickering, zooming, or behaving differently under test.
const MUTATING = new Set([
  'Emulation.setDeviceMetricsOverride',  // forces viewport → fights the page's own viewport (flicker/zoom)
  'Emulation.clearDeviceMetricsOverride',
  'Emulation.setFocusEmulationEnabled',  // forces document.hasFocus()===true → breaks focus-dependent behaviour
  'Page.setWebLifecycleState',           // forces active/frozen lifecycle → overrides the page's real state
  'Page.close',                          // closes the target
  'Input.dispatchMouseEvent',            // synthetic input (intentional, user-driven Control mode only)
  'Input.dispatchKeyEvent',
  'Input.insertText',
]);
function isMutating(method) { return MUTATING.has(method); }

// opts:
//   tile / hq : the Page.startScreencast params object for that stream
//   tileQ / hqQ : seed-screenshot JPEG quality
//   keepAlive : force focus-emulation + active lifecycle so a BACKGROUNDED tab keeps rendering
//               (Chrome throttles unfocused tabs). MUTATES the page — only safe for plain,
//               non-automated browsers. Off by default.
//   viewportFix + viewW/viewH : render the page at a fixed desktop viewport so a small/narrow
//               window streams the whole page. MUTATES the page — fights automation. Off by default.
function pushOptInMutations(cmds, opts) {
  if (opts.keepAlive) {
    cmds.push({ method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } });
    cmds.push({ method: 'Page.setWebLifecycleState', params: { state: 'active' } });
  }
  if (opts.viewportFix) {
    cmds.push({ method: 'Emulation.setDeviceMetricsOverride', params: { width: opts.viewW, height: opts.viewH, deviceScaleFactor: 1, mobile: false } });
  }
}

function tileAttach(opts = {}) {
  const cmds = [
    { method: 'Page.enable' },
    { method: 'Page.getFrameTree' },
    { method: 'Runtime.evaluate', params: { expression: 'document.readyState', returnByValue: true } }, // read-only load probe
  ];
  pushOptInMutations(cmds, opts);
  cmds.push({ method: 'Page.startScreencast', params: opts.tile || {} });
  cmds.push({ method: 'Page.captureScreenshot', params: { format: 'jpeg', quality: opts.tileQ } }); // seed: a static page emits no screencast frames
  return cmds;
}

function focusAttach(opts = {}) {
  const cmds = [{ method: 'Page.enable' }];
  pushOptInMutations(cmds, opts);
  cmds.push({ method: 'Page.startScreencast', params: opts.hq || {} });
  cmds.push({ method: 'Page.captureScreenshot', params: { format: 'jpeg', quality: opts.hqQ } });
  cmds.push({ method: 'Page.getLayoutMetrics' }); // read-only: real viewport size for click mapping
  return cmds;
}

module.exports = { MUTATING, isMutating, tileAttach, focusAttach };
