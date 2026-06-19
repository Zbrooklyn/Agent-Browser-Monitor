// test/version.test.cjs — zero-dep tests for the update-check semver compare. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const { parseVer, isNewer } = require('../src/version.cjs');

test('parseVer strips v + prerelease, coerces parts', () => {
  assert.deepEqual(parseVer('v2.10.0'), [2, 10, 0]);
  assert.deepEqual(parseVer('2.2.0-beta.1'), [2, 2, 0]);
  assert.deepEqual(parseVer('2.1'), [2, 1]);
  assert.deepEqual(parseVer(''), [0]);
});

test('isNewer: a strictly newer than b', () => {
  assert.equal(isNewer('2.2.0', '2.1.0'), true);
  assert.equal(isNewer('v2.2.0', '2.1.0'), true);   // tag with v prefix
  assert.equal(isNewer('2.10.0', '2.9.0'), true);   // numeric, not lexical
  assert.equal(isNewer('3.0.0', '2.9.9'), true);
  assert.equal(isNewer('2.1.1', '2.1'), true);      // shorter side padded
});

test('isNewer: equal or older is NOT newer', () => {
  assert.equal(isNewer('2.1.0', '2.1.0'), false);
  assert.equal(isNewer('2.1', '2.1.0'), false);     // 2.1 == 2.1.0
  assert.equal(isNewer('2.0.0', '2.1.0'), false);
  assert.equal(isNewer('2.9.0', '2.10.0'), false);
  assert.equal(isNewer('', '2.1.0'), false);        // unknown latest never triggers an update
});

test('isNewer: a prerelease of a higher version still reads newer (core compared)', () => {
  assert.equal(isNewer('2.2.0-beta', '2.1.0'), true);
});
