/**
 * VORQYN evidence adapter — modality-scoped evidence captures (issue #9).
 *
 * Bridges the REAL deterministic kernel observations already accepted by
 * the guest observation journal (services/mission/simulation/
 * observation-journal.ts) into contract-valid evidence inputs whose
 * vocabulary matches the verifier's obstruction-survey policy
 * (services/verifier/src/policy.ts):
 *
 * - SONAR: the kernel's independent sonar measurements (e.g. rov-01-sonar)
 *   are preserved verbatim as `qualityMetric { kind: "sonar_ping" }` on
 *   samples built ONLY from actual sonar sensor observations. Sonar
 *   evidence is never manufactured from optical quality — robots without a
 *   sonar sensor are recorded as explicit exclusions, not silent gaps.
 * - OPTICAL: the kernel provides unitless quality01 only
 *   ("unitless_0_to_1_fixture_model"). A capture carrying `visibility_m`
 *   therefore REQUIRES an explicit, documented, source-backed calibration
 *   (calibration.ts). Without one the adapter returns the structured
 *   `optical_visibility_unsupported` result — it never assumes quality01
 *   is metres.
 *
 * Clock semantics: sample `sourceTimestampMs` values are the kernel's
 * relative source times mapped onto the capture's explicitly anchored,
 * stream-bound domain (clock-mapping.ts); the raw relative time is
 * preserved per observation in this capture's audit records.
 *
 * AUTHORITY BOUNDARY (issue #9): a capture is PREPARED EVIDENCE ONLY. It
 * contains no mission lifecycle state, no `task.evidenceAccepted`, no
 * payment confirmation, no chain receipt and no verdict — acceptance is
 * decided exclusively by the existing verifier
 * (services/verifier/src/verifier.ts) invoked through submission.ts.
 */

import {
  TELEMETRY_UNITS,
  makeTelemetrySample,
  type TelemetrySample,
} from "../../../packages/contracts/src/index";
import type { DemoSnapshot } from "../../simulation/demo/kernel-adapter.d.mts";
import { FRAME_ID, POSITION_UNITS, SCENARIO_ID, SOURCE_KIND_SYNTHETIC_SIM } from "../../simulation/demo/kernel-adapter.mjs";
import type { ObservationJournal, ObservationJournalRecord } from "../simulation/observation-journal";
import { GUEST_JOURNAL_SCHEMA } from "../simulation/telemetry-bridge";
import type { EvidenceAdapterError, EvidenceAdapterResult } from "./errors";
import {
  interpolateVisibilityM,
  validateVisibilityCalibration,
  type VisibilityCalibration,
} from "./calibration";
import {
  mapSourceTimeToCaptureDomain,
  validateEvidenceClockMapping,
  type EvidenceClockMapping,
} from "./clock-mapping";

/** Schema tag for this capture document. */
export const EVIDENCE_CAPTURE_SCHEMA = "vorqyn.evidence-capture/1" as const;

/** Verifier policy metric kinds this adapter can legitimately produce. */
export const SONAR_PING_METRIC_KIND = "sonar_ping" as const;
export const VISIBILITY_M_METRIC_KIND = "visibility_m" as const;

/** Sensor modalities with a defined mapping (scenario.mjs SENSOR_KINDS). */
export type EvidenceModality = "optical" | "sonar";

/** One real kernel sensor observation, its preserved measurement and the metric derived for the capture modality. */
export interface EvidenceCaptureObservation {
  readonly sequence: number;
  readonly robotId: string;
  readonly sensorId: string;
  readonly modality: EvidenceModality;
  /** Raw kernel source clock (relative mission ms) — preserved, never discarded. */
  readonly sourceSimulatorTimeMs: number;
  /** The kernel's measured unitless quality, verbatim (never converted here). */
  readonly quality01: number;
  /** The kernel's own units label for that quality (always the unitless fixture model). */
  readonly qualityUnits: string;
  /** Optical fault factor the kernel applied to THIS sensor's measurement (null = none). */
  readonly opticalVisibilityFactorApplied: number | null;
  /** Severity of an optical fault active on the ROBOT in this snapshot (audit context). */
  readonly activeOpticalFaultSeverity: string | null;
  readonly coverage01: number;
  /** The metric carried on the evidence sample for this observation. */
  readonly metric: { readonly kind: string; readonly value: number };
}

