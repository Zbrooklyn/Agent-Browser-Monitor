# Architecture — Agent Browser Monitor

A zero-dependency Node server that discovers Chromium debug ports, attaches a CDP screencast to
each page, and multiplexes the frames to a phone-friendly grid dashboard (+ on-demand HD focus and
input control). One self-contained file ships; the source is modular.

## Source layout

```
grid.src.cjs     the app: discovery, CDP sockets, HTTP routes, and the inline client (HTML/CSS/JS)
src/state.cjs    pure: session state machine (idle / active / stuck / needs-attention)
src/slug.cjs     pure: slugify, deriveSlug (URL→name), parsePorts
src/cdp.cjs      pure: reduceTileMessage — the tile CDP-frame reducer (ack / forward / state)
src/security.cjs pure: isLocalOrigin (same-origin/CSRF guard) + SECURITY_HEADERS
build.cjs        bundler: inlines every require('./src/*.cjs') → single grid.cjs
grid.cjs         BUILT ARTIFACT (committed) — what you deploy/run. Do not hand-edit.
test/*.test.cjs  node --test suite (state, slug, cdp, security, portability)
bench/perf.cjs   hot-path perf bench (see PERF.md)
```

`src/*.cjs` are **pure and side-effect-free** so they're unit-testable without a browser or sockets;
`grid.src.cjs` holds everything stateful (the live Maps, sockets, timers, HTTP server).

## Build & ship

`node build.cjs` inlines each `src/*.cjs` module into a single self-contained `grid.cjs` with zero
external dependencies — modular to develop, one file (Node built-ins only) to deploy. The build is
deterministic: same inputs → byte-identical output (`.gitattributes` pins LF so it's stable across
OSes).

## Runtime data flow

```
discoverPorts() ─┬─ PORTS env override (any OS)
                 ├─ PowerShell  (win32)
                 └─ lsof        (macOS/Linux)
      │  every 5s, debounced prune (a port must miss 2 sweeps before its tile is dropped)
      ▼
bestTarget(port) → pick the real page → connect() opens a CDP WebSocket
      │
      ▼
ws.onmessage → reduceTileMessage(s, msg) ──► mutate session state + emit {ack}/{forward}
      │                                         │
      │                                         ▼
      │                              feedSend() → SSE /api/feed (one multiplexed stream, rate-capped per tile)
      ▼
stateOf(s) / needsAttention(s) → /api/sessions JSON → the grid client renders tiles
```

The HD focus stream (`hqConnect`) is a second, on-demand CDP session per watched slug — opened when a
tile is focused, torn down when it's closed, so only one high-res stream runs at a time.

## Cache / versioning

`BUILD` is a SHA-1 content hash of the running file, computed once at startup. It is the
service-worker cache version, so any change to the served app auto-busts the SW cache on the next
load — there is no hand-edited version string to forget.

## Key invariants (guarded by tests)

- **Zero runtime deps / one-file deploy** — `test/portability.test.cjs` fails if `grid.cjs` ever gains
  a relative/external `require`, or the repo declares a dependency.
- **Hot loop can't throw** — the CDP reducer is total over malformed frames (`test/cdp.test.cjs`).
- **Control is origin-guarded** — `test/security.test.cjs` covers the allow/deny surface.
