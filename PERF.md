# Performance & scaling — Agent Browser Monitor

Measured 2026-06-19. Reproduce the CPU numbers with `node bench/perf.cjs [tiles] [seconds]`.

## TL;DR

- **CPU is never the bottleneck.** The per-frame server work (rate-cap + fan-out decision in
  `src/cdp.cjs reduceTileMessage`) costs **~0.7 CPU-ms per second of full-rate input across 40 tiles**
  (6.8M messages/s throughput). No CPU runaway at any realistic tile count.
- **Egress is the only real limit.** It is governed entirely by the per-tile rate-cap and the JPEG
  size/quality knobs. Pick knobs for your link.

## Measured

### Hot-path CPU (synthetic, real reducer code)
`node bench/perf.cjs 40 5` — 40 tiles, each fed at 120 fps for 5 virtual seconds:

| tiles | msgs processed | throughput   | CPU time | forwards after cap | verdict |
|------:|---------------:|-------------:|---------:|-------------------:|---------|
| 40    | 24,000         | 6.8M msg/s   | 3.5 ms   | 11.8 fps/tile      | no runaway |
| 30    | 18,000         | 6.3M msg/s   | 2.8 ms   | 11.8 fps/tile      | no runaway |

Every frame is acked; the rate-cap collapses a 120 fps source to the **12.5 fps/tile ceiling**
(`1000 / TILE_MIN_MS`) regardless of how fast Chrome emits.

### Live egress (real server, real browsers)
Sampled `/api/feed` for 10 s at 9 live tiles (mixed idle / lightly-animating chat pages):

- **705 KB/s total → ~78 KB/s per tile** (base64-over-SSE; ~1–1.5 effective fps/tile at the idle floor).
- Linear extrapolation, same per-tile mix: **30 tiles ≈ 2.3 MB/s, 40 tiles ≈ 3.1 MB/s.**

### Worst case — every tile animating at the cap
| preset | TILE_MIN_MS | frame size | 30 tiles | 40 tiles |
|--------|------------:|-----------:|---------:|---------:|
| **default** (800px, q55) | 80  | ~25 KB | ~8.9 MB/s | ~11.8 MB/s |
| **phone-link** (640px, q42) | 160 | ~12 KB | ~2.1 MB/s | ~2.8 MB/s |

## The knobs (all env vars, read at startup)

| Env | Default | Effect |
|-----|--------:|--------|
| `TILE_MIN_MS` | 80 | Per-tile push rate-cap in ms. Higher = fewer frames/s/tile = less egress. `160` → 6.3 fps/tile. |
| `TILE_Q` | 55 | Tile JPEG quality (1–100). Lower = smaller frames. `42` ≈ half the bytes. |
| `TILE_W` / `TILE_H` | 800 / 500 | Tile capture max dimensions. Smaller = fewer bytes. |
| `HQ_Q` / `HQ_W` / `HQ_H` | 82 / 1920 / 1200 | The on-demand focus stream (one at a time) — does not scale with tile count. |
| `STUCK_MS` | 25000 | Unrelated to egress (hang detection); listed for completeness. |

The idle floor (~1.4 fps/tile re-send so a tile never goes blank) and the idle-recapture sweep
(~0.8 fps for a still page) are the baseline cost for an *idle* wall; animating tiles ride the cap.

## Recommended presets

**Desktop / LAN (default):** ship as-is. CPU trivial, egress irrelevant on a wired/wifi link.

**Phone link at 30–40 tiles:** start the server with
```
TILE_MIN_MS=160 TILE_Q=42 TILE_W=640 TILE_H=400 node grid.cjs
```
→ worst-case all-animating **≤ ~2.8 MB/s at 40 tiles**, typical mixed-idle wall **well under 1.5 MB/s** —
inside a healthy mobile-data budget. Drop `TILE_Q=35` / raise `TILE_MIN_MS=220` for a constrained link.

## Limits / honest caveats

- Egress is **per connected client**: the feed is multiplexed, so two phones watching the same wall
  roughly double upstream from the server. Fine on a LAN; on a metered uplink, size for your viewers.
- The numbers above assume independent, fully-animating tiles for worst case — a deliberately
  pessimistic bound. Real agent browsers are idle most of the time, so observed egress tracks the
  ~78 KB/s/tile live figure far more than the worst-case row.
- Not yet optimized: the idle floor re-sends a full frame even when the image is unchanged. A
  content-hash dedupe on the floor re-send would cut idle-wall egress further — tracked as a follow-up.
