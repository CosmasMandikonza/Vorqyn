# VORQYN mission simulation bridge (`services/mission/simulation`)

Issue #9 focused slice (Lane 2): the source-aware bridge between the
deterministic simulation kernel and the canonical shared contracts, plus a
bounded guest observation journal. **The contracts and kernel are read-only
upstream of this module** — nothing here re-declares or weakens them.

## What lives here

| File | Responsibility |
| --- | --- |
| `telemetry-bridge.ts` | kernel observation snapshot → contract-valid `TelemetrySample` via `makeTelemetrySample` (packages/contracts) |
| `observation-journal.ts` | bounded append-only guest journal: validation, defenses, deterministic replay |
| (tests) | `apps/web/tests/simulation-journal/*.test.tsx` via vitest |

Tests live under `apps/web/tests/simulation-journal/**` because the shared
contracts are TypeScript source packages — a colocated `node:test` run
cannot import them, and the shared vitest config is not this slice's file
to edit. Ownership stays with this slice; the runner location is a tooling
constraint, documented here deliberately.

## Telemetry mapping

| Kernel observation state | Emitted telemetry |
| --- | --- |
| running + connected + fresh | `fresh-sample`, quality `ok` (or `degraded` + `optical-visibility-fault-active` when the kernel applied an optical fault factor), `qualityMetric` = the primary optical `quality01` actually measured |
| running + disconnected | `link-down-marker` with quality `link_disconnected`, pose = kernel's frozen last-authoritative pose, no `qualityMetric` (no fresh reading claimed) |
| paused (whole snapshot) | **no telemetry** — the kernel emitted no fresh measurement; the journal still stores the snapshot verbatim |

Field provenance: `sourceKind`/`frameId`/`seed`/`units` come from the
snapshot's own kernel provenance (callers cannot forge them; tampered
snapshots fail contract validation at append time). `sourceTimestampMs` is
the kernel's integer `simulatorTimeMs`. `receivedAtMs` is the service
receipt clock, supplied per record — the deterministic journal derives it
from the contracts-owned `FIXTURE_EPOCH_BASE_MS` + append ordinal (a
documented fixture domain, never presented as real UTC and never derived
from simulator time); a real orchestrator passes actual receipt epochs.
`chainTimeMs` and everything chain-owned are **never produced here**.

## Journal properties

- append-only, immutable records, hard cap (`maxRecords`, default 512) —
  the cap rejects further appends (`journal_full`) instead of dropping
  history;
- duplicate/regressed kernel sequences are rejected with `records`
  unchanged (accepted poses cannot move) and only `rejectedAppends` grows;
- tolerated sequence gaps are audited (`sequenceGaps`), never healed or
  back-filled;
- cross-stream contamination (seed/scenario mismatch) is rejected;
- `replayJournal` re-runs the same bridge conversion and applies telemetry
  through the contracts' `applyTelemetrySample` (duplicates/out-of-order
  rejected without moving the accepted pose), recovering poses, freshness
  labels, per-robot sequence tracks and the fault timeline identically for
  the same journal bytes (`canonicalJournal`).

## Authority boundary (the important part)

This module is **not** a mission authority and produces **no**
`MissionEvent`. Guest journal records structurally contain no
funded/funding/verified/paid/escrow/payout state and no chain timestamps
(scanned in tests), and the authoritative reducer rejects a fabricated
first lifecycle event (`initMissionProjection` requires a real
`mission.created` first). Converting journal records into mission events is
the future orchestrator's job — with the real funding, launch, verifier and
chain authority behind it — and should import these modules rather than
re-implement them.
