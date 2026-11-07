/**
 * VORQYN guest observation journal — bounded append-only synthetic record.
 *
 * Issue #9 focused slice (Lane 2). A deterministic, source-aware journal of
 * REAL kernel observation snapshots for a guest demo mission:
 * - append-only and bounded (records are never edited or reordered; the
 *   cap rejects further appends instead of silently dropping history);
 * - deterministic for the same seed and accepted operation trace (all
 *   inputs are explicit; no wall clock, no Math.random, no globals);
 * - defended against duplicate/regressed snapshot sequences, cross-stream
 *   contamination, tampered provenance, gaps (tolerated + audited) and
 *   stale/disconnected sources (converted to explicit telemetry states);
 * - replayable: re-running the bridge over the records reproduces the same
 *   telemetry, poses, fault timeline and per-robot sequence tracks.
 *
 * AUTHORITY BOUNDARY (issue #9): this journal is NOT a mission event log
 * and never claims mission lifecycle authority. Records contain no
 * funded/verified/paid/escrow state and no chain timestamps; a guest record
 * cannot become a MissionEvent until the real mission authority (Lane 1's
 * reducer-backed orchestrator) actually performs those transitions. The
 * reducer would reject fabricated lifecycle events (tested), so the
 * journal's honest waiting state is the correct behaviour.
 */

import {
  applyTelemetrySample,
  canonicalJson,
  noteRejectedTelemetry,
  type Result,
  type TelemetrySample,
  type TelemetryStore,
} from "../../../packages/contracts/src/index";
import type { DemoSnapshot } from "../../simulation/demo/kernel-adapter.d.mts";
import {
  GUEST_JOURNAL_SCHEMA,
  normalizeSnapshotToTelemetry,
  type NormalizedTelemetry,
} from "./telemetry-bridge";

export interface ObservationJournalRecord {
  readonly journalSchema: typeof GUEST_JOURNAL_SCHEMA;
  readonly missionId: string;
  readonly seed: number;
  /** Append order within the journal (0-based), independent of kernel time. */
  readonly recordOrdinal: number;
  /** Unmodified frozen kernel observation snapshot. */
  readonly snapshot: DemoSnapshot;
  /** Service receipt value used for this record's telemetry conversion. */
  readonly receivedAtMs: number;
  /** Contract-valid telemetry derived from the snapshot at append time. */
  readonly telemetry: readonly NormalizedTelemetry[];
}

export interface RejectedAppend {
  readonly attemptedSequence: number | null;
  readonly code: string;
  readonly message: string;
}

export interface SequenceGap {
  readonly fromSequence: number;
  readonly toSequence: number;
}

export interface ObservationJournal {
  readonly journalSchema: typeof GUEST_JOURNAL_SCHEMA;
  readonly missionId: string;
  readonly seed: number;
  readonly maxRecords: number;
  readonly records: readonly ObservationJournalRecord[];
  /** Receipt base for deterministic fixture receipt clock (append order). */
  readonly fixtureReceiptEpochBaseMs: number;
  /** Append-only audit of rejected appends; records are never changed by them. */
  readonly rejectedAppends: readonly RejectedAppend[];
  /** Tolerated sequence gaps between accepted records (audited, not healed). */
  readonly sequenceGaps: readonly SequenceGap[];
}

export interface CreateJournalOptions {
  /** Guest mission id; must satisfy the contracts ID lexical rule. */
  readonly missionId: string;
  /** Kernel seed this journal is bound to. */
  readonly seed: number;
  /** Maximum accepted records (bounded journal); default 512. */
  readonly maxRecords?: number;
}

export interface AppendFailure {
  readonly ok: false;
  /** The unchanged journal (records identical), with the rejection audited. */
  readonly journal: ObservationJournal;
  readonly error: { readonly code: string; readonly message: string };
}

export interface AppendSuccess {
  readonly ok: true;
  readonly journal: ObservationJournal;
}

export type AppendResult = AppendSuccess | AppendFailure;

const DEFAULT_MAX_RECORDS = 512;
const MISSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;

export function createGuestObservationJournal(options: CreateJournalOptions): Result<ObservationJournal> {
  const { missionId, seed } = options;
  if (typeof missionId !== "string" || !MISSION_ID_PATTERN.test(missionId)) {
    return {
      ok: false,
      error: {
        code: "validation_error",
        message: `missionId ${JSON.stringify(missionId ?? null)} must match ${MISSION_ID_PATTERN}`,
      },
    };
  }
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    return { ok: false, error: { code: "validation_error", message: "seed must be an unsigned 32-bit integer" } };
  }
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 100000) {
    return { ok: false, error: { code: "validation_error", message: "maxRecords must be an integer in [1, 100000]" } };
  }
  return {
    ok: true,
    value: {
      journalSchema: GUEST_JOURNAL_SCHEMA,
      missionId,
      seed,
      maxRecords,
      records: [],
      fixtureReceiptEpochBaseMs: 1762000000000, // contracts FIXTURE_EPOCH_BASE_MS, kept as explicit data
      rejectedAppends: [],
      sequenceGaps: [],
    },
  };
}

