/**
 * Typed client view of the frozen VQ-DEMO-SIM/1 transport contract
 * (Issues #32/#33). This module mirrors the contract documented in both
 * issues and in `services/simulation/core`; it does not own the protocol.
 *
 * The API endpoint itself (apps/web/app/api/**) is owned by Agent A; this
 * file only validates that responses match the frozen shape so a broken or
 * drifted transport fails loudly instead of rendering invented state.
 */
import type { SceneVec3 } from "../enu";
import { enuToScene } from "../enu";

export const DEMO_SIM_REQUEST_SCHEMA = "vorqyn.demo-sim/request/1";
export const DEMO_SIM_RESPONSE_SCHEMA = "vorqyn.demo-sim/response/1";
export const DEMO_SIM_ERROR_SCHEMA = "vorqyn.demo-sim/error/1";
export const EXPECTED_SOURCE_KIND = "SYNTHETIC_SIM";
export const EXPECTED_FRAME_ID = "ENU_PORT-001_LOCAL";

export const DEMO_SEED = 20261107;
/** Contract limits (client enforces the same budget the server does). */
export const MAX_TOTAL_STEPS = 400;
export const MAX_STEP_COUNT_PER_OP = 12;

export type DemoRobotId = "drone-01" | "rover-01" | "rov-01";

export interface DemoSimStepOperation {
  op: "step";
  count: number;
}

export type DemoSimCommandType =
  | "pause"
  | "resume"
  | "stop"
  | "injectOpticalVisibilityFault"
  | "clearOpticalVisibilityFault"
  | "disconnectTelemetry"
  | "reconnectTelemetry";

export interface DemoSimFaultCommand {
  type: "injectOpticalVisibilityFault";
  robotId: DemoRobotId;
  severity: "moderate" | "severe";
  durationMs: number;
  idempotencyKey: string;
}

export type DemoSimCommand =
  | ({ type: DemoSimCommandType; idempotencyKey: string } & Record<string, string | number>)
  | DemoSimFaultCommand;

export type DemoSimOperation = DemoSimStepOperation | { op: "command"; command: DemoSimCommand };

export interface DemoSimRequest {
  schema: typeof DEMO_SIM_REQUEST_SCHEMA;
  seed: number;
  operations: DemoSimOperation[];
}

export interface DemoSensorMeasured {
  quality01: number;
  qualityUnits: string;
  opticalVisibilityFactorApplied: number | null;
}

export interface DemoCoverage {
  modelCellsVisited: number;
  modelCellsTotal: number;
  coverage01: number;
}

export interface DemoSensorView {
  sensorId: string;
  kind: string;
  measured: DemoSensorMeasured | null;
  coverage: DemoCoverage;
}

export interface DemoActiveFault {
  faultId: string;
  kind: string;
  severity: string;
  startedAtSimMs: number;
  expiresAtSimMs: number;
}

export interface DemoRobotView {
  robotId: DemoRobotId | string;
  role: string;
  pose: { x: number; y: number; z: number };
  waypointIndex: number;
  speedMps: number;
  linkState: string;
  fresh: boolean;
  staleness: "none" | "kernel-paused" | "link-disconnected";
  staleSinceSimMs: number | null;
  activeOpticalFault: DemoActiveFault | null;
  sensors: DemoSensorView[];
}

export interface DemoSnapshot {
  sequence: number;
  simulatorTimeMs: number;
  stepIndex: number;
  kernelState: string;
  appliedStepMs: number;
  robots: DemoRobotView[];
  provenance: {
    sourceKind: string;
    scenarioId: string;
    seed: number;
    frameId: string;
    positionUnits: string;
    simulatorClock: string;
  };
}

export interface DemoCommandResult {
  operationIndex: number;
  ok: boolean;
  duplicate?: boolean;
  [extra: string]: unknown;
}

export interface DemoKernelState {
  kernelState: string;
  stepIndex: number;
  simulatorTimeMs: number;
  sequence: number;
  scenarioId: string;
  seed: number;
  stepMs: number;
  robots: Array<{ robotId: string; pose: { x: number; y: number; z: number } } & Record<string, unknown>>;
}

