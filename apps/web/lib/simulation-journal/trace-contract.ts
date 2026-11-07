/**
 * Frozen transport contract `VQ-GUEST-TRACE/1` (issue #9 guest integration
 * slice) — types and limits for POST /api/demo/observations.
 *
 * This endpoint is a TRACE/DIAGNOSTIC view over the existing real kernel
 * transport: it accepts the SAME validated bounded `vorqyn.demo-sim/request/1`
 * body as POST /api/demo/simulation (reusing that contract's parser and
 * kernel execution verbatim), derives a canonical observation journal through
 * the merged source-aware bridge, and returns an explicit read-only trace.
 *
 * It is NOT a second simulator, NOT an authoritative mission API and holds
 * no lifecycle/verifier/chain privilege: responses contain no funding,
 * verifier acceptance, chain timestamps, AI proposals, wallets or
 * transaction fields, and no server-side persistent sessions exist — every
 * request recomputes the trace from the bounded operation trace (labelled
 * honestly as stateless).
 *
 * Paging contract: deterministic and stateless via URL query parameters on
 * the same POST (the body stays pure VQ-DEMO-SIM/1):
 *   ?afterSequence=<uint>  return only records with snapshot.sequence > N
 *   ?limit=<uint>          return at most N records (1..400)
 * The same request + same cursor always yields a byte-identical response.
 */

import { LIMITS, REQUEST_SCHEMA } from "@/lib/demo-simulation/contract";
import type { DemoCommandResultView, DemoOperation } from "@/lib/demo-simulation/contract";
import type { DemoSnapshot, DemoState } from "../../../../services/simulation/demo/kernel-adapter.d.mts";

/** This endpoint consumes the DEMO-SIM/1 request schema unchanged. */
export const TRACE_REQUEST_SCHEMA = REQUEST_SCHEMA;
/** Success response schema discriminator for the guest observation trace. */
export const TRACE_RESPONSE_SCHEMA = "vorqyn.guest-trace/response/1" as const;
/** Error response schema discriminator for the guest observation trace. */
export const TRACE_ERROR_SCHEMA = "vorqyn.guest-trace/error/1" as const;

/**
 * Deterministic guest stream identity: `guest-port-<seed>`. The journal is
 * stateless — identity is derived per request, so two seeds are two
 * isolated streams by construction.
 */
export function guestMissionIdForSeed(seed: number): string {
  return `guest-port-${seed}`;
}

/** Deterministic paging cursor parsed from the URL query string. */
export interface TraceCursor {
  /** Return records with snapshot.sequence strictly greater than this. */
  readonly afterSequence: number;
  /** Maximum records to return (bounded by the kernel step budget). */
  readonly limit: number;
}

export interface TraceRobotSensorView {
  readonly sensorId: string;
  readonly kind: string;
  /** null when the kernel recorded no fresh measurement (paused/link-down). */
  readonly measured: {
    readonly quality01: number;
    readonly opticalVisibilityFactorApplied: number | null;
  } | null;
  readonly coverage: { readonly modelCellsVisited: number; readonly modelCellsTotal: number; readonly coverage01: number };
}

export interface TraceRobotView {
  readonly robotId: string;
  readonly role: string;
  readonly pose: { readonly x: number; readonly y: number; readonly z: number };
  readonly fresh: boolean;
  readonly staleness: string;
  readonly linkState: string;
  readonly activeOpticalFault: { readonly severity: string; readonly startedAtSimMs: number; readonly expiresAtSimMs: number } | null;
  readonly sensors: readonly TraceRobotSensorView[];
}

export interface TraceRecordView {
  /** Kernel snapshot sequence (dense, strictly increasing). */
  readonly sequence: number;
  /** Simulator clock (domain 1) — never a UTC epoch. */
  readonly simulatorTimeMs: number;
  readonly kernelState: string;
  /** Service receipt clock (domain 2), fixture-labelled. */
  readonly receiptAtMs: number;
  readonly receiptClock: "fixture-epoch-base+ordinal (not UTC, not simulator time)";
  readonly robots: readonly TraceRobotView[];
  /** Contract-validated telemetry derived by the merged bridge at append time. */
  readonly telemetryEmitted: number;
  readonly telemetrySkipped: readonly { readonly robotId: string; readonly reason: string }[];
}

export interface GuestTraceResponse {
  schema: typeof TRACE_RESPONSE_SCHEMA;
  scenarioId: string;
  seed: number;
  /** Deterministic guest stream identity (mission-id lexical rule of the contracts). */
  missionId: string;
  sourceKind: string;
  frameId: string;
  positionUnits: string;
  stepMs: number;
  /** Explicit clock-domain labels; chain time does not exist in this slice. */
  clockDomains: {
    readonly simulator: "kernel simulatorTimeMs (fixed 500ms steps, integer)";
    readonly receipt: "fixture-epoch-base+ordinal (not UTC, not simulator time)";
    readonly chain: null;
  };
  journal: {
    readonly recordsAccepted: number;
    readonly rejectedAppends: readonly { readonly attemptedSequence: number | null; readonly code: string; readonly message: string }[];
    readonly sequenceGaps: readonly { readonly fromSequence: number; readonly toSequence: number }[];
  };
  trace: {
    readonly totalSnapshots: number;
    readonly returnedFromSequence: number | null;
    readonly returnedToSequence: number | null;
    readonly records: readonly TraceRecordView[];
  };
  paging: {
    readonly nextAfterSequence: number | null;
    readonly hasMore: boolean;
  };
  /** Actual kernel outcomes for accepted command operations (from the shared transport). */
  commandResults: readonly DemoCommandResultView[];
  /** Unmodified final kernel state snapshot. */
  state: DemoState;
  /** The accepted operations exactly as sent (DEMO-SIM/1 echo). */
  operations: readonly DemoOperation[];
  /** Honest statelessness label. */
  derivation: "stateless: recomputed from the supplied seed + bounded operation trace on every request";
}

/** Error response body (VQ-GUEST-TRACE/1): safe code + message, nothing else. */
export interface GuestTraceError {
  schema: typeof TRACE_ERROR_SCHEMA;
  error: { code: string; message: string };
}

/** Cursor limits mirror the kernel step budget so responses stay bounded. */
export const TRACE_CURSOR_LIMITS = Object.freeze({
  maxAfterSequence: LIMITS.maxTotalSteps,
  minLimit: 1,
  maxLimit: LIMITS.maxTotalSteps,
} as const);

export type { DemoSnapshot };
