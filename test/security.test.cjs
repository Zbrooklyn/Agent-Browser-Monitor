// test/security.test.cjs — zero-dep tests for the same-origin/CSRF guard. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const { isLocalOrigin, SECURITY_HEADERS } = require('../src/security.cjs');

test('allows trusted local/tailnet/LAN origins', () => {
  for (const o of [
    'http://127.0.0.1:8090', 'http://localhost:8090', 'http://[::1]:8090',
    'https://talkos.example.ts.net', 'https://Box.TS.NET',
    'http://100.64.0.1', 'http://100.100.100.100', 'http://100.127.255.255',
    'http://10.0.0.5', 'http://192.168.1.20', 'http://172.16.4.4', 'http://172.31.0.1',
  ]) assert.equal(isLocalOrigin(o), true, `should allow ${o}`);
});

test('rejects public / untrusted origins', () => {
  for (const o of [
    'https://evil.com', 'http://attacker.example', 'https://8.8.8.8',
    'http://100.63.0.1',   // just below CGNAT range
    'http://100.128.0.1',  // just above CGNAT range
    'http://172.15.0.1',   // just below RFC1918 172.16/12
    'http://172.32.0.1',   // just above
    'http://11.0.0.1',     // not 10/8
    'http://ts.net.evil.com', // suffix-spoof: hostname is evil.com, not *.ts.net
  ]) assert.equal(isLocalOrigin(o), false, `should reject ${o}`);
});

test('no Origin header (non-browser client) is allowed — gate with TOKEN', () => {
  assert.equal(isLocalOrigin(undefined), true);
  assert.equal(isLocalOrigin(''), true);
});

test('unparseable Origin is rejected', () => {
  assert.equal(isLocalOrigin('not a url'), false);
  assert.equal(isLocalOrigin('://'), false);
});

test('security headers are nosniff + no-referrer', () => {
  assert.equal(SECURITY_HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(SECURITY_HEADERS['Referrer-Policy'], 'no-referrer');
});
