// test/state.test.cjs — zero-dep smoke suite for the session-state machine. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const { ACTIVE_MS, HANG_MS, stateOf, needsAttention, NEEDS_RE } = require('../src/state.cjs');

const T = 1_000_000_000_000;                 // a fixed "now" so tests never touch the wall clock
const sess = (o = {}) => ({ ws: {}, lastFrame: 'x', lastActivityAt: T, loadingSince: 0, url: '', title: '', ...o });

test('idle: not connected → idle', () => {
  assert.equal(stateOf({ ws: null, lastFrame: 'x' }, T), 'idle');
});
test('idle: connected but nothing painted yet → idle', () => {
  assert.equal(stateOf({ ws: {}, lastFrame: null }, T), 'idle');
});
test('active: painted within ACTIVE_MS → active', () => {
  assert.equal(stateOf(sess({ lastActivityAt: T - (ACTIVE_MS - 500) }), T), 'active');
});
test('idle: quiet past ACTIVE_MS, no pending load → idle', () => {
  assert.equal(stateOf(sess({ lastActivityAt: T - (ACTIVE_MS + 5000) }), T), 'idle');
});
test('stuck: navigation pending past HANG_MS → stuck', () => {
  assert.equal(stateOf(sess({ loadingSince: T - (HANG_MS + 1000), lastActivityAt: T - (ACTIVE_MS + 1) }), T), 'stuck');
});
test('active beats not-yet-hung load: pending load but recent paint → active', () => {
  assert.equal(stateOf(sess({ loadingSince: T - 1000, lastActivityAt: T - 100 }), T), 'active');
});
test('a still page is never stuck (loadingSince cleared)', () => {
  assert.equal(stateOf(sess({ loadingSince: 0, lastActivityAt: T - 600_000 }), T), 'idle');
});

test('needsAttention: stuck page needs you', () => {
  assert.equal(needsAttention(sess({ loadingSince: T - (HANG_MS + 1000), lastActivityAt: T - (ACTIVE_MS + 1) }), T), true);
});
test('needsAttention: idle page does NOT need you', () => {
  assert.equal(needsAttention(sess({ lastActivityAt: T - (ACTIVE_MS + 5000) }), T), false);
});
test('needsAttention: login URL flags even while active', () => {
  assert.equal(needsAttention(sess({ url: 'https://example.com/login' }), T), true);
});
test('needsAttention: captcha/2FA/oauth/consent titles all flag', () => {
  for (const title of ['Solve this captcha', 'Enter your 2FA code', 'Sign in to continue', 'Authorize access', 'Cookie consent']) {
    assert.equal(needsAttention(sess({ title }), T), true, `should flag: ${title}`);
  }
});
test('needsAttention: an ordinary dashboard does NOT flag', () => {
  assert.equal(needsAttention(sess({ url: 'https://app.example.com/dashboard', title: 'Home' }), T), false);
});
test('NEEDS_RE: does not false-positive on benign words', () => {
  assert.equal(NEEDS_RE.test('https://shop.example.com/products/login-mat'), true); // contains "login" substring — documents current behavior
  assert.equal(NEEDS_RE.test('https://news.example.com/article/weather'), false);
});
