// test/slug.test.cjs — zero-dep tests for slug + port-parse helpers. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const { slugify, deriveSlug, parsePorts } = require('../src/slug.cjs');

test('slugify: lowercases, hyphenates, trims', () => {
  assert.equal(slugify('Hello World!'), 'hello-world');
  assert.equal(slugify('  --Foo__Bar--  '), 'foo-bar');
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
});
test('slugify: caps at 40 chars', () => {
  assert.equal(slugify('a'.repeat(60)).length, 40);
});

test('deriveSlug: plain domain → second-level label', () => {
  assert.equal(deriveSlug('https://www.github.com/foo', ''), 'github');
  assert.equal(deriveSlug('https://app.example.com/x', 'Title'), 'example');
});
test('deriveSlug: multi-label public suffix → label before suffix', () => {
  assert.equal(deriveSlug('https://my-app.pages.dev/', ''), 'my-app');
  assert.equal(deriveSlug('https://thing.workers.dev/', ''), 'thing');
  assert.equal(deriveSlug('https://repo.github.io/', ''), 'repo');
});
test('deriveSlug: localhost / IP fall back to title', () => {
  assert.equal(deriveSlug('http://localhost:3000/', 'My Dashboard'), 'my-dashboard');
  assert.equal(deriveSlug('http://127.0.0.1:8090/', 'Grid View'), 'grid-view');
});
test('deriveSlug: about:blank yields empty', () => {
  assert.equal(deriveSlug('about:blank', 'about:blank'), '');
  assert.equal(deriveSlug('', ''), '');
});
test('deriveSlug: garbage URL falls back to title', () => {
  assert.equal(deriveSlug('not a url', 'Fallback Title'), 'fallback-title');
});

test('parsePorts: dedupes, numeric-only, whitespace-split', () => {
  assert.deepEqual(parsePorts('9222 9223 9222\n9224'), [9222, 9223, 9224]);
  assert.deepEqual(parsePorts(''), []);
  assert.deepEqual(parsePorts(null), []);
  assert.deepEqual(parsePorts('abc 9222 x9223 9224'), [9222, 9224]);
});
