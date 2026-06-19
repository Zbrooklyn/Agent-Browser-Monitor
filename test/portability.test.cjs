// test/portability.test.cjs — guards the zero-runtime-dependency invariant. Run: node --test
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const builtins = new Set([...builtinModules, ...builtinModules.map(m => 'node:' + m)]);

test('built grid.cjs requires only Node built-in modules (zero runtime deps)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'grid.cjs'), 'utf8');
  const specs = [...src.matchAll(/require\((['"])([^'"]+)\1\)/g)].map(m => m[2]);
  assert.ok(specs.length > 0, 'expected at least one require() in the built file');
  for (const s of specs) {
    assert.ok(!s.startsWith('.') && !s.startsWith('/'), `built artifact must be self-contained, found relative require: ${s} (run \`npm run build\`)`);
    assert.ok(builtins.has(s), `non-builtin runtime dependency in grid.cjs: ${s}`);
  }
});

test('no node_modules / no declared dependencies', () => {
  const root = path.join(__dirname, '..');
  assert.ok(!fs.existsSync(path.join(root, 'node_modules')), 'node_modules must not exist — this is a zero-dep project');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies || {}, {}, 'package.json must declare no runtime dependencies');
  assert.deepEqual(pkg.devDependencies || {}, {}, 'package.json must declare no dev dependencies');
});
