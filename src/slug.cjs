// src/slug.cjs — pure slug + port-parse helpers (NO side effects, requireable by tests).
// Bundled inline into grid.cjs by the build step. Stateful helpers (uniqueSlug, sessionBySlug)
// stay in grid.src.cjs because they read the live sessions Map.

// stable, human-readable identity from arbitrary text
function slugify(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

// multi-label public suffixes where the meaningful name is the label *before* the suffix
const PSL2 = ['pages.dev', 'github.io', 'vercel.app', 'netlify.app', 'web.app', 'workers.dev', 'herokuapp.com', 'onrender.com', 'fly.dev', 'ngrok.io', 'ngrok-free.app'];

// derive a slug from a page's URL (preferred) or title; '' when neither yields anything usable
function deriveSlug(url, title) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (h && h !== 'localhost' && !/^\d+(\.\d+)+$/.test(h) && !h.includes(':')) { // skip localhost + IPv4/IPv6
      let base;
      const suf = PSL2.find(x => h === x || h.endsWith('.' + x));
      if (suf) base = (h.slice(0, h.length - suf.length).replace(/\.$/, '').split('.').pop()) || suf.split('.')[0];
      else { const p = h.split('.'); base = p.length >= 2 ? p[p.length - 2] : h; }
      if (base && base !== 'blank') return slugify(base);
    }
  } catch {}
  const t = slugify(title); if (t && t !== 'about-blank') return t;
  return '';
}

// parse a whitespace-separated list of numeric ports into a deduped number[]
const parsePorts = (out) => [...new Set((out || '').split(/\s+/).filter(x => /^\d+$/.test(x)).map(Number))];

module.exports = { slugify, PSL2, deriveSlug, parsePorts };
