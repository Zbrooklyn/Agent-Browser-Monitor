// test/cdp.test.cjs — zero-dep tests for the tile CDP reducer, incl. malformed frames. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const { reduceTileMessage } = require('../src/cdp.cjs');

const RATE = 80;
const T = 1_000_000_000_000;
const fresh = (o = {}) => ({ frames: 0, lastFrame: null, lastSentAt: 0, lastPaintAt: 0, lastActivityAt: 0, loadingSince: 0, mainFrame: null, ...o });

test('screencastFrame: acks + forwards + marks paint/active', () => {
  const s = fresh();
  const acts = reduceTileMessage(s, { method: 'Page.screencastFrame', params: { sessionId: 'sid7', data: 'JPEG' } }, T, RATE);
  assert.deepEqual(acts, [{ ack: 'sid7' }, { forward: 'JPEG' }]);
  assert.equal(s.frames, 1); assert.equal(s.lastFrame, 'JPEG'); assert.equal(s.lastPaintAt, T); assert.equal(s.lastActivityAt, T); assert.equal(s.lastSentAt, T);
});
test('screencastFrame: rate-cap drops the forward but still acks + keeps lastFrame fresh', () => {
  const s = fresh({ lastSentAt: T - 10 });            // < RATE since last send
  const acts = reduceTileMessage(s, { method: 'Page.screencastFrame', params: { sessionId: 'x', data: 'NEW' } }, T, RATE);
  assert.deepEqual(acts, [{ ack: 'x' }]);             // acked, NOT forwarded
  assert.equal(s.lastFrame, 'NEW');                   // freshest frame still captured for the FLOOR re-send
  assert.equal(s.lastSentAt, T - 10);                 // unchanged
});
test('MALFORMED screencastFrame with no params does not throw; acks undefined, no forward', () => {
  const s = fresh();
  let acts;
  assert.doesNotThrow(() => { acts = reduceTileMessage(s, { method: 'Page.screencastFrame' }, T, RATE); });
  assert.deepEqual(acts, [{ ack: undefined }]);
  assert.equal(s.lastFrame, null);                    // no data → nothing captured
});
test('garbage messages (null / non-object / empty) never throw, return no actions', () => {
  for (const bad of [null, undefined, 42, 'str', {}, { method: 'Unknown.event' }, { params: {} }]) {
    let acts; assert.doesNotThrow(() => { acts = reduceTileMessage(fresh(), bad, T, RATE); });
    assert.deepEqual(acts, []);
  }
});

test('frameStartedLoading on the main frame sets loadingSince', () => {
  const s = fresh({ mainFrame: 'F1' });
  reduceTileMessage(s, { method: 'Page.frameStartedLoading', params: { frameId: 'F1' } }, T, RATE);
  assert.equal(s.loadingSince, T); assert.equal(s.lastActivityAt, T);
});
test('frameStartedLoading on a SUBframe does not set loadingSince', () => {
  const s = fresh({ mainFrame: 'F1' });
  reduceTileMessage(s, { method: 'Page.frameStartedLoading', params: { frameId: 'SUB' } }, T, RATE);
  assert.equal(s.loadingSince, 0);
});
test('frameStoppedLoading / loadEventFired clear loadingSince', () => {
  const s1 = fresh({ mainFrame: 'F1', loadingSince: T - 5000 });
  reduceTileMessage(s1, { method: 'Page.frameStoppedLoading', params: { frameId: 'F1' } }, T, RATE);
  assert.equal(s1.loadingSince, 0);
  const s2 = fresh({ loadingSince: T - 5000 });
  reduceTileMessage(s2, { method: 'Page.loadEventFired', params: {} }, T, RATE);
  assert.equal(s2.loadingSince, 0);
});
test('frameNavigated (top frame) learns mainFrame', () => {
  const s = fresh();
  reduceTileMessage(s, { method: 'Page.frameNavigated', params: { frame: { id: 'TOP' } } }, T, RATE);
  assert.equal(s.mainFrame, 'TOP');
});
test('frameNavigated of a subframe (has parentId) is ignored', () => {
  const s = fresh({ mainFrame: 'TOP' });
  reduceTileMessage(s, { method: 'Page.frameNavigated', params: { frame: { id: 'KID', parentId: 'TOP' } } }, T, RATE);
  assert.equal(s.mainFrame, 'TOP');
});
test('captureScreenshot seed forwards without bumping paint/active (stays idle)', () => {
  const s = fresh({ lastActivityAt: 0, lastPaintAt: 0 });
  const acts = reduceTileMessage(s, { id: 9, result: { data: 'SEED' } }, T, RATE);
  assert.deepEqual(acts, [{ forward: 'SEED' }]);
  assert.equal(s.lastFrame, 'SEED'); assert.equal(s.lastSentAt, T);
  assert.equal(s.lastPaintAt, 0); assert.equal(s.lastActivityAt, 0);   // deliberately untouched → still classifies idle
});
test('getFrameTree reply learns the top frame', () => {
  const s = fresh();
  reduceTileMessage(s, { id: 2, result: { frameTree: { frame: { id: 'ROOT' } } } }, T, RATE);
  assert.equal(s.mainFrame, 'ROOT');
});
test('readyState reply: loading sets loadingSince, complete clears it', () => {
  const s1 = fresh();
  reduceTileMessage(s1, { id: 3, result: { result: { value: 'loading' } } }, T, RATE);
  assert.equal(s1.loadingSince, T);
  const s2 = fresh({ loadingSince: T - 1000 });
  reduceTileMessage(s2, { id: 3, result: { result: { value: 'complete' } } }, T, RATE);
  assert.equal(s2.loadingSince, 0);
});
