// src/version.cjs — pure semver compare for the update check (NO side effects, requireable by tests).
// Bundled inline into grid.cjs by the build step.

// "v2.10.0" / "2.2.0-beta" → [2,10,0] (strips a leading v and any -prerelease suffix, non-numeric parts → 0)
function parseVer(v) {
  return String(v || '').trim().replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
}

// true iff version `a` is strictly newer than `b` (component-wise, shorter side padded with 0s)
function isNewer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

module.exports = { parseVer, isNewer };
