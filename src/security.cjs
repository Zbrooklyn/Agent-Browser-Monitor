// src/security.cjs — pure same-origin / CSRF guard (NO side effects, requireable by tests).
// Bundled inline into grid.cjs by the build step.
//
// THREAT: a malicious web page open *inside a watched browser* scripts fetch() at the dashboard's
// control endpoints (/api/input, /api/kill). A browser always attaches the page's real Origin to a
// cross-origin request, so we allow only origins on the trusted local/tailnet surface and reject the
// rest. A request with NO Origin header is a non-browser client (curl/native) — not the drive-by
// threat — and is allowed; set TOKEN to gate those too.
function isLocalOrigin(origin) {
  if (!origin) return true;                                              // non-browser client (no Origin) — gate with TOKEN if needed
  let h; try { h = new URL(origin).hostname; } catch { return false; }   // unparseable Origin → reject
  h = h.replace(/^\[|\]$/g, '');                                         // URL.hostname wraps IPv6 in [] — strip for comparison
  if (h === '127.0.0.1' || h === 'localhost' || h === '::1') return true;
  if (/\.ts\.net$/i.test(h)) return true;                                // tailscale serve hostnames
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;   // tailscale CGNAT 100.64.0.0/10
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true; // private LAN (RFC 1918)
  return false;                                                          // any public origin → reject
}

// security headers applied to every response: block MIME-sniffing and keep the dashboard URL
// (which may carry ?token=) out of Referer headers when a watched-page navigation occurs.
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

module.exports = { isLocalOrigin, SECURITY_HEADERS };
