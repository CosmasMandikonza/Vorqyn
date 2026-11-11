# Capture provenance notes (Issue #15 economic section)

Captures in this directory were taken with Playwright Chromium against the
production build (`pnpm build` + `pnpm start`) on 2026-11-07, DSF 1,
`fullPage: false`. Each screenshot's PNG IHDR was checked against the
requested viewport (1440×900, 390×844, 320×844) — mismatches would fail the
run.

The fixture walkthrough screenshots (03/04) were taken after clicking "Load
recorded fixture walkthrough" — the opt-in, double-badged replay of Lane 1's
committed canonical fixture script (packages/contracts/src/fixtures.ts)
through the validated boundary. They demonstrate the stage structure with
deterministic recorded events; they are NOT presented as live devnet
activity, and the panel badges state this on-screen.

The pending-state screenshots (01/02) show the honest default: every
chain-authority stage PENDING/UNAVAILABLE until #49/#50/#51 deliver real
sources.
