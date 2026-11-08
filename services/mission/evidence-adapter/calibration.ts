/**
 * VORQYN evidence adapter — optical visibility calibration boundary.
 *
 * The kernel emits optical measurements as UNITLESS fixture quality
 * (`qualityUnits: "unitless_0_to_1_fixture_model"`, see
 * services/simulation/core/kernel.mjs `buildSensorView`). Nothing in the
 * repository provides — or claims to provide — a metres-based visibility
 * measurement, and NO default calibration ships in this adapter:
 * converting quality01 to `visibility_m` without a documented,
 * source-backed calibration would fabricate physical evidence
 * (issue #9: NEVER assume `quality01` is metres).
 *
 * This module therefore implements the narrow mechanical contract only:
 * - a calibration must arrive EXPLICITLY, fully documented (id, version,
 *   sourceRef, derivation), carrying a deterministic monotone
 *   piecewise-linear map over the unitless quality01 domain;
 * - the adapter validates STRUCTURE and DETERMINISM only — it cannot and
 *   does not judge whether a calibration is physically true. That judgment
 *   belongs to the human reviewers (CTO review) and the independent
 *   verifier authority, which is why every accepted calibration is recorded
 *   verbatim in the evidence capture it produced;
 * - interpolation outside the documented quality01 domain fails closed
 *   (no clamping, no extrapolation).
 *
 * Until a real, documented calibration is supplied by the team, optical
 * `visibility_m` evidence is UNAVAILABLE and the adapter returns the
 * structured `optical_visibility_unsupported` result — the honest state,
 * not a workaround.
 */

import { adapterErr, adapterOk, type EvidenceAdapterResult } from "./errors";

/** Schema tag recorded on every calibration and in capture audit records. */
export const VISIBILITY_CALIBRATION_SCHEMA = "vorqyn.visibility-calibration/1" as const;

/** The only calibration input domain v1 accepts: the kernel's unitless quality01. */
export const CALIBRATION_INPUT_KIND_UNITLESS_QUALITY01 = "unitless_quality01" as const;

/** One anchor of the piecewise-linear quality01 → visibility-metres map. */
export interface VisibilityCalibrationPoint {
  readonly quality01: number;
  readonly visibilityM: number;
}

/**
 * An explicitly documented, source-backed calibration from unitless kernel
 * optical quality to visibility in metres. The full descriptor is recorded
 * in evidence captures so reviewers can audit exactly which numbers
 * produced every `visibility_m` value.
 */
export interface VisibilityCalibration {
  readonly schema: typeof VISIBILITY_CALIBRATION_SCHEMA;
  /** Stable calibration identifier (referenced by captures and review notes). */
  readonly calibrationId: string;
  /** Positive integer version — a changed calibration is a NEW version. */
  readonly version: number;
  /** Non-empty reference to the documented source of this calibration. */
  readonly sourceRef: string;
  /** Non-empty human-readable derivation that reviewers audit. */
  readonly derivation: string;
  readonly inputKind: typeof CALIBRATION_INPUT_KIND_UNITLESS_QUALITY01;
  /** ≥ 2 anchors, quality01 strictly increasing in [0,1], metres non-decreasing. */
  readonly points: readonly VisibilityCalibrationPoint[];
}

const MAX_CALIBRATION_ID_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Validate the STRUCTURAL integrity of a calibration descriptor. This is
 * deliberately not a physics review: the adapter cannot tell whether a
 * claimed metres mapping is real. It can require that the calibration is
 * fully documented, deterministic, domain-bounded and monotone — and it
 * refuses everything else (including undocumented "1 unit = 1 metre"
 * passthrough attempts) so no unitless fixture value can silently become
 * "metres".
 */
