# Economic Handoff module (Issue #15 economic section)

Read-only, event/receipt-driven stage display over Lane 1's canonical
mission contracts. This directory contains NO reducer, NO chain client,
NO verifier and NO transaction capability — by design.

## Files

- `boundary.ts` — typed ingestion: validates raw MissionEvents through
  Lane 1's contracts, projects them one-by-one via the contracts' own
  `initMissionProjection` + `applyEvent`, keeps the VALID PREFIX, and
  surfaces every rejection as audit. Also derives the six handoff stages
  from the resulting projection.
- `RecoveryHandoffPanel.tsx` — the six-stage read-only display, including
  per-stage states, chain-receipt specifics in `confirmed` state, audit
  rows, and the fixture/live source badge.
- Tests in `apps/web/tests/mission-world/` cover every named hostile input:
  stale assignment versions, cross-mission isolation, pending/unknown
  statuses presented as paid, fabricated verdict shapes, duplicate receipts,
  clock-domain violations, and the fixture/live source badge switch.

## Integration contract

The panel consumes a `EconomicHandoffProjection` produced by
`projectEconomicHandoff(rawEvents, ctx)`. Callers supply raw canonical
MissionEvents (from a future mission-events endpoint or, today, from the
recorded fixture script). The boundary NEVER renders state from rejected
input: hostile events produce audit entries plus honest pending stages.
