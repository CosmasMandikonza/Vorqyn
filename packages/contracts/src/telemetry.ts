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
  isRecord,
  ok,
  type EpochMs,
  type Lamports,
  type MissionId,
  type Result,
  type RobotId,
  type SimulatorTimeMs,
} from "./core";
import { SOURCE_KINDS, type SourceKind } from "./enums";

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

export function makeTelemetrySample(input: unknown): Result<TelemetrySample> {
  if (!isRecord(input)) return err("validation_error", "telemetry sample must be an object");
  const missionIdRaw = input.missionId;
  if (typeof missionIdRaw !== "string") return err("validation_error", "missionId must be a string");
  const missionId = asMissionId(missionIdRaw);
  if (!missionId.ok) return missionId;
  const robotIdRaw = input.robotId;
  if (typeof robotIdRaw !== "string") return err("validation_error", "robotId must be a string");
  const robotId = asRobotId(robotIdRaw);
  if (!robotId.ok) return robotId;
  const sourceKind = input.sourceKind;
  if (typeof sourceKind !== "string" || !(SOURCE_KINDS as readonly string[]).includes(sourceKind))
    return err("validation_error", `sourceKind must be one of [${SOURCE_KINDS.join("|")}]`);
  if (typeof input.sourceTimestampMs !== "number") return err("validation_error", "sourceTimestampMs must be a number");
  const sourceTimestampMs = asSimulatorTimeMs(input.sourceTimestampMs);
  if (!sourceTimestampMs.ok) return sourceTimestampMs;
  if (typeof input.receivedAtMs !== "number") return err("validation_error", "receivedAtMs must be a number");
  const receivedAtMs = asEpochMs(input.receivedAtMs);
  if (!receivedAtMs.ok) return receivedAtMs;
  if (typeof input.frameId !== "string" || !TELEMETRY_FRAME_PATTERN.test(input.frameId))
    return err("validation_error", `frameId "${String(input.frameId)}" must match ENU_<SITE>_LOCAL (world frame contract)`);
  const sequence = input.sequence;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0)
    return err("validation_error", "telemetry sequence must be a non-negative integer");
  if (!isRecord(input.position))
    return err("validation_error", "position must be an object with finite x/y/z");
  const { x, y, z } = input.position;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z))
    return err("validation_error", "position components must be finite numbers");
  if (!isRecord(input.quality) || typeof input.quality.status !== "string" ||
    !["ok", "degraded", "link_disconnected"].includes(input.quality.status))
    return err("validation_error", "quality must be { status: ok|degraded|link_disconnected }");
  const qualityDetail = input.quality.detail;
  if (qualityDetail !== undefined && typeof qualityDetail !== "string")
    return err("validation_error", "quality.detail must be a string");

  let orientationDeg: OrientationDeg | undefined;
  if (input.orientationDeg !== undefined) {
    const raw = input.orientationDeg;
    if (!isRecord(raw) || !isFiniteNumber(raw.heading))
      return err("validation_error", "orientationDeg must be an object with finite heading degrees");
    const pitch = raw.pitch;
    const roll = raw.roll;
    orientationDeg = {
      heading: raw.heading,
      ...(isFiniteNumber(pitch) ? { pitch } : {}),
      ...(isFiniteNumber(roll) ? { roll } : {}),
    };
  }
  let qualityMetric: { kind: string; value: number } | undefined;
  if (input.qualityMetric !== undefined) {
    if (!isRecord(input.qualityMetric) || typeof input.qualityMetric.kind !== "string" ||
      input.qualityMetric.kind.trim().length === 0 || !isFiniteNumber(input.qualityMetric.value))
      return err("validation_error", "qualityMetric needs a kind and a finite value");
    qualityMetric = { kind: input.qualityMetric.kind, value: input.qualityMetric.value };
  }
  let costLamports: Lamports | undefined;
  if (input.costLamports !== undefined) {
    if (typeof input.costLamports !== "number") return err("validation_error", "costLamports must be a number");
    const cost = asLamports(input.costLamports);
    if (!cost.ok) return cost;
    costLamports = cost.value;
  }
  return ok({
    missionId: missionId.value,
    robotId: robotId.value,
    sourceKind: sourceKind as SourceKind,
    sourceTimestampMs: sourceTimestampMs.value,
    receivedAtMs: receivedAtMs.value,
    frameId: input.frameId,
    sequence,
    position: { x, y, z },
    units: TELEMETRY_UNITS,
    quality: {
      status: input.quality.status as TelemetryQualityStatus,
      ...(qualityDetail !== undefined ? { detail: qualityDetail } : {}),
    },
    ...(orientationDeg !== undefined ? { orientationDeg } : {}),
    ...(qualityMetric !== undefined ? { qualityMetric } : {}),
    ...(costLamports !== undefined ? { costLamports } : {}),
  });
}

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
