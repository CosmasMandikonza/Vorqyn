/**
 * Frozen transport contract `VQ-DEMO-SIM/1` (issue #32) — types and limits.
 *
 * This is the guest-only synthetic replay transport over the pure,
 * world-aligned simulation kernel (`services/simulation/core/**`, issues
 * #20/#24). It is NOT a mission backend, an authenticated service, an
 * evidence verifier, an AI planner or a Solana authority. It synthesizes no
 * MissionEvents, evidence verdicts, payouts, session tokens or wall-clock
 * timestamps; the only clock in play is the kernel's integer
 * `simulatorTimeMs`.
 *
 * Contract owned by Lane 2 Agent A. The independent viewer agent (Agent B)
 * builds against this exact shape and may mock it until this merges.
 *
 * Stateless by design: every request carries the full seed + ordered
 * operation trace and the server reconstructs the kernel from scratch, so
 * parallel judges or serverless worker churn cannot mix sessions.
 */

import type { DemoSnapshot, DemoState } from "../../../../services/simulation/demo/kernel-adapter.d.mts";

/** Exact request schema discriminator. */
export const REQUEST_SCHEMA = "vorqyn.demo-sim/request/1" as const;
/** Exact success response schema discriminator. */
export const RESPONSE_SCHEMA = "vorqyn.demo-sim/response/1" as const;
/** Exact error response schema discriminator. */
export const ERROR_SCHEMA = "vorqyn.demo-sim/error/1" as const;

/** Default demo seed used when a request omits `seed`. */
export const DEFAULT_DEMO_SEED = 20261107 as const;

/** Frozen request limits from issue #32. */
export const LIMITS = Object.freeze({
  /** Maximum serialized request body size (16 KiB). */
  maxBodyBytes: 16 * 1024,
  /** Maximum number of operations in one trace. */
  maxOperations: 100,
  /** Per-`step` operation bounds. */
  minStepCount: 1,
  maxStepCount: 12,
  /** Maximum total simulated steps across all step operations. */
  maxTotalSteps: 400,
} as const);

/** The kernel command types the transport forwards (exact kernel fields). */
export const ALLOWED_COMMAND_TYPES = Object.freeze([
  "pause",
  "resume",
  "stop",
  "injectOpticalVisibilityFault",
  "clearOpticalVisibilityFault",
  "disconnectTelemetry",
  "reconnectTelemetry",
] as const);

export type AllowedCommandType = (typeof ALLOWED_COMMAND_TYPES)[number];

/** `{"op":"step","count":N}` — advance N×500 ms of simulator time. */
export interface StepOperation {
  op: "step";
  count: number;
}

/** `{"op":"command","command":{...}}` — one kernel control command. */
export interface CommandOperation {
  op: "command";
  command: { type: string; [key: string]: unknown };
}

export type DemoOperation = StepOperation | CommandOperation;

/** Validated request. `seed` is optional in the payload (defaults to DEFAULT_DEMO_SEED). */
export interface DemoSimRequest {
  schema: typeof REQUEST_SCHEMA;
  seed: number;
  operations: DemoOperation[];
}

/** Actual kernel result for one accepted command operation. */
export interface DemoCommandResultView {
  /** Index of the operation in the request `operations` array. */
  operationIndex: number;
  ok: boolean;
  duplicate: boolean;
  failure: { code: string; message: string } | null;
}

/** Success response body (VQ-DEMO-SIM/1). */
export interface DemoSimResponse {
  schema: typeof RESPONSE_SCHEMA;
  scenarioId: string;
  seed: number;
  sourceKind: string;
  frameId: string;
  positionUnits: string;
  stepMs: number;
  /** Validated/accepted operations exactly as sent. */
  operations: DemoOperation[];
  /** Unmodified kernel observation snapshots for the whole trace. */
  snapshots: DemoSnapshot[];
  /** Actual kernel outcomes for accepted command operations. */
  commandResults: DemoCommandResultView[];
  /** Unmodified final kernel state snapshot. */
  state: DemoState;
}

/** Error response body (VQ-DEMO-SIM/1): safe code + message, nothing else. */
export interface DemoSimError {
  schema: typeof ERROR_SCHEMA;
  error: { code: string; message: string };
}

/**
 * Transport-level (HTTP 400) validation failure. Command-level kernel
 * rejections surface separately as 422 with the kernel's own codes.
 */
export class DemoRequestError extends Error {
  readonly code: string;
  readonly status: 400 | 413;

  constructor(code: string, message: string, status: 400 | 413 = 400) {
    super(message);
    this.name = "DemoRequestError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Kernel-level rejection (HTTP 422): the kernel refused a structurally
 * valid operation. The request as a whole is rejected — a rejected
 * operation is never committed to a replayable trace.
 */
export class DemoKernelRejection extends Error {
  readonly code: string;
  readonly operationIndex: number;

  constructor(code: string, message: string, operationIndex: number) {
    super(message);
    this.name = "DemoKernelRejection";
    this.code = code;
    this.operationIndex = operationIndex;
  }
}
