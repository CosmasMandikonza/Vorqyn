/**
 * Hand-written type declarations for `./kernel-adapter.mjs`.
 *
 * This is a structural MIRROR of the read-only kernel's public surface
 * (`services/simulation/core/**`, issues #20/#24) — the kernel remains the
 * source of truth for behavior, and its own node:test suites plus the demo
 * transport tests guard this mirror against drift. Fields are the emitted
 * observation/state shapes documented in services/simulation/core/README.md.
 *
 * Shapes intentionally use `unknown` for payload sub-objects the transport
 * merely forwards (snapshots/state are serialized verbatim); the fields the
 * DEMO-SIM/1 contract exposes are typed precisely.
 */

export interface DemoPose {
  x: number;
  y: number;
  z: number;
}

export interface DemoCoverage {
  modelCellsVisited: number;
  modelCellsTotal: number;
  coverage01: number;
}

export interface DemoMeasurement {
  quality01: number;
  qualityUnits: string;
  opticalVisibilityFactorApplied: number | null;
}

export interface DemoSensorSnapshot {
  sensorId: string;
  kind: "optical" | "sonar";
  /** null while paused/disconnected: no fabricated fresh readings. */
  measured: DemoMeasurement | null;
  coverage: DemoCoverage;
}

export interface DemoRobotSnapshot {
  robotId: string;
  role: string;
  pose: DemoPose;
  waypointIndex: number;
  speedMps: number;
  linkState: "connected" | "disconnected";
  fresh: boolean;
  staleness: "none" | "kernel-paused" | "link-disconnected";
  staleSinceSimMs: number | null;
  activeOpticalFault: {
    faultId: string;
    kind: string;
    severity: string;
    startedAtSimMs: number;
    expiresAtSimMs: number;
  } | null;
  sensors: DemoSensorSnapshot[];
}

export interface DemoSnapshot {
  sequence: number;
  simulatorTimeMs: number;
  stepIndex: number;
  kernelState: "running" | "paused" | "stopped";
  appliedStepMs: number;
  robots: DemoRobotSnapshot[];
  provenance: {
    sourceKind: string;
    scenarioId: string;
    seed: number;
    frameId: string;
    positionUnits: string;
    simulatorClock: string;
  };
}

export interface DemoStateRobot {
  robotId: string;
  role: string;
  pose: DemoPose;
  waypointIndex: number;
  linkState: "connected" | "disconnected";
  activeOpticalFault: unknown;
  faultHistory: unknown[];
}

export interface DemoState {
  kernelState: "running" | "paused" | "stopped";
  stepIndex: number;
  simulatorTimeMs: number;
  sequence: number;
  scenarioId: string;
  seed: number;
  stepMs: number;
  robots: DemoStateRobot[];
}

export type DemoCommandType =
  | "pause"
  | "resume"
  | "stop"
  | "injectOpticalVisibilityFault"
  | "clearOpticalVisibilityFault"
  | "disconnectTelemetry"
  | "reconnectTelemetry";

export interface DemoCommandResult {
  ok: true;
  duplicate: boolean;
  fault?: unknown;
  cleared?: unknown;
  reason?: unknown;
  linkState?: unknown;
  changed?: unknown;
  original?: unknown;
}

export interface DemoCommandFailure {
  ok: false;
  failure: { code: string; message: string };
}

export interface DemoKernel {
  readonly config: {
    readonly scenarioId: string;
    readonly seed: number;
    readonly stepMs: number;
  };
  step(count?: number): DemoSnapshot;
  issueCommand(command: Record<string, unknown>): DemoCommandResult | DemoCommandFailure;
  getState(): DemoState;
  getObservationLog(): readonly DemoSnapshot[];
  getCommandAuditLog(): readonly unknown[];
  getRunTrace(): readonly unknown[];
}

/** Construct the deterministic world-aligned scenario kernel (uint32 seed). */
export function createScenarioKernel(options: { seed: number }): DemoKernel;

/** Thrown by step() on a stopped kernel; transport maps it to HTTP 422. */
export class KernelStoppedError extends Error {
  code: "kernel_stopped";
}

/** Fixed provenance constants emitted by the kernel (world-aligned, #24). */
export const SOURCE_KIND_SYNTHETIC_SIM: "SYNTHETIC_SIM";
export const SCENARIO_ID: "PORT-001";
export const STEP_MS: 500;
export const FRAME_ID: "ENU_PORT-001_LOCAL";
export const POSITION_UNITS: "m";
