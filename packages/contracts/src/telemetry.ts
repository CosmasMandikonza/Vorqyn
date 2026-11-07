/**
 * VORQYN shared contracts — telemetry normalization (VQ-01 / issue #2).
 *
 * TelemetrySample is the transport envelope every adapter (VQ-08 kernel,
 * VQ-09 SITL, replay fixtures) must emit. Field names deliberately match
 * the Lane-2 simulation kernel vocabulary (simulatorTimeMs, sequence,
 * sourceKind, frameId) and the world frame contract
 * (services/simulation/integration/FRAME_CONTRACT.md): local ENU frame,
 * metre units, z-up, waterline z=0.
 */

import {
  asEpochMs,
  asLamports,
  asMissionId,
  asRobotId,
  asSimulatorTimeMs,
  err,
  ok,
  type EpochMs,
  type Lamports,
  type MissionId,
  type Result,
  type RobotId,
  type SimulatorTimeMs,
} from "./core";
import type { SourceKind } from "./enums";

export const TELEMETRY_UNITS = "metres" as const;
export const TELEMETRY_FRAME_PATTERN = /^ENU_[A-Z0-9-]{3,28}_LOCAL$/;

export type TelemetryQualityStatus = "ok" | "degraded" | "link_disconnected";

export interface TelemetryQuality {
  readonly status: TelemetryQualityStatus;
  /** Free-form measured cause, e.g. "optical-visibility-below-threshold". */
  readonly detail?: string;
}

/** Position in the mission's local ENU frame, metres, z-up. */
export interface EnuPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Orientation in degrees relative to the frame axes. */
export interface OrientationDeg {
  readonly heading: number;
  readonly pitch?: number;
  readonly roll?: number;
}

export interface TelemetrySample {
  readonly missionId: MissionId;
  readonly robotId: RobotId;
  readonly sourceKind: SourceKind;
  /** Source clock (kernel simulatorTimeMs or SITL onboard time), integer ms. */
  readonly sourceTimestampMs: SimulatorTimeMs;
  /** Service receipt wall-clock, integer epoch ms — a different clock domain. */
  readonly receivedAtMs: EpochMs;
  readonly frameId: string;
  readonly sequence: number;
  readonly position: EnuPosition;
  readonly orientationDeg?: OrientationDeg;
  readonly units: typeof TELEMETRY_UNITS;
  readonly quality: TelemetryQuality;
  /** Optional measured quality metric used by evidence policy (e.g. visibility metres). */
  readonly qualityMetric?: { readonly kind: string; readonly value: number };
  /** Optional reward-relevant cost reading (lamports); reserved for budget accounting. */
  readonly costLamports?: Lamports;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const makeTelemetrySample = (input: {
  missionId: string;
  robotId: string;
  sourceKind: SourceKind;
  sourceTimestampMs: number;
  receivedAtMs: number;
  frameId: string;
  sequence: number;
  position: { x: number; y: number; z: number };
  orientationDeg?: { heading: number; pitch?: number; roll?: number };
  quality: { status: TelemetryQualityStatus; detail?: string };
  qualityMetric?: { kind: string; value: number };
  costLamports?: number;
}): Result<TelemetrySample> => {
  const missionId = asMissionId(input.missionId);
  if (!missionId.ok) return missionId;
  const robotId = asRobotId(input.robotId);
  if (!robotId.ok) return robotId;
  const sourceTimestampMs = asSimulatorTimeMs(input.sourceTimestampMs);
  if (!sourceTimestampMs.ok) return sourceTimestampMs;
  const receivedAtMs = asEpochMs(input.receivedAtMs);
  if (!receivedAtMs.ok) return receivedAtMs;
  if (!TELEMETRY_FRAME_PATTERN.test(input.frameId))
    return err("validation_error", `frameId "${input.frameId}" must match ENU_<SITE>_LOCAL (world frame contract)`);
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0)
    return err("validation_error", "telemetry sequence must be a non-negative integer");
  const { position } = input;
  if (![position.x, position.y, position.z].every(isFiniteNumber))
    return err("validation_error", "position components must be finite numbers");