/** Why a kernel robot snapshot produced no evidence observation. */
export interface EvidenceCaptureExclusion {
  readonly sequence: number;
  /** null for snapshot-level exclusions (paused kernel affects every robot). */
  readonly robotId: string | null;
  readonly code: string;
  readonly reason: string;
}

/** Bounded window the capture was built from, on both source clocks. */
export interface EvidenceCaptureWindow {
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly firstSourceSimulatorTimeMs: number;
  readonly lastSourceSimulatorTimeMs: number;
  /** Capture time on the anchored capture-clock domain (see clock-mapping.ts). */
  readonly capturedAtMs: number;
}

/** The calibration that produced this capture's visibility_m values, recorded verbatim for review. */
export interface EvidenceCaptureCalibrationAudit {
  readonly schema: string;
  readonly calibrationId: string;
  readonly version: number;
  readonly sourceRef: string;
  readonly derivation: string;
  readonly inputKind: string;
  readonly points: readonly { readonly quality01: number; readonly visibilityM: number }[];
}

export interface EvidenceCaptureProvenance {
  readonly sourceKind: typeof SOURCE_KIND_SYNTHETIC_SIM;
  readonly frameId: string;
  readonly positionUnits: string;
  readonly simulatorClock: string;
}

/**
 * A prepared evidence capture: contract-valid samples on the mapped capture
 * clock, the preserved kernel observations they came from, explicit
 * exclusions, and the full clock/calibration provenance needed to audit —
 * or reverse — every conversion performed.
 */
export interface EvidenceCapture {
  readonly captureSchema: typeof EVIDENCE_CAPTURE_SCHEMA;
  readonly modality: EvidenceModality;
  readonly missionId: string;
  readonly seed: number;
  readonly scenarioId: typeof SCENARIO_ID;
  readonly provenance: EvidenceCaptureProvenance;
  readonly clockMapping: EvidenceClockMapping;
  readonly calibration: EvidenceCaptureCalibrationAudit | null;
  readonly window: EvidenceCaptureWindow;
  /** Contract-valid evidence samples (makeTelemetrySample validated). */
  readonly samples: readonly TelemetrySample[];
  /** Per-observation audit: the real kernel values each sample was built from. */
  readonly observations: readonly EvidenceCaptureObservation[];
  /** Robots/snapshots that produced no observation, and why. */
  readonly excluded: readonly EvidenceCaptureExclusion[];
}

