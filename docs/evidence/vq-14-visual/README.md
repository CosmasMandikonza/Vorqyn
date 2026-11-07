# VQ-14 visual signature evidence — World Dive, Mission Fracture, Ghost Replay

Real browser captures (Playwright Chromium 158, production build, DSF 1,
`fullPage: false`), 2026-11-07. PNG dimensions verified programmatically
after each capture (see `capture-manifest.json` and
`capture-manifest-320.json`).

**Scope statement:** World preview · SYNTHETIC_SIM kernel telemetry · No
evidence, AI or settlement actions. The Economic Handoff portion of #15 is
NOT implemented here — no wallet, assignment, payout, explorer signature or
"paid" state exists anywhere in this route (see Limitations).

## Desktop 1440×900

| File | Content |
| --- | --- |
| `01-worlddive-midflight-light-1440.png` | World Dive mid-flight between legs (light) — camera descending through the judge story |
| `03-fracture-underwater-rov-light-1440.png` | Underwater station with ROV live pose, fill-lit obstruction region, bright zone frames |
| `04-fracture-timeline-light-1440.png` | Full operator view: World Dive/Run/Advance/Fault/Replay/Reset controls, measured-quality timeline with fault marker, ghost-replay legend, inspector with kernel measurements |
| `05-ghost-overlay-light-1440.png` | Ghost overlay — recorded pre-fault path (dashed sea-glass) vs post-fault path (solid copper) in-scene |
| `10-ghost-overlay-freshbuild-1440.png` | Ghost overlay re-verified on the final build |
| `06-reset-dark-1440.png` | Dark UI · RESET — scene daylight unchanged (theme invariant) |
| `07-inspect-dark-1440.png` | Dark · INSPECT station |

## Mobile (DSF 1, fullPage: false)

| File | Content | Verified dimensions |
| --- | --- | --- |
| `08-mobile-390-light.png` | 390×844 viewport | 390×844 ✓ |
| `09-mobile-320-light.png` | 320×844 viewport — camera station bar scrolls internally, page does NOT scroll horizontally (verified programmatically: `pageScrolls: false`) | 320×844 ✓ |

## Browser regression suite (tests/browser/mission-world.spec.ts)

6/6 passing, run against the production build:

1. Camera stations switch (AIR/LAND/UW/INSPECT/RESET) without losing selection.
2. 320px: camera station bar never causes page-level horizontal overflow.
3. Kernel fault measurably degrades optical quality in the inspector
   (scrubbed pre-fault ≈ 0.72 vs post-fault ≈ 0.08; severe fault record shown).
4. Replay history is deterministic (identical-snapshot badge).
5. Honesty badge switches per mode (static anchors vs SYNTHETIC_SIM playback).
6. World Dive button hidden under `prefers-reduced-motion`.

## Truthfulness notes

- **Mission Fracture wording:** the timeline and inspector present MEASURED
  degradation (quality value, applied factor, kernel fault record). The words
  "verification rejected" do not appear — the independent verifier (VQ-10)
  does not exist in this demo path, and sensor degradation is not evidence
  rejection.
- **Ghost Replay:** both branches are recorded kernel observations split at
  the fault's snapshot index. There is no replacement robot and no simulated
  recovery run; the legend says so explicitly.
- **Economic Handoff:** intentionally not implemented — no verified chain
  work exists to present. The route's truth panel states that settlement is
  absent. Per #15's dependency rule, this is disclosed rather than fabricated.

## Limitations

- The dive is a station playthrough (AIR → LAND → UW → INSPECT); it does not
  add new camera geometry. Leg duration 2.4 s per station.
- Sparkline y-scale is fixed 0..1 (quality domain): the fault drop is visible
  but small on screen at 1440. The numeric readouts carry the precise values.
- Dark-theme mobile captures and a reduced-motion mid-dive screenshot were
  exercised manually (dive button hidden; verified in browser spec 6) but not
  all combinations were saved as PNGs.
