/**
 * VORQYN telemetry bridge — kernel observations -> canonical TelemetrySample.
 *
 * Issue #9 focused slice (Lane 2). Converts REAL observation snapshots from
 * the deterministic world-aligned kernel (services/simulation/core) into
 * telemetry validated by the authoritative shared contracts
 * (packages/contracts/src/telemetry.ts, VQ-01). The contract definitions are
 * NOT changed or re-declared here: every emitted sample passes through
 * `makeTelemetrySample`, so invalid source kinds, frames, units, timestamps
 * or positions are rejected by the contracts themselves.
 *
 * Authority boundary (issue #9): a synthetic observation is not proof of
 * funding, task acceptance, verification or any chain confirmation. This
 * bridge emits TELEMETRY ONLY — no MissionEvent, verdict, payout, session
 * token or chain timestamp is produced here. Mission lifecycle records stay
 * with the future mission orchestrator, which owns the reducer authority.
 *
 * Clock domains (kept separate, never conflated):
 * - sourceTimestampMs: the kernel's integer simulatorTimeMs (source clock).
 * - receivedAtMs: the service receipt clock, supplied by the caller per
 *   batch. The deterministic guest journal passes values derived from the
 *   contracts-owned FIXTURE_EPOCH_BASE_MS (a documented fixture epoch, NOT
 *   simulator time and NOT a claim of real UTC); the future orchestrator
 *   passes real receipt epochs captured at ingestion.
 * - chainTimeMs: never produced here (no chain authority exists in scope).
 *
 * Honesty rules (docs/ARCHITECTURE.md §5, QUALITY_GATES G3/G4):
 * - sourceKind is always the kernel's own SYNTHETIC_SIM provenance; callers
 *   cannot override it. frameId and units likewise come from the snapshot's
 *   provenance and are validated by the contracts.
 * - paused snapshots carry no fresh measurement, so they produce NO
 *   telemetry sample (nothing fabricated); the journal still stores them.
 * - disconnected robots produce an explicit `link_disconnected` marker
 *   sample whose pose is the kernel's frozen last-authoritative pose.
 * - an active optical-visibility fault marks the sample `degraded`; sonar
 *   measurements remain untouched in the underlying snapshot.
 */

import {
  FIXTURE_EPOCH_BASE_MS,
  SOURCE_KINDS,
  asEpochMs,
  makeTelemetrySample,
  TELEMETRY_FRAME_PATTERN,
  TELEMETRY_UNITS,
  type Result,
  type TelemetrySample,
} from "../../../packages/contracts/src/index";
import type { DemoSnapshot } from "../../simulation/demo/kernel-adapter.d.mts";

/** Journal schema tag for guest observation records (not a MissionEvent). */
export const GUEST_JOURNAL_SCHEMA = "vorqyn.guest-observation-journal/1" as const;

/** Source units the kernel emits; mapped to the contracts' canonical units. */
const KERNEL_POSITION_UNITS = "m" as const;

export type TelemetryEmissionKind =
  | "fresh-sample"
  | "link-down-marker"
  | "skipped-paused"
  | "skipped-no-fresh-measurement";

export interface NormalizedTelemetry {
  /** Contract-validated sample (fresh readings and link-down markers). */
  readonly sample: TelemetrySample;
  readonly emission: Exclude<TelemetryEmissionKind, "skipped-paused" | "skipped-no-fresh-measurement">;
}

export interface NormalizationOutcome {
  /** Contract-valid telemetry, in kernel robot order. */
  readonly samples: readonly NormalizedTelemetry[];
  /** Robots for which no telemetry exists in this snapshot, and why. */
  readonly skipped: readonly { readonly robotId: string; readonly emission: TelemetryEmissionKind; readonly reason: string }[];
}

export interface NormalizeOptions {
  /** Guest journal mission id — must satisfy the contracts ID lexical rule. */
  readonly missionId: string;
  /**
   * Service receipt epoch for this snapshot. Deterministic callers pass a
   * fixture-clock value; a real orchestrator passes the actual receipt time.
   * Must be a non-negative safe integer (contracts EpochMs domain).
   */
  readonly receivedAtMs: number;
}

/** Default deterministic receipt value: fixture epoch base + snapshot time is
 * deliberately NOT used (that would conflate clock domains). Callers get an
 * explicit error if they omit receivedAtMs — the deterministic journal
 * derives it from the append ordinal instead. */
export const FIXTURE_RECEIPT_EPOCH_BASE_MS = FIXTURE_EPOCH_BASE_MS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert one kernel observation snapshot into contract-valid telemetry.
 *
 * The snapshot's own provenance (sourceKind, frameId, seed, units) is
 * authoritative: a tampered snapshot (e.g. forged frameId or unknown units)
 * fails contract validation here instead of producing fake telemetry.
 */
