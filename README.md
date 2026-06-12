# Agent Browsers

Mission control for AI-driven browsers. When you have a fleet of Playwright / CDP
browsers doing work, this gives you one dashboard to watch them all live from your
phone, tablet, or laptop.

It is a single Node file with **zero dependencies**. It auto-discovers every Chromium
remote-debugging port on the machine, shows each as a live tile, and lets you tap into
any one for a high-resolution focused stream.

> **Watch-only today.** It streams what the browsers are doing; it does not control them.
> Interactive takeover is on the roadmap.

![Agent Browsers — watch a fleet of AI-driven browsers live from one dashboard](docs/hero-desktop.png)

<p align="center">
  <img src="docs/hero-mobile.png" width="300" alt="Agent Browsers running as a phone PWA">
  <br>
  <em>…and the same dashboard, lived in from your phone.</em>
</p>

## Why

AI agents now drive browsers headfully for hours at a time. A wall of terminal logs does
not tell you when one is stuck on a login wall, has finished, or has quietly broken.
Agent Browsers turns the fleet into a glanceable grid that tells you which ones need you.

## Features

- **Auto-discovery** — every Chromium remote-debugging port on the box becomes a live
  tile. Launch a browser, it appears; close it, it goes away.
- **One multiplexed stream** — all tiles share a single Server-Sent-Events feed, so you
  are not capped by the browser's per-host connection limit no matter how many tiles.
- **Focused high-res view** — tap a tile for a crisp 1080p+ stream: pinch-zoom, tap to
  toggle the chrome away, rotate-to-fill, swipe between sessions, keyboard nav, and
  one-tap save-frame.
- **Organize the grid** — drag to reorder (with a dedicated touch Reorder mode), pin
  favorites to the top, and rename sessions; your arrangement persists.
- **Awareness** — per-session active / idle / stuck detection, plus a "needs you" badge
  when a browser lands on a login, captcha, or auth wall.
- **Installable PWA** — add to the home screen, screen wake-lock, pull-to-refresh, and
  offscreen tiles pause to save battery and bandwidth.
- **Shareable URLs** — every session gets a stable, human-readable link (`/wikipedia`),
  plus `/watch/a+b+c` for a chosen subset and `/embed/{slug}` for a wall display.
- **Mobile-first** — designed to be lived in from a phone.

## Requirements

- **Node.js 22+** — it uses the built-in `WebSocket` global to speak CDP (available
  unflagged from Node 21; 22+ recommended). No other runtime.
- **No dependencies** — nothing to `npm install`. It is a single `.cjs` file.
- **Windows for auto-discovery (today).** Tiles are discovered by finding Chromium
  remote-debugging ports via a PowerShell query, so the zero-config auto-discovery is
  Windows-only right now. The server and streaming themselves are plain Node and run
  anywhere — only the port-discovery step is Windows-specific. (Cross-platform discovery
  is a small, isolated change in `discoverPorts()`; PRs welcome.)

## Install

No package manager and no build step — clone (or just download `grid.cjs`) and run it:

```bash
git clone https://github.com/Zbrooklyn/Agent-Browser-Monitor.git
cd Agent-Browser-Monitor
node grid.cjs
```

Open <http://127.0.0.1:8090>. Launch any Chromium with remote debugging and it shows up:

```bash
# Playwright pool / Playwright launches already expose a debug port.
# Or plain Chrome:
chrome --remote-debugging-port=9222
```

### Watch from your phone (private)

The dashboard binds to `127.0.0.1`. To reach it from your phone without opening a port,
the easy private option is [Tailscale](https://tailscale.com):

```bash
tailscale serve --bg 8090
```

That publishes it on **your tailnet only** (not the public internet) over HTTPS. Open the
printed `https://<machine>.<tailnet>.ts.net/` URL on any device on your tailnet and add it
to the home screen.

On Windows, `start-stream.ps1` / `stop-stream.ps1` wrap this: they launch the dashboard
detached (surviving the shell), set up the tailnet proxy, and print your phone URL.

## Configuration

All optional, via flags or environment variables:

```bash
node grid.cjs [host] [port]
```

| Env | Default | Meaning |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `8090` | bind address |
| `TILE_Q` / `TILE_W` / `TILE_H` | `55` / `800` / `500` | grid tile JPEG quality + max size |
| `HQ_Q` / `HQ_W` / `HQ_H` | `82` / `1920` / `1200` | focused-view JPEG quality + max size |
| `STUCK_MS` | `90000` | no visual change while live before a session is flagged "stuck" |

## How it works

- Discovers Chromium debug ports, connects to each page target over the CDP WebSocket,
  and runs `Page.startScreencast` to receive JPEG frames.
- Tiles share one SSE feed (id-tagged frames). The focused view opens a second,
  higher-quality screencast on demand, seeded with `Page.captureScreenshot` so a static
  page is never blank.
- Pure Node: a built-in `WebSocket` client speaks CDP, an `http` server serves the app
  and the streams. No build step, no `node_modules`.

## Security

- **Watch-only.** There is no input path to the browsers.
- Binds to `127.0.0.1`. Nothing is exposed until you choose to. A tailnet via
  `tailscale serve` is the recommended private option. **Do not put it on the public
  internet** — the stream has no authentication.

## Roadmap

- Interactive takeover: pause the agent, drive the browser yourself, hand back.
- Multi-tab drill-in and multi-machine discovery.
- Smoother streaming: higher frame rate, then real video / WebRTC.

## License

MIT
