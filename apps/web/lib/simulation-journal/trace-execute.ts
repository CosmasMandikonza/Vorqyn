/**
 * Guest trace derivation for POST /api/demo/observations (VQ-GUEST-TRACE/1).
 *
 * REUSES, verbatim, the merged DEMO-SIM/1 transport pieces:
 * - `parseAndValidateRequest` (apps/web/lib/demo-simulation/validate) for the
 *   identical bounded request body (seed, operations, all limits);
 * - `executeDemoSimulation` (apps/web/lib/demo-simulation/execute) to run the
 *   REAL world-aligned kernel and get its actual snapshots/results/state.
 * No simulator, parser or validator is duplicated here.
 *
 * The actual snapshots are then fed through the merged source-aware journal
 * (`services/mission/simulation/observation-journal`) — the same canonical
 * derivation used elsewhere — and rendered as an explicit read-only trace
 * with paging. Everything is recomputed per request (stateless) and is
 * deterministic: the same body + cursor yields a byte-identical response.
 *
 * Authority boundary: this module produces trace/diagnostic JSON only — no
 * MissionEvent, evidence verdict, AI proposal, funding state, wallet or
 * chain timestamp is synthesized, and no server-side session exists.
 */

import { DemoKernelRejection, type DemoSimResponse } from "@/lib/demo-simulation/contract";
import { executeDemoSimulation } from "@/lib/demo-simulation/execute";
import { normalizeSnapshotToTelemetry } from "../../../../services/mission/simulation/telemetry-bridge";
import {
  appendKernelSnapshot,
  createGuestObservationJournal,
  type ObservationJournal,
} from "../../../../services/mission/simulation/observation-journal";
import {
  TRACE_RESPONSE_SCHEMA,
  TRACE_CURSOR_LIMITS,
  guestMissionIdForSeed,
  type GuestTraceResponse,
  type TraceCursor,
  type TraceRecordView,
} from "./trace-contract";

export interface DeriveTraceOptions {
  readonly seed: number;
  readonly operations: DemoSimResponse["operations"];
  readonly cursor: TraceCursor;
}

export interface TraceDerivation {
  readonly response: GuestTraceResponse;
}

export interface TraceCursorError {
  readonly code: "cursor_invalid";
  readonly message: string;
}

/**
 * Parse the paging cursor from the URL query string.
 * Unknown/invalid values are typed errors (HTTP 400 at the route).
 */
export function parseTraceCursor(searchParams: URLSearchParams): TraceCursor | TraceCursorError {
  const after = searchParams.get("afterSequence");
  const limit = searchParams.get("limit");
  let afterSequence = 0;
  let limitValue: number = TRACE_CURSOR_LIMITS.maxLimit;
  if (after !== null) {
    if (!/^\d+$/.test(after)) {
      return { code: "cursor_invalid", message: `afterSequence must be a non-negative integer, got ${JSON.stringify(after)}` };
    }
    afterSequence = Number(after);
    if (afterSequence > TRACE_CURSOR_LIMITS.maxAfterSequence) {
      return { code: "cursor_invalid", message: `afterSequence ${afterSequence} exceeds the kernel step budget ${TRACE_CURSOR_LIMITS.maxAfterSequence}` };
    }
  }
  if (limit !== null) {
    if (!/^\d+$/.test(limit)) {
      return { code: "cursor_invalid", message: `limit must be a positive integer, got ${JSON.stringify(limit)}` };
    }
    limitValue = Number(limit);
    if (limitValue < TRACE_CURSOR_LIMITS.minLimit || limitValue > TRACE_CURSOR_LIMITS.maxLimit) {
      return { code: "cursor_invalid", message: `limit must be in [${TRACE_CURSOR_LIMITS.minLimit}, ${TRACE_CURSOR_LIMITS.maxLimit}], got ${limitValue}` };
    }
  }
  return { afterSequence, limit: limitValue };
}

