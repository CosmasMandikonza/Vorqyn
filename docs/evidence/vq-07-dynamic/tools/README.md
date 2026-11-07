# Capture tooling (reproducibility)

- `capture-mission-playback.mjs` — recorded-fixture journey capture (01-17):
  requires the production server on :3000 and `@playwright/test` with
  chromium installed (`pnpm exec playwright install chromium`). Run from
  `apps/web/` so package resolution works.
- Real-endpoint captures (19-21) were produced by the same script shape with
  the `?fixture=1` param removed; the journey is Start -> Run -> pause ->
  stations -> fault -> advance -> replay on the live POST endpoint.
- Real-API integration proof script used for 19-21 is preserved in the PR
  description; it differs only in not appending the fixture param and in
  logging the actual HTTP requests/responses observed on
  POST /api/demo/simulation.
