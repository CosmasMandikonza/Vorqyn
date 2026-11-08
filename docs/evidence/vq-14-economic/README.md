# VQ-14 economic section evidence — event/receipt-driven handoff stages

Real browser captures (Playwright Chromium, production `pnpm build` +
`pnpm start`), 2026-11-07. PNG dimensions verified programmatically
(`capture-manifest.json`: IHDR vs requested viewport, strict).

**Scope statement:** Economic handoff stages are EVENT/RECEIPT-DRIVEN and
read-only. Default state: every chain-authority stage renders
PENDING/UNAVAILABLE — no synthesized TaskReassigned/TaskPaid, no fabricated
verdicts, no invented operator-B telemetry, no devnet signatures.

## Files

| File | Content |
| --- | --- |
| `01-handoff-pending-light-1440.png` | Desktop light — all six stages honest pending/unavailable before any session; boundary audit empty |
| `02-handoff-fault-light-1440.png` | After kernel fault flow: measured-degradation stage MEASURED, verifier/reassignment/payout stages pending (truthful — no verifier or chain authority in the demo path) |
| `03-handoff-dark-1440.png` | Dark theme — scene daylight unchanged |
| `04-handoff-mobile-390-light.png` | 390×844 — panel in flow, camera bar inside canvas, no overlap |
| `05-handoff-mobile-320-light.png` | 320×844 — station bar internal scroll; page never scrolls horizontally |
| `06-handoff-fallback-2d-light-1440.png` | 2D fallback — stage list + pending states preserved without WebGL |

## Test matrix (unit, vitest)

27 handoff tests cover every named rejection:
- stale assignment version (reducer audit, prefix kept)
- cross-mission isolation (foreign events excluded + audited)
- pending/unknown chain status never promoted to paid
- fabricated verdict shape rejected via contracts' own maker
- duplicate receipt audit
- simulator-time-as-chain-time clock-domain violation audited
- stage projections from the canonical fixture script (reducer-validated)
- panel render: pending states, confirmed states, hostile-input audits
- fixture walkthrough disclosure (double badge)

## Integration contract

When Omar's chain-client (#50) and verifier (#49) merge, their outputs plug
into `projectEconomicHandoff(rawEvents, ctx)` — the SAME validated boundary.
No UI redesign is needed: stage states derive from the canonical events.
Until then, the panel renders truthful pending/unavailable states.