export interface BuildEvidenceCaptureInput {
  /** The journal whose ACCEPTED records are the only observation source. */
  readonly journal: ObservationJournal;
  /** Which sensor modality this capture documents (one submission = one sensor). */
  readonly modality: EvidenceModality;
  /** Explicit stream-bound clock mapping (clock-mapping.ts). */
  readonly clockMapping: EvidenceClockMapping;
  /**
   * REQUIRED for modality "optical" (visibility_m needs a documented
   * calibration). Must be ABSENT for modality "sonar" (no calibration
   * participates in sonar evidence).
   */
  readonly calibration?: VisibilityCalibration;
  /**
   * Optional bounded subset of the journal's accepted records (defaults to
   * all records). Every record is structurally re-validated here — a
   * capture can only be built from accepted, stream-consistent,
   * strictly-ordered snapshots.
   */
  readonly records?: readonly ObservationJournalRecord[];
  /**
   * Optional robot scope for this capture (the robots the survey covers).
   * Robots outside the scope are recorded as explicit exclusions — they are
   * never silently dropped and never contribute samples. Defaults to every
   * robot carrying the requested modality.
   */
  readonly robotIds?: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validate the record stream (subset) the capture will be built from. */
function validateCaptureRecords(
  journal: ObservationJournal,
  records: readonly ObservationJournalRecord[],
): EvidenceAdapterResult<readonly { record: ObservationJournalRecord; snapshot: DemoSnapshot }[]> {
  if (records.length === 0) {
    return { ok: false, error: { code: "no_records", message: "capture needs at least one accepted journal record" } };
  }
  const validated: { record: ObservationJournalRecord; snapshot: DemoSnapshot }[] = [];
  let lastSequence: number | null = null;
  let lastSimulatorTimeMs: number | null = null;
  for (const record of records) {
    if (!isRecord(record) || record.journalSchema !== GUEST_JOURNAL_SCHEMA) {
      return { ok: false, error: { code: "validation_error", message: "capture records must be guest observation journal records" } };
    }
    const snapshot = record.snapshot;
    if (!isRecord(snapshot) || !isRecord(snapshot.provenance)) {
      return { ok: false, error: { code: "validation_error", message: "capture record is missing the frozen kernel snapshot or its provenance" } };
    }
    const provenance = snapshot.provenance;
    if (provenance.sourceKind !== SOURCE_KIND_SYNTHETIC_SIM) {
      return {
        ok: false,
        error: {
          code: "provenance_mismatch",
          message: `snapshot provenance sourceKind must be ${SOURCE_KIND_SYNTHETIC_SIM}, got ${String(provenance.sourceKind)} — synthetic evidence never claims another origin`,
        },
      };
    }
    if (provenance.frameId !== FRAME_ID) {
      return {
        ok: false,
        error: {
          code: "provenance_mismatch",
          message: `snapshot frameId ${String(provenance.frameId)} is not the kernel world frame ${FRAME_ID} (tampered provenance is never captured)`,
        },
      };
    }
    if (provenance.positionUnits !== POSITION_UNITS) {
      return {
        ok: false,
        error: {
          code: "provenance_mismatch",
          message: `snapshot positionUnits ${String(provenance.positionUnits)} is not the kernel unit "${POSITION_UNITS}"`,
        },
      };
    }
    if (provenance.scenarioId !== SCENARIO_ID || provenance.seed !== journal.seed) {
      return {
        ok: false,
        error: {
          code: "cross_stream_contamination",
          message: `snapshot (scenario ${String(provenance.scenarioId)}, seed ${String(provenance.seed)}) does not belong to the journal's stream (scenario ${SCENARIO_ID}, seed ${journal.seed})`,
        },
      };
    }
    if (typeof snapshot.sequence !== "number" || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) {
      return { ok: false, error: { code: "validation_error", message: "snapshot sequence must be a non-negative safe integer" } };
    }
    if (typeof snapshot.simulatorTimeMs !== "number" || !Number.isSafeInteger(snapshot.simulatorTimeMs) || snapshot.simulatorTimeMs < 0) {
      return { ok: false, error: { code: "validation_error", message: "snapshot simulatorTimeMs must be a non-negative safe integer" } };
    }
    if (lastSequence !== null && snapshot.sequence <= lastSequence) {
      return {
        ok: false,
        error: {
          code: "duplicate_or_regressed_sequence",
          message: `snapshot sequence ${snapshot.sequence} is not newer than the previous ${lastSequence} — duplicate evidence is never captured`,
        },
      };
    }
    // The kernel HOLDS the source clock while paused (frozen heartbeats), so
    // paused snapshots may repeat the previous simulatorTimeMs. The sequence
    // must always strictly increase; the source clock must never go backwards.
    if (lastSimulatorTimeMs !== null && snapshot.simulatorTimeMs < lastSimulatorTimeMs) {
      return {
        ok: false,
        error: {
          code: "non_monotonic_source_time",
          message: `snapshot simulatorTimeMs ${snapshot.simulatorTimeMs} is older than the previous ${lastSimulatorTimeMs}`,
        },
      };
    }
    if (snapshot.kernelState !== "running" && snapshot.kernelState !== "paused") {
      return {
        ok: false,
        error: { code: "unsupported_kernel_state", message: `snapshot kernelState ${String(snapshot.kernelState)} cannot produce evidence` },
      };
    }
    lastSequence = snapshot.sequence;
    lastSimulatorTimeMs = snapshot.simulatorTimeMs;
    validated.push({ record, snapshot: snapshot as DemoSnapshot });
  }
  return { ok: true, value: validated };
}

/** Resolve the kernel sensors matching the capture modality for one robot. */
function sensorsForModality(
  snapshot: DemoSnapshot,
  robotId: string,
  modality: EvidenceModality,
): { ok: true; sensors: DemoSnapshot["robots"][number]["sensors"] } | { ok: false; error: EvidenceAdapterError } {
  const robot = snapshot.robots.find((candidate) => candidate.robotId === robotId);
  if (robot === undefined) {
    return { ok: false, error: { code: "validation_error", message: `robot ${robotId} is missing from snapshot ${snapshot.sequence}` } };
  }
  const sensors = robot.sensors.filter((sensor) => sensor.kind === modality);
  if (sensors.length > 1) {
    return {
      ok: false,
      error: {
        code: "ambiguous_sensor_modality",
        message: `robot ${robotId} has ${sensors.length} ${modality} sensors in snapshot ${snapshot.sequence} — refusing to pick one arbitrarily`,
      },
    };
  }
  return { ok: true, sensors };
}

/**
 * Build a modality-scoped evidence capture from accepted journal records.
 * See the module header for the metric and clock rules; see README.md for
 * the integration contract.
 */
export function buildEvidenceCapture(input: BuildEvidenceCaptureInput): EvidenceAdapterResult<EvidenceCapture> {
  const { journal, modality } = input;
  if (!isRecord(journal) || journal.journalSchema !== GUEST_JOURNAL_SCHEMA) {
    return { ok: false, error: { code: "validation_error", message: "capture input must be a guest observation journal" } };
  }
  if (modality !== "optical" && modality !== "sonar") {
    return { ok: false, error: { code: "validation_error", message: `capture modality must be "optical" or "sonar", got ${String(modality)}` } };
  }
  const mapping = validateEvidenceClockMapping(input.clockMapping);
  if (!mapping.ok) return mapping;
  if (mapping.value.sourceBinding.seed !== journal.seed) {
    return {
      ok: false,
      error: {
        code: "mapping_stream_mismatch",
        message: `clock mapping is bound to seed ${mapping.value.sourceBinding.seed}, but the journal's stream seed is ${journal.seed} — refusing to map another stream's clock`,
      },
    };
  }
  if (mapping.value.sourceBinding.scenarioId !== SCENARIO_ID) {
    return {
      ok: false,
      error: {
        code: "mapping_stream_mismatch",
        message: `clock mapping is bound to scenario ${mapping.value.sourceBinding.scenarioId}, but the journal's scenario is ${SCENARIO_ID}`,
      },
    };
  }

  // Calibration rules: required for optical (visibility_m), forbidden for sonar.
  let calibration: VisibilityCalibration | null = null;
  if (modality === "optical") {
    if (input.calibration === undefined) {
      return {
        ok: false,
        error: {
          code: "optical_visibility_unsupported",
          message:
            "the kernel provides unitless optical quality01 only (qualityUnits unitless_0_to_1_fixture_model) and no source-backed calibration for visibility_m exists in this repository — " +
            "optical evidence in metres is UNAVAILABLE. Supply an explicitly documented, source-backed VisibilityCalibration, or submit sonar evidence instead. " +
            "NEVER treat quality01 as metres.",
        },
      };
    }
    const validatedCalibration = validateVisibilityCalibration(input.calibration);
    if (!validatedCalibration.ok) return validatedCalibration;
    calibration = validatedCalibration.value;
  } else if (input.calibration !== undefined) {
    return {
      ok: false,
      error: { code: "calibration_not_applicable", message: "sonar evidence takes no calibration — sonar measurements are preserved verbatim" },
    };
  }
  if (input.robotIds !== undefined) {
    if (!Array.isArray(input.robotIds) || input.robotIds.length === 0 || input.robotIds.some((robotId) => typeof robotId !== "string" || robotId.trim().length === 0)) {
      return { ok: false, error: { code: "validation_error", message: "robotIds scope must be a non-empty array of non-empty strings" } };
    }
  }

  const records = validateCaptureRecords(journal, input.records ?? journal.records);
  if (!records.ok) return records;

  // First pass: derive per-observation metrics and collect exclusions.
  const observations: EvidenceCaptureObservation[] = [];
  const excluded: EvidenceCaptureExclusion[] = [];
  const robotScope = input.robotIds === undefined ? null : [...input.robotIds];
  for (const { snapshot } of records.value) {
    if (snapshot.kernelState === "paused") {
      excluded.push({
        sequence: snapshot.sequence,
        robotId: null,
        code: "kernel_paused",
        reason: "kernel paused: no fresh measurement exists in this snapshot",
      });
      continue;
    }
    for (const robot of snapshot.robots) {
      if (robotScope !== null && !robotScope.includes(robot.robotId)) {
        excluded.push({
          sequence: snapshot.sequence,
          robotId: robot.robotId,
          code: "robot_not_in_capture_scope",
          reason: `robot ${robot.robotId} is outside the capture's declared robot scope (${robotScope.join(", ")})`,
        });
        continue;
      }
      if (robot.linkState === "disconnected") {
        excluded.push({
          sequence: snapshot.sequence,
          robotId: robot.robotId,
          code: "link_disconnected",
          reason: "telemetry link down: no fresh measurement exists (frozen pose is not evidence)",
        });
        continue;
      }
      if (!robot.fresh) {
        excluded.push({
          sequence: snapshot.sequence,
          robotId: robot.robotId,
          code: "no_fresh_measurement",
          reason: `robot staleness ${robot.staleness}: the kernel labels this snapshot as carrying no fresh reading`,
        });
        continue;
      }
      const sensors = sensorsForModality(snapshot, robot.robotId, modality);
      if (!sensors.ok) return sensors;
      const sensor = sensors.sensors[0];
      if (sensor === undefined) {
        excluded.push({
          sequence: snapshot.sequence,
          robotId: robot.robotId,
          code: "sensor_modality_missing",
          reason: `robot ${robot.robotId} carries no ${modality} sensor — its other modalities are never converted into ${modality} evidence`,
        });
        continue;
      }
      if (sensor.measured === null) {
        excluded.push({
          sequence: snapshot.sequence,
          robotId: robot.robotId,
          code: "no_fresh_measurement",
          reason: `sensor ${sensor.sensorId} has no measurement in this snapshot`,
        });
        continue;
      }
      let metric: { kind: string; value: number };
      if (modality === "sonar") {
        // The kernel's real, independent sonar measurement, preserved
        // verbatim under the policy's backing-metric kind. The value stays
        // the kernel's unitless fixture return quality — documented as such
        // in qualityUnits below and in README.md; no distance is invented.
        metric = { kind: SONAR_PING_METRIC_KIND, value: sensor.measured.quality01 };
      } else {
        const visibility = interpolateVisibilityM(calibration as VisibilityCalibration, sensor.measured.quality01);
        if (!visibility.ok) return visibility;
        metric = { kind: VISIBILITY_M_METRIC_KIND, value: visibility.value };
      }
      observations.push({
        sequence: snapshot.sequence,
        robotId: robot.robotId,
        sensorId: sensor.sensorId,
        modality,
        sourceSimulatorTimeMs: snapshot.simulatorTimeMs,
        quality01: sensor.measured.quality01,
        qualityUnits: sensor.measured.qualityUnits,
        opticalVisibilityFactorApplied: sensor.measured.opticalVisibilityFactorApplied,
        activeOpticalFaultSeverity: robot.activeOpticalFault === null ? null : robot.activeOpticalFault.severity,
        coverage01: sensor.coverage.coverage01,
        metric,
      });
    }
  }

  if (observations.length === 0) {
    return {
      ok: false,
      error: {
        code: "no_fresh_observations",
        message: `the requested records contain no fresh ${modality} observations (exclusions: ${excluded.length}) — evidence is never synthesized from stale or disconnected states`,
      },
    };
  }

  // Second pass: mapped source times (per snapshot) and contract-valid samples.
  const mappedTimeBySequence = new Map<number, number>();
  const recordBySequence = new Map<number, ObservationJournalRecord>();
  for (const { record, snapshot } of records.value) {
    const mapped = mapSourceTimeToCaptureDomain(mapping.value, snapshot.simulatorTimeMs);
    if (!mapped.ok) return { ok: false, error: { code: "validation_error", message: mapped.error.message } };
    mappedTimeBySequence.set(snapshot.sequence, mapped.value);
    recordBySequence.set(snapshot.sequence, record);
  }
  const samples: TelemetrySample[] = [];
  for (const observation of observations) {
    const mappedSourceTimestampMs = mappedTimeBySequence.get(observation.sequence);
    const sourceRecord = recordBySequence.get(observation.sequence);
    if (mappedSourceTimestampMs === undefined || sourceRecord === undefined) {
      return { ok: false, error: { code: "validation_error", message: `no mapped capture record for sequence ${observation.sequence}` } };
    }
    const snapshot = sourceRecord.snapshot;
    const robot = snapshot.robots.find((candidate) => candidate.robotId === observation.robotId);
    if (robot === undefined) {
      return { ok: false, error: { code: "validation_error", message: `robot ${observation.robotId} missing from snapshot ${observation.sequence}` } };
    }
    const degraded =
      modality === "optical" && observation.opticalVisibilityFactorApplied !== null;
    const candidate = {
      missionId: journal.missionId,
      robotId: robot.robotId,
      sourceKind: SOURCE_KIND_SYNTHETIC_SIM,
      sourceTimestampMs: mappedSourceTimestampMs,
      receivedAtMs: sourceRecord.receivedAtMs,
      frameId: snapshot.provenance.frameId,
      sequence: snapshot.sequence,
      position: { x: robot.pose.x, y: robot.pose.y, z: robot.pose.z },
      units: TELEMETRY_UNITS,
      quality: degraded
        ? { status: "degraded" as const, detail: "optical-visibility-fault-active" }
        : { status: "ok" as const },
      qualityMetric: observation.metric,
    };
    const validated = makeTelemetrySample(candidate);
    // makeTelemetrySample returns the contracts Result vocabulary; surface its
    // exact message under the adapter validation code without widening the
    // shared contract.
    if (!validated.ok) return { ok: false, error: { code: "validation_error", message: validated.error.message } };
    samples.push(validated.value);
  }

  const firstRecord = records.value[0];
  const lastRecord = records.value[records.value.length - 1];
  if (firstRecord === undefined || lastRecord === undefined) {
    return { ok: false, error: { code: "validation_error", message: "capture records became empty" } };
  }
  const lastMapped = mappedTimeBySequence.get(lastRecord.snapshot.sequence);
  if (lastMapped === undefined) {
    return { ok: false, error: { code: "validation_error", message: "no mapped capture time for the final record" } };
  }

  const calibrationAudit: EvidenceCaptureCalibrationAudit | null =
    calibration === null
      ? null
      : {
          schema: calibration.schema,
          calibrationId: calibration.calibrationId,
          version: calibration.version,
          sourceRef: calibration.sourceRef,
          derivation: calibration.derivation,
          inputKind: calibration.inputKind,
          points: calibration.points,
        };

  return {
    ok: true,
    value: {
      captureSchema: EVIDENCE_CAPTURE_SCHEMA,
      modality,
      missionId: journal.missionId,
      seed: journal.seed,
      scenarioId: SCENARIO_ID,
      provenance: {
        sourceKind: SOURCE_KIND_SYNTHETIC_SIM,
        frameId: firstRecord.snapshot.provenance.frameId,
        positionUnits: firstRecord.snapshot.provenance.positionUnits,
        simulatorClock: firstRecord.snapshot.provenance.simulatorClock,
      },
      clockMapping: mapping.value,
      calibration: calibrationAudit,
      window: {
        firstSequence: firstRecord.snapshot.sequence,
        lastSequence: lastRecord.snapshot.sequence,
        firstSourceSimulatorTimeMs: firstRecord.snapshot.simulatorTimeMs,
        lastSourceSimulatorTimeMs: lastRecord.snapshot.simulatorTimeMs,
        capturedAtMs: lastMapped,
      },
      samples: Object.freeze(samples),
      observations: Object.freeze(observations),
      excluded: Object.freeze(excluded),
    },
  };
}