export interface AppendOptions {
  /**
   * Explicit service receipt epoch for this record. Omit to use the
   * deterministic fixture receipt clock (FIXTURE_EPOCH_BASE_MS + recordOrdinal),
   * which is a documented fixture domain, never a real UTC claim and never
   * derived from simulator time.
   */
  readonly receivedAtMs?: number;
}

/** Last accepted kernel snapshot sequence, or null before the first record. */
export function lastAcceptedSequence(journal: ObservationJournal): number | null {
  const lastRecord = journal.records[journal.records.length - 1];
  return lastRecord === undefined ? null : lastRecord.snapshot.sequence;
}

function withRejectedAppend(journal: ObservationJournal, entry: RejectedAppend, error: { code: string; message: string }): AppendFailure {
  return {
    ok: false,
    journal: { ...journal, rejectedAppends: Object.freeze([...journal.rejectedAppends, Object.freeze(entry)]) },
    error,
  };
}

/**
 * Append one REAL kernel observation snapshot to the journal. The snapshot
 * is validated against the journal's stream identity (schema, seed,
 * scenario) and the strictly-increasing sequence rule; telemetry conversion
 * runs through the contract validator at append time so tampered provenance
 * is rejected here, not at replay time.
 *
 * A rejected append never changes `records` (and therefore never changes
 * the accepted pose); it is only audited in `rejectedAppends`.
 */
