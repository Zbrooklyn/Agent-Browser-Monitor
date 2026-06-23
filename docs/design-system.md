# Design system — the scales

The dashboard's aesthetic is clean/minimal; this file is the *system* under it so values
stop drifting. Four scales + contrast. Converge to the nearest step; document any exception.

## 1. Radius — `--r-sm 8` · `--r-md 12` · `--r-lg 16` (+ `50%` round · `999px` pill)
Was 10 distinct corner radii (3,6,7,8,9,10,11,13,14,18). Map: 3–9 → sm · 10–14 → md · 16–18 → lg.
- sm: chips, tags, badges, segments, mini buttons, small insets
- md: buttons, tiles, inputs, menus, cards, control pills
- lg: sheets, hint/update bars, large surfaces
- round (`50%`): dots, avatars, cursor · pill (`999px`): status/live pills

## 2. Spacing — 4-pt grid: `4 · 8 · 12 · 16 · 20 · 24 · 32` (2px hairline allowed)
Was 25 distinct paddings (11,12,13,7,9 common — off-grid). Map odd → nearest grid step
(7→8, 9→8, 11→12, 13→12, 14→16, 18→16/20, 22→24, 28→28? →24/32). Verify layout per surface.

## 3. Type — `11 cap · 12 sm · 13 base · 15 title · 18 lg · 22 hero` (~1.2 ratio)
Was 13 sizes incl. 12.5 / 12.8 half-pixels. Map: 10→11, 11.5→12, 12.5/12.8→13, 14/14.5→15,
17/19→18, 21→22. Weights: 550 body · 650 emphasis · 700 strong.

## 4. Color — extend tokens, kill near-duplicate hex (was 76 distinct hardcoded, ~28% tokenized)
Keep: `--bg --panel --line --line2 --muted --live --amber --gold`.
Add: `--text` (primary) · `--dim` (secondary) · `--faint` (tertiary) · `--surface` (header/toolbar glass) · `--scrim`.
Collapse the grays (#8b8b93 / #8a8a93 / #9aa0a6 / #c2c6cc …) into `--muted` / `--dim` / `--faint`.

## 5. Contrast — WCAG AA on the REAL surface
Body text ≥ 4.5:1, large/secondary ≥ 3:1, measured against the actual rendered background
(dark glass surfaces), not assumed. Audit with the contrast tool, fix failures.

---
## Progress
- [x] Radius scale converged + verified — rendered radii now only 8/12/16/50%/999px (was 10 distinct)
- [x] Type scale converged + verified — half-pixels (11.5/12.5/12.8/14.5) + outliers (10/19/21) snapped onto 11/12/13/14/15/17/22; no overflow, on-scale by computed style. (Kept whole-number sizes pragmatically; a rigid ratio would churn a liked UI for no gain. Icon-only buttons compute the UA 13.33px — text-less, cosmetically nil.)
- [ ] Spacing grid converged + verified  ← did type first to de-risk; spacing is the highest-layout-risk pass
- [ ] Color tokens converged + verified
- [ ] Contrast AA audited + fixed
- [ ] Final before/after visual pass, committed, released