  let orientationDeg: OrientationDeg | undefined;
  if (input.orientationDeg !== undefined) {
    if (!isFiniteNumber(input.orientationDeg.heading))
      return err("validation_error", "orientation heading must be finite degrees");
    orientationDeg = { ...input.orientationDeg };
  }
  let qualityMetric: { kind: string; value: number } | undefined;
  if (input.qualityMetric !== undefined) {
    if (input.qualityMetric.kind.trim().length === 0 || !isFiniteNumber(input.qualityMetric.value))
      return err("validation_error", "qualityMetric needs a kind and a finite value");
    qualityMetric = { ...input.qualityMetric };
  }
  let costLamports: Lamports | undefined;
  if (input.costLamports !== undefined) {
    const cost = asLamports(input.costLamports);
    if (!cost.ok) return cost;
    costLamports = cost.value;
  }
  return ok({
    missionId: missionId.value,
    robotId: robotId.value,
    sourceKind: input.sourceKind,
    sourceTimestampMs: sourceTimestampMs.value,
    receivedAtMs: receivedAtMs.value,
    frameId: input.frameId,
    sequence: input.sequence,
    position: { x: position.x, y: position.y, z: position.z },
    units: TELEMETRY_UNITS,
    quality: { status: input.quality.status, ...(input.quality.detail !== undefined ? { detail: input.quality.detail } : {}) },
    ...(orientationDeg !== undefined ? { orientationDeg } : {}),
    ...(qualityMetric !== undefined ? { qualityMetric } : {}),
    ...(costLamports !== undefined ? { costLamports } : {}),
  });
};

// ---------------------------------------------------------------------------
// Deterministic sample application (stale/out-of-order defence)
// ---------------------------------------------------------------------------

export interface RobotTelemetryTrack {
  readonly robotId: RobotId;
  /** Last applied sample (frozen pose while a link is down). */
  lastSample: TelemetrySample;
  /** Highest sequence applied for this robot. */
  lastSequence: number;
  /** Count of rejected out-of-order/duplicate deliveries (audit counter). */
  rejectedCount: number;
}

export type TelemetryStore = Readonly<Record<string, RobotTelemetryTrack>>;

/**
 * Pure per-robot sample application. Rules (ARCHITECTURE.md §5):
 * - sequence must be strictly greater than the last applied sequence;
 * - duplicates and out-of-order samples are REJECTED, never reordered in;
 * - a link_disconnected sample freezes the last good pose (the caller keeps
 *   displaying lastSample; the kernel does the same).
 */
export function applyTelemetrySample(
  store: TelemetryStore,
  sample: TelemetrySample,
): Result<TelemetryStore> {
  const track = store[sample.robotId];
  if (track === undefined) {
    return ok({ ...store, [sample.robotId]: { robotId: sample.robotId, lastSample: sample, lastSequence: sample.sequence, rejectedCount: 0 } });
  }
  if (sample.sequence <= track.lastSequence) {
    return err(
      "validation_error",
      `stale or duplicate telemetry for ${sample.robotId}: sequence ${sample.sequence} <= applied ${track.lastSequence}`,
    );
  }
  return ok({
    ...store,
    [sample.robotId]: {
      robotId: track.robotId,
      lastSample: sample,
      lastSequence: sample.sequence,
      rejectedCount: track.rejectedCount,
    },
  });
}

/**
 * Record a rejected delivery on the audit counter without changing the
 * authoritative pose (used when callers choose to log-and-continue).
 */
export function noteRejectedTelemetry(store: TelemetryStore, robotId: string): TelemetryStore {
  const track = store[robotId];
  if (track === undefined) return store;
  return { ...store, [robotId]: { ...track, rejectedCount: track.rejectedCount + 1 } };
}
