# Camera-row audit tooling and capture provenance (fix/lane2-camera-row-320)

## What this is

`audit-camera-row.mjs` is the 32-state camera-row audit for the 320px P0
correction (Issue #15, extended browser audit finding): FOLLOW overflowed the
viewport to x=353.75 and RESET was clipped to x=-34 after a station change at
320x844 in both themes.

Decomposition: 4 viewports (320 / 390 / 1024 / 1440) x 2 themes (light /
dark) x 4 key stations (RESET -> AIR -> UW -> FOLLOW) = **32 audited
states**. The key set covers both defect stations plus the transitions
between them; the exhaustive six-station walk (RESET/AIR/LAND/UW/INSPECT/
FOLLOW) at 320px lives in
`apps/web/tests/browser/mission-world.spec.ts` ("whole-row geometry ..."
test), which also covers keyboard and touch activation.

## Method (honesty notes)

- Real Playwright input throughout: `locator.click()` on the native station
  buttons — no DOM-dispatch shortcuts, no forced clicks.
- FOLLOW's honest gate (`sessionActive && selectedLive`) is exercised through
  the real UI journey on every page load: Start synthetic survey -> Advance
  +1 step (the start response alone carries no snapshots) -> Access rover.
  The audit fails loudly on a disabled FOLLOW rather than skipping it.
- Whole-row geometry is asserted after EVERY station change: every button
  fully within the viewport, `elementFromPoint` hit-test resolves to the
  button itself, height >= 44px, no internal scroll (`scrollWidth`), no
  page-level horizontal overflow, and exactly the intended station pressed.
- Result recorded in `../camera-row-audit.json`: 32/32 pass.

## Build / serve conditions (2026-11-07)

Captured against the production build of this branch: `pnpm build` + `next
start` on 127.0.0.1:3000. The captures were taken at the pre-rebase head of
this branch; the branch was subsequently rebased onto main (the #50 merge)
and given a one-line pnpm-lock.yaml repair — `git diff` over the product
trees (`apps/web`, components, contracts, services) between the capture head
and the pushed head is empty, so the captures describe the pushed code
exactly. On this Windows host the build's deploy-only standalone trace-copy
step fails with EPERM (symlink privilege); the main build completed first
(`Compiled successfully`, 9/9 static pages, BUILD_ID present) and `next
start` serves `.next` directly — deployment packaging is unaffected and is
Codex's release lane, not this fix.

## Screenshots

Captured with Playwright Chromium, deviceScaleFactor 1, against the
production server above:

| file | size | what it is |
| --- | --- | --- |
| `../camera-row-320-light-viewport.png` | 320x844 | full viewport, light theme, RESET station |
| `../camera-row-320-dark-viewport.png` | 320x844 | full viewport, dark theme, RESET station |
| `../camera-row-320-light-frame.png` | 280x524 | `world-canvas-frame` element crop, light |
| `../camera-row-320-dark-frame.png` | 280x524 | `world-canvas-frame` element crop, dark |

PNG IHDR dimensions were verified against the table above in the same run.
The frame crops are smaller than the viewport because the canvas frame is an
aspect-fitted element at 320px — the station row renders inside the frame
bounds, which is what the crops show. These files are new evidence for this
branch only; they do not amend the staged release manifest
(`../capture-manifest-320.json`) or the release README, which remain the
release lane's records of the pre-fix state.
