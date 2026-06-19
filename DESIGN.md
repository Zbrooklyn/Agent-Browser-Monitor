# Design notes & audit — Agent Browser Monitor

Audited 2026-06-19 on a 390px phone (iPhone 14 emulation) and 1400px desktop, against the live
:8090 wall. Captures in the PR / shared with the maintainer. Summary: every viewport + state is
clean; the two long-standing open questions are resolved below as deliberate decisions.

## State-by-state audit

| State | Viewport | Verdict |
|-------|----------|---------|
| Grid | desktop (3-col) & phone (1-col) | **Clean.** Tiles paint real frames; LIVE/IDLE/STUCK badge, title + domain legible; header (brand · `N live` · search · filter/options) well-proportioned at 390px. |
| Options sheet (⋯) | phone | **Clean.** Show / Sort / View / Settings groups; tap targets ≥ 44px; dismiss via scrim (z-index fix shipped earlier). |
| Focus — watch | phone | **Clean.** Top bar uses a `linear-gradient(#000c,#0000)` scrim so title/URL stay legible over any page; **tap the image toggles all chrome** (immersive, line `toggleChrome`) for an unobstructed view. |
| Focus — control | phone | **Clean.** Chrome **docks** (image letterboxed between a solid top status bar and a bottom toolbar, `--ctop`/`--cbot`) so controls never cover the page — the fix for the earlier "controls block the browser" report. |
| Keyboard (control) | phone | **Clean.** `--kb` (from `visualViewport`) lifts the toolbar + page above the on-screen keyboard so the caret stays visible. |

## Resolved decisions

### 1. Tile / focus letterboxing → keep `object-fit: contain` (default)
A monitoring tool must show the **whole** page — cropping could hide exactly the alert/CTA you're
watching for. Portrait captures in a landscape tile therefore get black side-bars; that is correct,
not a defect. Users who want density flip **"Cover images"** (per-device, persisted) for
`object-fit: cover`. The letterbox background is `#000` and the image is centered — intentional and
clean. **No change.**

### 2. On-screen keyboard → shrink-to-fit (dock above keyboard), not RDP-style pan
Two options were on the table: (a) lift the page + toolbar above the keyboard so the whole (smaller)
page stays visible, or (b) keep the page full-size and let the user pan it behind the keyboard.
**Shipped (a).** On a phone monitor you want to *see the result of what you typed* without panning;
shrink-to-fit keeps the caret and the surrounding page in view with zero extra gestures. Pan adds a
mode + scroll-conflict with the existing pinch/drag handlers for no real gain. **Decided: shrink.**

## Deliberate tradeoffs (not bugs)

- Single-column phone tiles with portrait captures look sparse (big letterbox). Accepted: contain is
  correct (see #1); the Cover toggle and 2/3-column options give density when wanted.
- Focus chrome is visible by default and hidden on tap (not auto-hidden on a timer) — predictable and
  matches a photo/video-viewer mental model.
