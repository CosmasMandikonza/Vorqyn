# Capture tooling (reproducibility)

Run from `apps/web/` (package resolution) with the production server on
:3000 and `pnpm exec playwright install chromium` done.

- `capture-mission-playback.mjs` — recorded-fixture journey (captures 01–17,
  `?fixture=1`).
- `capture-real-e2e.mjs` — REAL end-to-end proof (captures 19–21): genuine
  POSTs to /api/demo/simulation, logging every request/response and the
  resulting kernel state; produces the fault-degradation and replay-
  determinism evidence. No fixture param.
- `capture-a11y-zoom.mjs` — keyboard traversal order + 200% zoom proxy
  (captures 22–23).
- `find-overflow.mjs` — horizontal-overflow element scanner used to prove
  the 200% overflow is entirely in the shared shell (`.header-actions`,
  forbidden path) and not in this workstream's components.
