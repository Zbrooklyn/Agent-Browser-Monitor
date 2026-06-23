// test/passivity.test.cjs — the monitor must OBSERVE, never reshape a watched browser.
// These tests assert the default attach sequence sends ZERO mutating CDP commands, and that the
// mutating ones appear ONLY when explicitly opted in. This is the regression guard for the
// flicker/zoom class of bug (a forced viewport/focus/lifecycle fighting an automation client).
// Run: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const { tileAttach, focusAttach, isMutating, MUTATING } = require('../src/attach.cjs');

const muts = (cmds) => cmds.map(c => c.method).filter(isMutating);
const methods = (cmds) => cmds.map(c => c.method);

test('tile attach is PASSIVE by default — no mutating CDP command', () => {
  assert.deepEqual(muts(tileAttach({ tile: {}, tileQ: 55 })), [],
    'default tile attach must not send any state-mutating CDP command');
});

test('focus attach is PASSIVE by default — no mutating CDP command', () => {
  assert.deepEqual(muts(focusAttach({ hq: {}, hqQ: 78 })), [],
    'default focus attach must not send any state-mutating CDP command');
});

test('default attach still OBSERVES — screencast + seed are present', () => {
  const t = methods(tileAttach({ tile: {}, tileQ: 55 }));
  assert.ok(t.includes('Page.startScreencast'), 'tile must start the screencast');
  assert.ok(t.includes('Page.captureScreenshot'), 'tile must seed a frame');
  const f = methods(focusAttach({ hq: {}, hqQ: 78 }));
  assert.ok(f.includes('Page.startScreencast'));
  assert.ok(f.includes('Page.getLayoutMetrics'), 'focus must read layout metrics for click mapping');
});

test('KEEPALIVE opt-in adds focus-emulation + lifecycle, and ONLY those', () => {
  const t = methods(tileAttach({ keepAlive: true, tile: {}, tileQ: 55 }));
  assert.ok(t.includes('Emulation.setFocusEmulationEnabled'));
  assert.ok(t.includes('Page.setWebLifecycleState'));
  assert.ok(!t.includes('Emulation.setDeviceMetricsOverride'), 'keepAlive must NOT touch the viewport');
});

test('VIEWPORT_FIX opt-in adds the viewport override, and only when asked', () => {
  assert.ok(!methods(tileAttach({ tile: {}, tileQ: 55 })).includes('Emulation.setDeviceMetricsOverride'));
  assert.ok(methods(tileAttach({ viewportFix: true, viewW: 1280, viewH: 800, tile: {}, tileQ: 55 }))
    .includes('Emulation.setDeviceMetricsOverride'));
  assert.ok(methods(focusAttach({ viewportFix: true, viewW: 1280, viewH: 800, hq: {}, hqQ: 78 }))
    .includes('Emulation.setDeviceMetricsOverride'));
});

test('opting into BOTH still emits nothing mutating beyond the three known knobs', () => {
  const m = muts(tileAttach({ keepAlive: true, viewportFix: true, viewW: 1280, viewH: 800, tile: {}, tileQ: 55 }));
  assert.deepEqual(new Set(m), new Set([
    'Emulation.setFocusEmulationEnabled', 'Page.setWebLifecycleState', 'Emulation.setDeviceMetricsOverride',
  ]));
});

test('MUTATING catalogue names the input/close commands too (defence in depth)', () => {
  for (const m of ['Input.insertText', 'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Page.close']) {
    assert.ok(MUTATING.has(m), `${m} must be classified as mutating`);
  }
});