export function appendKernelSnapshot(
  journal: ObservationJournal,
  snapshot: DemoSnapshot,
  options: AppendOptions = {},
): AppendResult {
  if (!isRecord(snapshot)) {
    return withRejectedAppend(journal, { attemptedSequence: null, code: "validation_error", message: "snapshot must be an object" }, { code: "validation_error", message: "snapshot must be an object" });
  }
  const attemptedSequence = typeof snapshot.sequence === "number" ? snapshot.sequence : null;
  if (journal.records.length >= journal.maxRecords) {
    return withRejectedAppend(
      journal,
      { attemptedSequence, code: "journal_full", message: `journal is bounded at ${journal.maxRecords} records` },
      { code: "journal_full", message: `journal is bounded at ${journal.maxRecords} records` },
    );
  }
  const provenance = snapshot.provenance as Record<string, unknown> | undefined;
  if (!isRecord(provenance)) {
    return withRejectedAppend(
      journal,
      { attemptedSequence, code: "validation_error", message: "snapshot has no kernel provenance" },
      { code: "validation_error", message: "snapshot has no kernel provenance" },
    );
  }
  if (provenance.seed !== journal.seed) {
    const message = `snapshot seed ${String(provenance.seed)} does not match journal seed ${journal.seed}`;
    return withRejectedAppend(journal, { attemptedSequence, code: "cross_stream_contamination", message }, { code: "cross_stream_contamination", message });
  }
  if (provenance.scenarioId !== "PORT-001") {
    const message = `snapshot scenarioId ${String(provenance.scenarioId)} does not match the journal's scenario`;
    return withRejectedAppend(journal, { attemptedSequence, code: "cross_stream_contamination", message }, { code: "cross_stream_contamination", message });
  }
  if (typeof snapshot.sequence !== "number" || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) {
    return withRejectedAppend(
      journal,
      { attemptedSequence, code: "validation_error", message: "snapshot sequence must be a non-negative safe integer" },
      { code: "validation_error", message: "snapshot sequence must be a non-negative safe integer" },
    );
  }
  const last = lastAcceptedSequence(journal);
  if (last !== null && snapshot.sequence <= last) {
    const message = `snapshot sequence ${snapshot.sequence} is not newer than the last accepted ${last}`;
    return withRejectedAppend(journal, { attemptedSequence, code: "duplicate_or_regressed_sequence", message }, { code: "duplicate_or_regressed_sequence", message });
  }

  const recordOrdinal = journal.records.length;
  const receivedAtMs = options.receivedAtMs ?? journal.fixtureReceiptEpochBaseMs + recordOrdinal;
  const conversion = normalizeSnapshotToTelemetry(snapshot, { missionId: journal.missionId, receivedAtMs });
  if (!conversion.ok) {
    return withRejectedAppend(
      journal,
      { attemptedSequence, code: conversion.error.code, message: conversion.error.message },
      conversion.error,
    );
  }

  const gap =
    last !== null && snapshot.sequence > last + 1
      ? [{ fromSequence: last, toSequence: snapshot.sequence }]
      : [];

  const record: ObservationJournalRecord = Object.freeze({
    journalSchema: GUEST_JOURNAL_SCHEMA,
    missionId: journal.missionId,
    seed: journal.seed,
    recordOrdinal,
    snapshot: Object.freeze(snapshot),
    receivedAtMs,
    telemetry: Object.freeze(conversion.value.samples),
  });

  return {
    ok: true,
    journal: {
      ...journal,
      records: Object.freeze([...journal.records, record]),
      sequenceGaps: Object.freeze([...journal.sequenceGaps, ...gap]),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayFaultTransition {
  readonly robotId: string;
  readonly simulatorTimeMs: number;
  readonly phase: "fault-started" | "fault-ended";
  readonly severity: string | null;
}

export interface JournalReplay {
  /** Contract-valid telemetry in record order, converted exactly as at append. */
  readonly samples: readonly TelemetrySample[];
  /** Per-robot applied telemetry tracks via the contracts' own application rule. */
  readonly telemetryStore: TelemetryStore;
  /** Rejected telemetry deliveries (duplicates/out-of-order), per robot. */
  readonly rejectedTelemetryCount: Record<string, number>;
  /** Recovered fault phase transitions in simulator time. */
  readonly faultTimeline: readonly ReplayFaultTransition[];
  /** Final accepted pose per robot (metres, world ENU). */
  readonly lastPoseByRobot: Record<string, { x: number; y: number; z: number }>;
  /** Final per-robot freshness labels as recorded by the kernel. */
  readonly lastFreshnessByRobot: Record<string, { fresh: boolean; staleness: string; linkState: string }>;
}

/**
 * Replay the journal: re-run the same bridge conversion over every stored
 * record and apply the resulting telemetry through the contracts'
 * `applyTelemetrySample` (duplicates/out-of-order rejected without moving
 * the accepted pose). For the same journal bytes this is deterministic and
 * recovers identical poses, sensor observations, fault history and labels.
 */
export function replayJournal(journal: ObservationJournal): Result<JournalReplay> {
  const samples: TelemetrySample[] = [];
  let store: TelemetryStore = {};
  const rejectedTelemetryCount: Record<string, number> = {};
  const faultTimeline: ReplayFaultTransition[] = [];
  const previousFaultByRobot = new Map<string, { severity: string | null }>();
  const lastPoseByRobot: Record<string, { x: number; y: number; z: number }> = {};
  const lastFreshnessByRobot: Record<string, { fresh: boolean; staleness: string; linkState: string }> = {};

  for (const record of journal.records) {
    // Re-convert from the stored snapshot — the stored telemetry is advisory;
    // the conversion itself is the deterministic replayed artifact.
    const conversion = normalizeSnapshotToTelemetry(record.snapshot, {
      missionId: journal.missionId,
      receivedAtMs: record.receivedAtMs,
    });
    if (!conversion.ok) {
      return conversion;
    }
    for (const normalized of conversion.value.samples) {
      samples.push(normalized.sample);
      const applied = applyTelemetrySample(store, normalized.sample);
      if (applied.ok) {
        store = applied.value;
      } else {
        const robotId = normalized.sample.robotId;
        rejectedTelemetryCount[robotId] = (rejectedTelemetryCount[robotId] ?? 0) + 1;
        store = noteRejectedTelemetry(store, robotId);
      }
    }
    for (const robot of record.snapshot.robots) {
      lastPoseByRobot[robot.robotId] = { ...robot.pose };
      lastFreshnessByRobot[robot.robotId] = {
        fresh: robot.fresh,
        staleness: robot.staleness,
        linkState: robot.linkState,
      };
      const fault = robot.activeOpticalFault;
      const previous = previousFaultByRobot.get(robot.robotId);
      const severity = fault === null || fault === undefined ? null : fault.severity;
      if ((previous?.severity ?? null) !== severity) {
        faultTimeline.push({
          robotId: robot.robotId,
          simulatorTimeMs: record.snapshot.simulatorTimeMs,
          phase: severity === null ? "fault-ended" : "fault-started",
          severity,
        });
        previousFaultByRobot.set(robot.robotId, { severity });
      }
    }
  }

  return {
    ok: true,
    value: {
      samples,
      telemetryStore: store,
      rejectedTelemetryCount,
      faultTimeline: Object.freeze(faultTimeline),
      lastPoseByRobot: Object.freeze(lastPoseByRobot),
      lastFreshnessByRobot: Object.freeze(lastFreshnessByRobot),
    },
  };
}

/**
 * Canonical serialization of the journal (contracts' key-sorted JSON).
 * Two journals built from the same seed + trace produce identical strings,
 * which is how determinism is asserted in tests.
 */
export function canonicalJournal(journal: ObservationJournal): string {
  return canonicalJson(journal);
}
