# VORQYN mission orchestration (`services/mission/orchestration`)

Issue #14 slice (Lane 2 Agent A): the canonical mission event source-of-truth
seam. A per-mission append-only event repository guarded by CAS, idempotency
and bounds, whose ONLY transition authority is the shared contracts reducer
(`packages/contracts/src/{events,reducer}.ts`, Lane 1). **No alternative
state machine exists here** — the store's exposed "state" is the reducer's
own `MissionProjection`.

## Files

| File | Responsibility |
| --- | --- |
| `event-store.ts` | `createMissionEventStore`: validation, CAS, idempotency, bounds, per-mission serialization, replay verification; in-memory storage adapter |
| `file-event-log.ts` | real LOCAL durable JSONL adapter (`openMissionEventStoreFromFile`) with restart replay |
| tests | `apps/web/tests/mission-orchestration/*.test.tsx` (vitest — the contracts are TS source packages, so `node:test` cannot import them; documented in the simulation-journal README and repeated here) |

## Store semantics

`append(missionId, event, expectedLastSequence)`:

1. **Structural gate** — `validateMissionEvent` (contracts). Unknown kinds,
   wrong `schemaVersion`, malformed payloads: rejected before any state work.
2. **Isolation** — `event.missionId` must equal the requested stream, else
   `cross_mission_reference`.
3. **Bounds** — missions/store, events/mission, canonical bytes/event caps
   (`mission_full`, `event_too_large`, `too_many_missions` is surfaced by
   the missions bound on first append).
4. **CAS** — `expectedLastSequence` must equal the store's last applied
   sequence, else `stale_cas`. Concurrent appends are serialized per
   mission, so of two writers claiming the same expected sequence exactly
   one succeeds and the loser observes the winner's sequence.
5. **Sequence integrity** — `event.sequence` must be exactly
   `lastSequence + 1`; gaps and regressions are rejected, never healed.
6. **Reducer authority** — `initMissionProjection` (first event; must be
   `mission.created`) or `applyEvent` (everything else). Reducer rejections
   (`illegal_transition`, `duplicate_event`, `duplicate_sequence`,
   `duplicate_idempotency_key`, `cross_mission_reference`,
   `chain_not_confirmed`, `stale_assignment_version`, `budget_exceeded`,
   `already_terminal`, ...) pass through with their codes.
7. **Durability then ack** — the storage adapter appends before the
   acknowledgement; a storage failure (`storage_write_failed`) leaves the
   projection and history unchanged (no phantom accepted events).
8. **Idempotency** — an exact duplicate event (same id, same canonical
   bytes) acknowledges `duplicate: true` WITHOUT changing history; a
   tampered duplicate and a reused `commandId` with different content are
   reducer rejections.

`replay(missionId)` reads the STORED history (not the cache), rebuilds the
projection via `rehydrate`, and reports `matchesLiveProjection` — the
byte-for-byte (`canonicalJson`) determinism check. `readEvents(missionId,
{afterSequence, limit})` provides ordered readback.

## Storage honesty

`InMemoryMissionEventLogStorage` (default) is for tests. `FileEventLogStorage`
writes real append-only JSONL files (`<dir>/<missionId>.jsonl`) and
`openMissionEventStoreFromFile` replays them on startup, so restart/replay
is demonstrated with actual files. **Neither is cloud or serverless
persistence** — no replication, cross-machine locking or retention. The
`MissionEventLogStorage` seam is the integration point for Lane 1's future
database adapter; replacing the file adapter requires no reducer or store
changes.

## Clock domains

Events are stored verbatim: `occurredAtMs`/`observedAtMs` (service),
`simulatorTimeMs` (simulation-originated task events only, enforced by the
contracts), `chainTimeMs` (chain-confirmation events only). The store never
invents, rewrites or derives any of them, and never adds chain fields to
simulation events.

## Authority boundary

This store does not fabricate events. `task.paymentConfirmed` remains gated
by the reducer: a verified task plus a CONFIRMED payout chain record bound
to the current assignment version — tested by rejecting a payment attempt
without the confirmed chain record. Synthetic telemetry (the simulation
journal, `services/mission/simulation/**`) stays observation-only and is
never converted into mission events here; the future orchestrator UI/API
will append REAL lifecycle events through this store's CAS interface.

## Integration path for the verifier / chain client (Omar's lanes)

- The verifier (VQ-10) and chain client (VQ-12) emit
  `chain.transactionSubmitted` / `chain.transactionUpdated` /
  `task.evidenceAccepted` / `task.reassignmentAuthorized` /
  `task.paymentConfirmed` events **through this store's `append`**, exactly
  like every other producer. The reducer's confirmed-record prerequisites
  (`confirmedChainRecord`) and CAS assignment versions then apply
  automatically — no orchestration-side special cases.
- `expectedLastSequence` for a CAS append comes from `lastSequence(missionId)`
  or `readEvents` paging; racing producers get exactly one winner.
- What is intentionally NOT here: the HTTP surface, authentication, actual
  wallet/signer handling, AI recovery proposals, and verifier signatures —
  all remain with their owning issues.
