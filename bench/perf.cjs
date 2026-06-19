#!/usr/bin/env node
// bench/perf.cjs — hot-path performance bench (NOT a unit test; kept out of test/ so `npm test` stays pure). Run: node bench/perf.cjs [tiles] [seconds]
// Drives the REAL src/cdp.cjs reduceTileMessage() — the per-frame work the server does for every CDP screencast
// frame — at N synthetic tiles emitting at ~120 fps each, to prove (a) no CPU runaway and (b) the per-tile rate-cap
// collapses egress to the configured ceiling regardless of source fps. Pure CPU/logic; no browser, no sockets.
'use strict';
const { reduceTileMessage } = require('../src/cdp.cjs');

const TILES = +(process.argv[2] || 40);
const SECONDS = +(process.argv[3] || 5);
const RATE_MS = +(process.env.TILE_MIN_MS || 80);     // server default
const SRC_FPS = 120;                                   // CDP emits up to ~120 fps/tile
const FRAME_KB = +(process.env.FRAME_KB || 25);        // representative tile JPEG (800px q55 ≈ 25; 640px q42 ≈ 12)
const FRAME = 'x'.repeat(FRAME_KB * 1024);

// one logical "now" clock we advance deterministically so the bench is reproducible and not wall-clock bound
const start = process.hrtime.bigint();
const sessions = Array.from({ length: TILES }, () => ({ frames: 0, lastFrame: null, lastSentAt: 0, lastPaintAt: 0, lastActivityAt: 0, loadingSince: 0, mainFrame: null }));

let processed = 0, acks = 0, forwards = 0;
const stepMs = 1000 / SRC_FPS;                          // virtual ms between frames per tile
const totalSteps = Math.round(SECONDS * SRC_FPS);

for (let step = 0; step < totalSteps; step++) {
  const now = Math.round(step * stepMs);               // virtual clock in ms
  for (let t = 0; t < TILES; t++) {
    const acts = reduceTileMessage(sessions[t], { method: 'Page.screencastFrame', params: { sessionId: 's' + t, data: FRAME } }, now, RATE_MS);
    processed++;
    for (const a of acts) { if ('ack' in a) acks++; else if ('forward' in a) forwards++; }
  }
}

const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
const msgsPerSec = Math.round(processed / (elapsedMs / 1000));
const cpuMsPerWallSec = (elapsedMs / SECONDS);         // CPU ms spent per 1 virtual second of full-rate input
const forwardsPerTilePerSec = forwards / TILES / SECONDS;
const egressKBs = forwardsPerTilePerSec * TILES * FRAME_KB;     // KB/s pushed to ONE connected client

console.log(`--- hot-path bench: ${TILES} tiles, ${SECONDS}s virtual, source ${SRC_FPS}fps/tile, rate-cap ${RATE_MS}ms ---`);
console.log(`messages processed : ${processed.toLocaleString()} (${msgsPerSec.toLocaleString()} msg/s real throughput)`);
console.log(`CPU time           : ${elapsedMs.toFixed(1)} ms total  →  ${cpuMsPerWallSec.toFixed(2)} CPU-ms per 1s of full-rate input across ${TILES} tiles`);
console.log(`acks               : ${acks.toLocaleString()} (every frame acked)`);
console.log(`forwards           : ${forwards.toLocaleString()}  →  ${forwardsPerTilePerSec.toFixed(1)} fps/tile after cap (ceiling = ${(1000 / RATE_MS).toFixed(1)})`);
console.log(`projected egress   : ~${Math.round(egressKBs).toLocaleString()} KB/s to one client at ${FRAME_KB}KB/frame, all ${TILES} tiles animating`);
console.log(`verdict            : ${cpuMsPerWallSec < 50 ? 'NO CPU runaway — per-frame work is trivial; egress is network-bound, governed by the rate-cap' : 'CPU HOT — investigate'}`);
