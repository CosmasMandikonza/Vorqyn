# PORT-001 preview render log — visual inspection WAS performed

Date: 2026-11-07. All screenshots below are real captures of the committed GLBs
rendered in a browser — nothing here is mocked or drawn by hand.

## Method

1. `node tools/preview-serve.mjs` serves the pack at `http://127.0.0.1:8137/`.
2. `tools/preview.html` loads `../models/port-world-high.glb` with three.js
   **r180** (MIT, pinned CDN URL, runtime-only — see `../ASSETS.md`), applies
   the `world.json` sun direction (azimuth 225 deg, elevation 38 deg) and the
   six named camera-target presets from `world.json`.
3. A real browser (ZCode in-app browser, Chromium) navigated to the page,
   waited for `window.__ready`, switched views via `window.__setView(name)`,
   and captured 1280x720 screenshots of the live canvas.

## Files

| File | View | Camera (ENU, m) |
| --- | --- | --- |
| `plan-view.svg` | generated top-down diagram (not a render) | — |
| `render-reset.png` | RESET — canonical 3/4 cinematic | (-161, -209, 185) |
| `render-land.png` | LAND — yard / roads / warehouses | (-180, 24, 54) |
| `render-underwater.png` | UNDERWATER — obstruction zone | (160, -62, -5) |
| `render-inspect-crane.png` | INSPECT — gantry crane boom tip | (12, -147, 35) |

## Honest notes / preview limitations

- The renderer applies fog backgrounds for distance and for the underwater
  murk. Fog and background colors are **preview-only stylization**; the asset
  itself contributes geometry, PBR materials, vertex colors and the
  alpha-blended water/depth-tint quads.
- No shadow maps, no post-processing, pixel ratio 1: final art direction
  (shadows, water shading, sky) is Issue #8 runtime work.
- The underwater screenshot proves the submerged obstruction set (sunken
  workboat, fallen containers, collapsed Pier C debris) is visible and
  navigable in the same world as the surface — one shared physical scene.
- Visual issues found and fixed during this inspection are recorded in the
  PR description (water readability, road-corridor blockage).