export interface DemoSimResponse {
  schema: string;
  scenarioId: string;
  seed: number;
  sourceKind: string;
  frameId: string;
  positionUnits: string;
  stepMs: number;
  operations: DemoSimOperation[];
  snapshots: DemoSnapshot[];
  commandResults: DemoCommandResult[];
  state: DemoKernelState;
}

export class DemoContractError extends Error {
  constructor(details: string[]) {
    super(`demo-sim response failed contract validation: ${details.join("; ")}`);
    this.name = "DemoContractError";
  }
}

function finitePose(pose: unknown): pose is { x: number; y: number; z: number } {
  const p = pose as { x?: unknown; y?: unknown; z?: unknown };
  return (
    typeof p?.x === "number" && Number.isFinite(p.x) &&
    typeof p?.y === "number" && Number.isFinite(p.y) &&
    typeof p?.z === "number" && Number.isFinite(p.z)
  );
}

/** Validate a parsed payload against the frozen response shape. */
export function validateDemoSimResponse(data: unknown): DemoSimResponse {
  const d = data as Partial<DemoSimResponse>;
  const problems: string[] = [];
  if (d.schema !== DEMO_SIM_RESPONSE_SCHEMA) problems.push(`schema "${String(d.schema)}"`);
  if (d.sourceKind !== EXPECTED_SOURCE_KIND) problems.push(`sourceKind "${String(d.sourceKind)}" (must be ${EXPECTED_SOURCE_KIND})`);
  if (d.frameId !== EXPECTED_FRAME_ID) problems.push(`frameId "${String(d.frameId)}"`);
  if (d.positionUnits !== "m") problems.push(`positionUnits "${String(d.positionUnits)}"`);
  if (!(typeof d.stepMs === "number" && Number.isInteger(d.stepMs) && d.stepMs > 0)) problems.push("stepMs must be a positive integer");
  if (!Array.isArray(d.snapshots)) problems.push("snapshots must be an array");
  else {
    for (const [index, snap] of d.snapshots.entries()) {
      if (!Array.isArray(snap.robots) || snap.robots.length === 0) {
        problems.push(`snapshot ${index}: no robots`);
        continue;
      }
      for (const robot of snap.robots) {
        if (!finitePose(robot.pose)) problems.push(`snapshot ${index} robot ${robot.robotId}: non-finite pose`);
      }
      if (snap.provenance?.sourceKind !== EXPECTED_SOURCE_KIND) {
        problems.push(`snapshot ${index}: provenance.sourceKind drift`);
      }
    }
  }
  if (!d.state || typeof d.state !== "object") problems.push("state missing");
  if (problems.length > 0) throw new DemoContractError(problems);
  return d as DemoSimResponse;
}

/** The one ENU -> scene conversion application for kernel poses. */
export function demoPoseToScene(pose: { x: number; y: number; z: number }): SceneVec3 {
  return enuToScene([pose.x, pose.y, pose.z]);
}

export function totalSimulatedSteps(operations: DemoSimOperation[]): number {
  return operations.reduce((sum, op) => (op.op === "step" ? sum + op.count : sum), 0);
}

/**
 * Client-side request guard mirroring the server's contract limits: builds
 * the envelope or throws before a wasted network round-trip. The server
 * remains the authority; this exists to fail fast in the operator's hand.
 */
export function buildClientRequestGuard(
  seed: number,
  operations: DemoSimOperation[],
): DemoSimRequest {
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    throw new RangeError(`seed must be an unsigned 32-bit integer, got ${seed}`);
  }
  if (operations.length > 100) {
    throw new RangeError(`operations must not exceed 100 entries, got ${operations.length}`);
  }
  const total = totalSimulatedSteps(operations);
  if (total > MAX_TOTAL_STEPS) {
    throw new RangeError(`trace exceeds the ${MAX_TOTAL_STEPS} simulated-step budget (got ${total})`);
  }
  for (const op of operations) {
    if (op.op === "step") {
      if (!Number.isInteger(op.count) || op.count < 1 || op.count > MAX_STEP_COUNT_PER_OP) {
        throw new RangeError(
          `step count must be an integer in [1, ${MAX_STEP_COUNT_PER_OP}] (per-operation contract limit), got ${op.count}`,
        );
      }
    }
  }
  return { schema: DEMO_SIM_REQUEST_SCHEMA, seed, operations };
}
