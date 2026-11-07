# VQ-07-VIEW evidence — interactive world preview (Issue #27)

All screenshots are real browser captures of the production build
(`pnpm build` + `pnpm start`) taken on 2026-11-07 at the stated viewports.
Every view renders the hash-verified PORT-001 GLBs from
`apps/web/public/port-world/` (synced + verified against
`assets/port-world/manifest.json` by `tests/mission-world/sync-port-world.mjs`
and `asset-sync.test.tsx`).

**Scope statement (applies to every capture):**
World preview — static anchor fixtures; no live mission telemetry.

## Desktop 1440×900

| File | Content |
| --- | --- |
| `01-reset-light-1440.png` | Light UI · RESET station — canonical 3/4 port framing, inspector overlay with real world.json facts and pose derivation |
| `02-air-light-1440.png` | Light · AIR station — aerial survey height (mid of declared range), aerial_survey zone frame visible |
| `03-land-light-1440.png` | Light · LAND station — yard/warehouse level, road corridor frames |
| `04-underwater-light-1440.png` | Light · UW station — submerged obstruction region, murk fog, sunken workboat + fallen container at true scale |
| `05-inspect-light-1440.png` | Light · INSPECT → obstruction_primary (sunken workboat close view) |
| `06-inspect-crane-cycle-light-1440.png` | Light · INSPECT cycled to crane_boom_tip |
| `07-land-rover-selected-light-1440.png` | Light · LAND with Access rover selected (copper ring, chip, inspector anchor rows) |
| `08-reset-dark-1440.png` | Dark UI · RESET — scene daylight unchanged by UI theme (design invariant) |
| `09-underwater-dark-1440.png` | Dark · UW station |
| `10-inspect-dark-1440.png` | Dark · INSPECT |
| `11-fallback-2d-light-1440.png` | Forced 2D fallback — generated plan view + full zone list + camera stations + machine selection |
| `15-context-loss-banner-1440.png` | `webglcontextlost` dispatched on the live canvas — honest banner with "Open 2D map" escape hatch (same handler a real driver loss fires) |
| `16-keyboard-focus-skiplink-1440.png` | Visible focus styling on the skip link (programmatic focus; full keyboard traversal is covered by existing VQ-02 browser tests + manual spot checks) |

## Mobile 390×844

| File | Content |
| --- | --- |
| `12-mobile-390-light.png` | Mobile viewport — canvas, wrapped camera-station bar, honesty badge |
| `13-mobile-inspector-390-light.png` | Mobile inspector rendered as an in-flow section below the canvas (no overlay) |

## Demo entry

| File | Content |
| --- | --- |
| `14-demo-link-light-1440.png` | `/demo` with exactly one honest link: "Explore the 3D world preview" → `/demo/mission` |

## Verification notes

- Console clean on all routes during captures; no hydration warnings observed.
- Selection persists across camera-station changes and theme switches
  (evidenced in `07` and `08`: rover remains selected).
- Theme flip does not alter the scene's daylight — compare `01` (light) vs
  `08` (dark): identical sun/sky, different UI chrome only.
- The context-loss capture uses a synthetic `webglcontextlost` event — the
  exact event a real driver loss fires — because a deterministic real driver
  loss cannot be scripted reliably in a normal browser session. The handler
  under test is the production handler.
- Not screenshotted (covered by automated tests instead): reduced-motion
  path (global CSS + CameraRig instant-jump gate), 200% zoom (unit-checked
  layout primitives; manual pass done during development), GLB-missing
  error panel (ErrorBoundary path, exercised in development).
