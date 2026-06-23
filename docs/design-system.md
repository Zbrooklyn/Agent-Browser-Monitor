# Design system — the scales

The dashboard's aesthetic is clean/minimal; this file is the *system* under it so values
stop drifting. Four scales + contrast. Converge to the nearest step; document any exception.

## 1. Radius — `--r-sm 8` · `--r-md 12` · `--r-lg 16` (+ `50%` round · `999px` pill)
Was 10 distinct corner radii (3,6,7,8,9,10,11,13,14,18). Map: 3–9 → sm · 10–14 → md · 16–18 → lg.
- sm: chips, tags, badges, segments, mini buttons, small insets
- md: buttons, tiles, inputs, menus, cards, control pills
- lg: sheets, hint/update bars, large surfaces
- round (`50%`): dots, avatars, cursor · pill (`999px`): status/live pills

## 2. Spacing — the UI's real rhythm: micro `2·3·4` · small `8·9` · **medium `11` (base)** · `14` · section `22·24·32`
NOT a 4-pt grid, and deliberately so. Audit (85 rendered els): **11px padding on 52 elements, 9px on 32** —
the layout is overwhelmingly consistent, it just rides an 11/9 rhythm rather than 4/8/16. A spacing *system* means
values cluster into a small, consistently-applied set; this one does. Snapping all 84 of those onto 4-pt to satisfy a
tool's default would churn a clean, liked, measurably-consistent UI for zero real gain (same call as the type pass).
Kept as-is. New code should reuse these steps (default medium = 11, small = 9) rather than introduce 10/12/13 twins.

## 3. Type — `11 cap · 12 sm · 13 base · 15 title · 18 lg · 22 hero` (~1.2 ratio)
Was 13 sizes incl. 12.5 / 12.8 half-pixels. Map: 10→11, 11.5→12, 12.5/12.8→13, 14/14.5→15,
17/19→18, 21→22. Weights: 550 body · 650 emphasis · 700 strong.

## 4. Color — extend tokens, kill near-duplicate hex
Keep: `--bg --panel --line --line2 --muted --live --amber --gold`.
Added: `--text:#e6e6ea` (primary) · `--dim:#cfcfd6` (secondary) · `--muted:#8a8a93` (tertiary, pre-existing) · `--surface:#0d0d10f2` (header/toolbar glass).
3-tier text system, and **every tier passes AA-normal on the real dark surface** (text ~17:1, dim ~11:1, muted 4.9–6.1:1).
Collapsed 14 stray gray literals → tokens: light (e6e6ea/e8e8ee/dcdce2)→`--text`; light-mid (cfcfd6/d4d4da/c8ccd2/c2c6cc)→`--dim`;
neutral/idle (9aa0a6×6/9a9aa3/8b8b93/8a8a93)→`--muted`. `--faint:#6b6b73` was added then dropped — its only use (the url-bar
placeholder) is small text that must pass AA, and #6b6b73 fails AA-normal (~3.6:1), so the placeholder uses `--muted` instead.
`--scrim` not added (YAGNI — single #0b0b0dcc use).
**Documented exceptions** (considered, not drift, kept literal): `#cdd6e6` cool-tinted code text in `.ecmd`; `#f0b860`
brighter amber for the on-amber-tint `#needs` button; the URL-encoded `%238a8a93` arrow inside the `#sortsel` SVG data-URI;
the standalone device-lock page (`background:#0f1115;color:#e6e6ea`) — it's a bare `<body>` served with no `:root`, so a `var()` there is undefined.

## 5. Contrast — WCAG AA on the REAL surface
Body text ≥ 4.5:1, large/secondary ≥ 3:1, measured against the actual rendered background
(dark glass surfaces), not assumed. Audit with the contrast tool, fix failures.
**Audited (grid + focus, AA):** every dashboard text element passes AA-normal on its real composited surface.
Two "fails" the tool flagged were FABRICATED — it read the `#needs` pill's `#e0a44e1f` (12%-alpha) bg as opaque `#e0a44e`;
composited over the dark header the real bg is `rgb(42,35,27)` and `#f0b860` on it is **8.69:1** (pass). One real fix:
the `--faint` url placeholder (~3.6:1) → `--muted` (4.9:1). Always composite alpha bg before trusting a contrast number.

---
## Progress
- [x] Radius scale converged + verified — rendered radii now only 8/12/16/50%/999px (was 10 distinct)
- [x] Type scale converged + verified — half-pixels (11.5/12.5/12.8/14.5) + outliers (10/19/21) snapped onto 11/12/13/14/15/17/22; no overflow, on-scale by computed style. (Kept whole-number sizes pragmatically; a rigid ratio would churn a liked UI for no gain. Icon-only buttons compute the UA 13.33px — text-less, cosmetically nil.)
- [x] Spacing audited + documented (deliberate rhythm, not churned) — measured 85 rendered elements: 11px×52 / 9px×32 = already overwhelmingly consistent on an 11/9 base. Overflow audit clean at desktop/tablet/mobile; overlaps are by-design pins. A 4-pt snap would degrade a working liked UI for tool-purity — evidence-based decision to keep the real scale (same reasoning as the type pass). Documented the actual steps so new code converges to them.
- [x] Color tokens converged + verified — 14 near-duplicate gray literals collapsed to 4 tokens (--text/--dim/--faint + --muted). Every token resolves by computed style; remaps land on intended hex (#fstatus/#ftime →#8a8a93, .urlbar →#cfcfd6, tile .d →#8a8a93). Visually verified on 8 real live sessions (grid + focus header) — no perceptible shift, chrome reads clean. 3 considered colors kept as documented exceptions.
- [x] Contrast AA audited + fixed — grid + focus, real-pixel composited (alpha bgs blended, not assumed). All dashboard text passes AA-normal on its true surface (text 17:1 / dim 11:1 / muted 4.9–6.1:1). Caught 2 tool-fabricated fails (alpha-bg mis-resolution; #needs pill is really 8.69:1). One real fix: --faint placeholder ~3.6:1 → --muted 4.9:1. --faint dropped (no AA-passing text use).
- [x] Final visual pass + committed (radius ddfc0a6 · type 43863d9 · color 7dfeb29 · contrast 854ec44, all pushed). Verified on 8 live sessions, grid + focus, desktop. **Release pending maintainer sign-off** — v2.4.0 (UI batch + design-system convergence) is staged in package.json; cutting the GitHub release fires the self-hoster update-notification, so it waits for an explicit go.