function toTraceRecord(record: ObservationJournal["records"][number], missionId: string): TraceRecordView {
  const snapshot = record.snapshot;
  // Re-derive the skip audit with the same bridge call the append used —
  // deterministic and identical by construction.
  const conversion = normalizeSnapshotToTelemetry(record.snapshot, {
    missionId,
    receivedAtMs: record.receivedAtMs,
  });
  const skipped = conversion.ok ? conversion.value.skipped : [];
  return {
    sequence: snapshot.sequence,
    simulatorTimeMs: snapshot.simulatorTimeMs,
    kernelState: snapshot.kernelState,
    receiptAtMs: record.receivedAtMs,
    receiptClock: "fixture-epoch-base+ordinal (not UTC, not simulator time)",
    robots: snapshot.robots.map((robot) => ({
      robotId: robot.robotId,
      role: robot.role,
      pose: robot.pose,
      fresh: robot.fresh,
      staleness: robot.staleness,
      linkState: robot.linkState,
      activeOpticalFault:
        robot.activeOpticalFault === null
          ? null
          : {
              severity: robot.activeOpticalFault.severity,
              startedAtSimMs: robot.activeOpticalFault.startedAtSimMs,
              expiresAtSimMs: robot.activeOpticalFault.expiresAtSimMs,
            },
      sensors: robot.sensors.map((sensor) => ({
        sensorId: sensor.sensorId,
        kind: sensor.kind,
        measured:
          sensor.measured === null
            ? null
            : {
                quality01: sensor.measured.quality01,
                opticalVisibilityFactorApplied: sensor.measured.opticalVisibilityFactorApplied,
              },
        coverage: sensor.coverage,
      })),
    })),
    telemetryEmitted: record.telemetry.length,
    telemetrySkipped: skipped.map((s) => ({ robotId: s.robotId, reason: s.reason })),
  };
}

/**
 * Derive the canonical guest trace: run the shared kernel transport, feed
 * the actual snapshots through the merged journal, and render the paged
 * read-only view. Throws DemoKernelRejection for kernel-rejected operations
 * (the route maps it to HTTP 422).
 */
export function deriveGuestTrace({ seed, operations, cursor }: DeriveTraceOptions): TraceDerivation {
  // 1. Same kernel execution as POST /api/demo/simulation (shared module).
  const execution = executeDemoSimulation({ seed, operations });

  // 2. Same canonical journal derivation as everywhere else in the mission
  //    simulation slice (merged source-aware journal, fixture receipt clock).
  const missionId = guestMissionIdForSeed(seed);
  const created = createGuestObservationJournal({
    missionId,
    seed,
    maxRecords: Math.max(1, execution.snapshots.length),
  });
  if (!created.ok) {
    throw new DemoKernelRejection("validation_error", created.error.message, -1);
  }
  let journal = created.value;
  for (const snapshot of execution.snapshots) {
    const result = appendKernelSnapshot(journal, snapshot);
    if (result.ok) {
      journal = result.journal;
    } else {
      // A real kernel stream is dense and identity-matched; any rejection
      // here is an invariant breach and must fail loudly, not silently.
      throw new DemoKernelRejection(result.error.code, result.error.message, snapshot.sequence);
    }
  }

  // 3. Deterministic paged slice over the accepted records.
  const inRange = journal.records.filter((record) => record.snapshot.sequence > cursor.afterSequence);
  const page = inRange.slice(0, cursor.limit);
  const records = page.map((record) => toTraceRecord(record, missionId));
  const lastSequence = page.length > 0 ? page[page.length - 1]?.snapshot.sequence ?? null : null;
  const hasMore = inRange.length > page.length;

  const response: GuestTraceResponse = {
    schema: TRACE_RESPONSE_SCHEMA,
    scenarioId: execution.scenarioId,
    seed,
    missionId,
    sourceKind: execution.sourceKind,
    frameId: execution.frameId,
    positionUnits: execution.positionUnits,
    stepMs: execution.stepMs,
    clockDomains: {
      simulator: "kernel simulatorTimeMs (fixed 500ms steps, integer)",
      receipt: "fixture-epoch-base+ordinal (not UTC, not simulator time)",
      chain: null,
    },
    journal: {
      recordsAccepted: journal.records.length,
      rejectedAppends: journal.rejectedAppends,
      sequenceGaps: journal.sequenceGaps,
    },
    trace: {
      totalSnapshots: journal.records.length,
      returnedFromSequence: records.length > 0 ? records[0]?.sequence ?? null : null,
      returnedToSequence: lastSequence,
      records,
    },
    paging: {
      nextAfterSequence: hasMore ? lastSequence : null,
      hasMore,
    },
    commandResults: execution.commandResults,
    state: execution.state,
    operations: execution.operations,
    derivation: "stateless: recomputed from the supplied seed + bounded operation trace on every request",
  };
  return { response };
}
