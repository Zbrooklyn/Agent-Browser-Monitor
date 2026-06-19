#!/usr/bin/env node
// build.cjs — zero-dependency bundler: modular source (grid.src.cjs + src/*.cjs) → single self-contained grid.cjs.
// Inlines every `require('./src/NAME.cjs')` so the shipped artifact carries zero external deps and deploys as one file.
// Run: node build.cjs   (or: npm run build)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ENTRY = path.join(ROOT, 'grid.src.cjs');
const OUT = path.join(ROOT, 'grid.cjs');
const REQ = /require\((['"])\.\/src\/([\w.-]+?)(?:\.cjs)?\1\)/g; // matches require('./src/state.cjs') and ./src/state

function moduleVar(name) { return '__mod_' + name.replace(/[^\w]/g, '_'); }

function inlineModule(name) {
  const file = path.join(ROOT, 'src', name.endsWith('.cjs') ? name : name + '.cjs');
  let body = fs.readFileSync(file, 'utf8');
  if (REQ.test(body)) { REQ.lastIndex = 0; throw new Error(`nested src/ require in ${name} — bundler is one level deep; flatten or extend build.cjs`); }
  // wrap the module so its `module.exports = …` resolves into a single value, evaluated once
  return `const ${moduleVar(name)} = (() => { const module = { exports: {} }; const exports = module.exports;\n${body}\nreturn module.exports; })();`;
}

function build() {
  const entry = fs.readFileSync(ENTRY, 'utf8');
  const needed = new Map(); // name(no ext) -> true
  let m;
  while ((m = REQ.exec(entry))) needed.set(m[2], true);
  REQ.lastIndex = 0;

  const inlined = [...needed.keys()].map(inlineModule).join('\n\n');
  const transformed = entry.replace(REQ, (_full, _q, name) => moduleVar(name));

  const banner =
    `// grid.cjs — BUILT ARTIFACT. Do not edit by hand.\n` +
    `// Source: grid.src.cjs + src/*.cjs. Regenerate with: node build.cjs\n` +
    `// Single self-contained file, zero external dependencies.\n`;

  const out = banner + (inlined ? '\n' + inlined + '\n\n' : '\n') + transformed;
  fs.writeFileSync(OUT, out);
  console.log(`[build] grid.cjs ← grid.src.cjs + ${needed.size} module(s): ${[...needed.keys()].join(', ') || '(none)'}  (${out.length} bytes)`);
}

build();