export function validateVisibilityCalibration(input: unknown): EvidenceAdapterResult<VisibilityCalibration> {
  if (!isRecord(input)) return adapterErr("validation_error", "calibration must be an object");
  if (input.schema !== VISIBILITY_CALIBRATION_SCHEMA) {
    return adapterErr("validation_error", `calibration schema must be ${VISIBILITY_CALIBRATION_SCHEMA}, got ${String(input.schema)}`);
  }
  const { calibrationId, version, sourceRef, derivation, inputKind } = input;
  if (typeof calibrationId !== "string" || calibrationId.trim().length === 0 || calibrationId.length > MAX_CALIBRATION_ID_LENGTH) {
    return adapterErr("validation_error", `calibration calibrationId must be a non-empty string of at most ${MAX_CALIBRATION_ID_LENGTH} characters`);
  }
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    return adapterErr("validation_error", "calibration version must be a positive safe integer");
  }
  if (typeof sourceRef !== "string" || sourceRef.trim().length === 0) {
    return adapterErr("validation_error", "calibration sourceRef must be a non-empty documented source reference");
  }
  if (typeof derivation !== "string" || derivation.trim().length === 0) {
    return adapterErr("validation_error", "calibration derivation must be a non-empty documented derivation");
  }
  if (inputKind !== CALIBRATION_INPUT_KIND_UNITLESS_QUALITY01) {
    return adapterErr(
      "validation_error",
      `calibration inputKind must be "${CALIBRATION_INPUT_KIND_UNITLESS_QUALITY01}", got ${String(inputKind)} — the kernel provides no other optical quantity`,
    );
  }
  if (!Array.isArray(input.points) || input.points.length < 2) {
    return adapterErr("validation_error", "calibration points must be an array of at least 2 anchors");
  }
  const points: VisibilityCalibrationPoint[] = [];
  for (const raw of input.points) {
    if (!isRecord(raw) || !isFiniteNumber(raw.quality01) || !isFiniteNumber(raw.visibilityM)) {
      return adapterErr("validation_error", "calibration points must be { quality01, visibilityM } finite numbers");
    }
    if (raw.quality01 < 0 || raw.quality01 > 1) {
      return adapterErr("validation_error", "calibration quality01 anchors must lie in [0,1] (the kernel's documented domain)");
    }
    if (raw.visibilityM < 0) {
      return adapterErr("validation_error", "calibration visibilityM anchors must be non-negative metres");
    }
    points.push({ quality01: raw.quality01, visibilityM: raw.visibilityM });
  }
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous === undefined || current === undefined) continue; // unreachable; satisfies noUncheckedIndexedAccess
    if (current.quality01 <= previous.quality01) {
      return adapterErr("validation_error", "calibration quality01 anchors must be strictly increasing");
    }
    if (current.visibilityM < previous.visibilityM) {
      return adapterErr("validation_error", "calibration visibilityM anchors must be non-decreasing (a monotone map is required)");
    }
  }
  return adapterOk({
    schema: VISIBILITY_CALIBRATION_SCHEMA,
    calibrationId,
    version,
    sourceRef,
    derivation,
    inputKind,
    points,
  });
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * Deterministic piecewise-linear interpolation of visibility metres at a
 * unitless quality01 value. Outside the documented anchor domain this
 * FAILS CLOSED (calibration_domain_exceeded) — no clamping, no
 * extrapolation, no invented numbers.
 */
export function interpolateVisibilityM(calibration: VisibilityCalibration, quality01: number): EvidenceAdapterResult<number> {
  if (!isFiniteNumber(quality01) || quality01 < 0 || quality01 > 1) {
    return adapterErr(
      "calibration_domain_exceeded",
      `quality01 ${String(quality01)} is outside the calibration's documented [0,1] domain — refusing to extrapolate`,
    );
  }
  const { points } = calibration;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) {
    return adapterErr("validation_error", "calibration has no anchors");
  }
  if (quality01 <= first.quality01) return adapterOk(round6(first.visibilityM));
  if (quality01 >= last.quality01) return adapterOk(round6(last.visibilityM));
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (previous === undefined || current === undefined) continue; // unreachable; satisfies noUncheckedIndexedAccess
    if (quality01 <= current.quality01) {
      const span = current.quality01 - previous.quality01;
      const interpolated =
        previous.visibilityM + ((quality01 - previous.quality01) / span) * (current.visibilityM - previous.visibilityM);
      return adapterOk(round6(interpolated));
    }
  }
  return adapterErr("calibration_domain_exceeded", `quality01 ${String(quality01)} did not fall into any documented anchor segment`);
}