export function normalizeSnapshotToTelemetry(
  snapshot: DemoSnapshot,
  options: NormalizeOptions,
): Result<NormalizationOutcome> {
  if (!isRecord(snapshot)) {
    return { ok: false, error: { code: "validation_error", message: "snapshot must be an object" } };
  }
  const provenance = snapshot.provenance as Record<string, unknown> | undefined;
  if (!isRecord(provenance)) {
    return { ok: false, error: { code: "validation_error", message: "snapshot is missing kernel provenance" } };
  }
  const sourceKind = provenance.sourceKind;
  if (sourceKind !== "SYNTHETIC_SIM") {
    return {
      ok: false,
      error: {
        code: "validation_error",
        message: `snapshot provenance sourceKind must be SYNTHETIC_SIM, got ${String(sourceKind)}`,
      },
    };
  }
  const frameId = provenance.frameId;
  if (typeof frameId !== "string" || !TELEMETRY_FRAME_PATTERN.test(frameId)) {
    return {
      ok: false,
      error: {
        code: "validation_error",
        message: `snapshot frameId ${JSON.stringify(frameId ?? null)} does not satisfy the world frame contract`,
      },
    };
  }
  const positionUnits = provenance.positionUnits;
  if (positionUnits !== KERNEL_POSITION_UNITS) {
    return {
      ok: false,
      error: {
        code: "validation_error",
        message: `snapshot positionUnits ${JSON.stringify(positionUnits ?? null)} is not the kernel unit "${KERNEL_POSITION_UNITS}"`,
      },
    };
  }
  if (typeof snapshot.simulatorTimeMs !== "number" || !Number.isSafeInteger(snapshot.simulatorTimeMs) || snapshot.simulatorTimeMs < 0) {
    return { ok: false, error: { code: "validation_error", message: "snapshot simulatorTimeMs must be a non-negative safe integer" } };
  }
  const receipt = asEpochMs(options.receivedAtMs);
  if (!receipt.ok) {
    return { ok: false, error: receipt.error };
  }

  const robots = snapshot.robots;
  if (!Array.isArray(robots)) {
    return { ok: false, error: { code: "validation_error", message: "snapshot robots must be an array" } };
  }

  const samples: NormalizedTelemetry[] = [];
  const skipped: NormalizationOutcome["skipped"][number][] = [];

  for (const robot of robots) {
    const robotId = robot.robotId;
    if (snapshot.kernelState === "paused") {
      skipped.push({
        robotId,
        emission: "skipped-paused",
        reason: "kernel paused: no fresh measurement exists at this snapshot",
      });
      continue;
    }
    const linkDisconnected = robot.linkState === "disconnected";

    if (!robot.fresh || linkDisconnected) {
      // Explicit link-down marker on the frozen last-authoritative pose.
      const candidate = {
        missionId: options.missionId,
        robotId,
        sourceKind: "SYNTHETIC_SIM" as const,
        sourceTimestampMs: snapshot.simulatorTimeMs,
        receivedAtMs: receipt.value,
        frameId,
        sequence: snapshot.sequence,
        position: { x: robot.pose.x, y: robot.pose.y, z: robot.pose.z },
        units: TELEMETRY_UNITS,
        quality: { status: "link_disconnected" as const, detail: "kernel-link-disconnected" },
      };
      const validated = makeTelemetrySample(candidate);
      if (!validated.ok) return validated;
      samples.push({ sample: validated.value, emission: "link-down-marker" });
      continue;
    }

    // Fresh robot: collect its measured sensors.
    const measured = robot.sensors.filter((sensor) => sensor.measured !== null);
    if (measured.length === 0) {
      skipped.push({
        robotId,
        emission: "skipped-no-fresh-measurement",
        reason: "connected robot without a fresh sensor measurement in this snapshot",
      });
      continue;
    }
    const opticalFaulted = measured.some(
      (sensor) => sensor.kind === "optical" && sensor.measured?.opticalVisibilityFactorApplied !== null,
    );
    const primary = measured.find((sensor) => sensor.kind === "optical") ?? measured[0];
    if (primary === undefined || primary.measured === null) {
      return { ok: false, error: { code: "validation_error", message: `robot ${robotId} has no measurable primary sensor` } };
    }
    const qualityMetric = {
      kind: primary.sensorId,
      value: primary.measured.quality01,
    };
    const candidate = {
      missionId: options.missionId,
      robotId,
      sourceKind: "SYNTHETIC_SIM" as const,
      sourceTimestampMs: snapshot.simulatorTimeMs,
      receivedAtMs: receipt.value,
      frameId,
      sequence: snapshot.sequence,
      position: { x: robot.pose.x, y: robot.pose.y, z: robot.pose.z },
      units: TELEMETRY_UNITS,
      quality: opticalFaulted
        ? { status: "degraded" as const, detail: "optical-visibility-fault-active" }
        : { status: "ok" as const },
      qualityMetric,
    };
    const validated = makeTelemetrySample(candidate);
    if (!validated.ok) return validated;
    samples.push({ sample: validated.value, emission: "fresh-sample" });
  }

  return { ok: true, value: { samples, skipped } };
}

/** Re-export for callers that need to validate source kinds directly. */
export const KNOWN_SOURCE_KINDS = SOURCE_KINDS;
