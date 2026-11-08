/**
 * @vorqyn/mission evidence adapter — source-backed simulator-to-verifier
 * evidence compatibility (issue #9 integration slice, owned by Agent C).
 *
 * Public surface:
 * - `makeEvidenceClockMapping` / `mapSourceTimeToCaptureDomain` — the
 *   explicit, versioned, stream-bound source↔capture clock contract
 *   (never silently converts simulator-relative ms to Unix epoch).
 * - `validateVisibilityCalibration` / `interpolateVisibilityM` — the ONLY
 *   path from unitless kernel optical quality to `visibility_m`; requires
 *   a fully documented, source-backed calibration and ships NONE by default.
 * - `buildEvidenceCapture` — modality-scoped, contract-valid evidence
 *   captures from accepted guest-journal records, with preserved
 *   provenance, per-observation audit and explicit exclusions.
 * - `prepareSubmission` / `evaluateCapture` — inputs for the EXISTING
 *   verifier (services/verifier, unchanged) plus a decision-clock domain
 *   guard. Verdicts are the verifier's own, untouched.
 *
 * AUTHORITY BOUNDARY: this adapter prepares evidence only. It never
 * creates `task.evidenceAccepted`, payment confirmations, chain receipts,
 * attestations or any mission lifecycle event, and it never manufactures
 * measurements (no sonar from optical, no metres from unitless quality).
 */

export {
  CALIBRATION_INPUT_KIND_UNITLESS_QUALITY01,
  VISIBILITY_CALIBRATION_SCHEMA,
  interpolateVisibilityM,
  validateVisibilityCalibration,
  type VisibilityCalibration,
  type VisibilityCalibrationPoint,
} from "./calibration";
export {
  EVIDENCE_CAPTURE_SCHEMA,
  SONAR_PING_METRIC_KIND,
  VISIBILITY_M_METRIC_KIND,
  buildEvidenceCapture,
  type BuildEvidenceCaptureInput,
  type EvidenceCapture,
  type EvidenceCaptureCalibrationAudit,
  type EvidenceCaptureExclusion,
  type EvidenceCaptureObservation,
  type EvidenceCaptureProvenance,
  type EvidenceCaptureWindow,
  type EvidenceModality,
} from "./capture";
export {
  adapterErr,
  adapterOk,
  type EvidenceAdapterError,
  type EvidenceAdapterErrorCode,
  type EvidenceAdapterResult,
} from "./errors";
export {
  CLOCK_MAPPING_ALGORITHM,
  EVIDENCE_CLOCK_MAPPING_SCHEMA,
  makeEvidenceClockMapping,
  mapSourceTimeToCaptureDomain,
  validateEvidenceClockMapping,
  type EvidenceClockMapping,
  type EvidenceClockMappingSourceBinding,
} from "./clock-mapping";
export {
  evaluateCapture,
  prepareSubmission,
  type EvidenceIdentity,
  type EvidenceSubmissionInput,
  type VerificationRequestContext,
} from "./submission";
