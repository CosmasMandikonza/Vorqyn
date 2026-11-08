/**
 * VORQYN evidence adapter — submission preparation and verifier integration.
 *
 * This module PREPARES inputs for the EXISTING verifier
 * (services/verifier/src — Omar's module, imported unchanged): the identity
 * tuple, the claimed sensor, the origin and the samples on the mapped
 * capture clock. It does NOT evaluate acceptance criteria, does NOT sign
 * attestations, and does NOT create mission events, `task.evidenceAccepted`
 * states, payment confirmations or chain receipts:
 *
 * - the verdict comes ONLY from `verifyEvidence`, byte-for-byte as the
 *   verifier package implements it;
 * - signable attestations remain the verifier package's separate-key
 *   surface (attestation.ts) and are deliberately NOT reachable from here;
 * - the caller cannot choose the submission origin: `simulatorSource` is
 *   always the capture's validated kernel provenance (SYNTHETIC_SIM), so a
 *   false LIVE_SITL claim cannot be prepared through this adapter.
 *
 * Clock guard: the verifier's decision clock (`nowMs`) must be supplied on
 * the capture's anchored domain (clock-mapping.ts). A decision clock that
 * precedes the capture is refused here with
 * `decision_clock_domain_mismatch` instead of surfacing as a misleading
 * `capture_stale:age_ms=<negative>` verifier reason — a raw
 * simulator-relative or mis-anchored decision clock fails LOUDLY, not
 * silently.
 */

import { asEpochMs, asMissionId, asOperatorId, asTaskId } from "../../../packages/contracts/src/index";
import {
  makeEvidenceSubmission,
  verifyEvidence,
  type EvidencePolicy,
  type VerificationOutcome,
} from "../../../services/verifier/src/index";
import type { EvidenceCapture, EvidenceModality } from "./capture";
import { EVIDENCE_CAPTURE_SCHEMA } from "./capture";
import { adapterErr, adapterOk, type EvidenceAdapterResult } from "./errors";

/** Identity facts the CALLER (orchestrator/projection) owns and asserts. */
export interface EvidenceIdentity {
  /** Caller-chosen evidence identifier (contracts ID lexical rule). */
  readonly evidenceId: string;
  /** The task this evidence is prepared for (contracts ID lexical rule). */
  readonly taskId: string;
  /** The assignment version the caller believes is CURRENT (≥ 1). */
  readonly assignmentVersion: number;
  /** The operator the caller believes is CURRENTLY assigned. */
  readonly operatorId: string;
  /** Must equal the capture's modality — a sonar claim cannot ride an optical capture. */
  readonly sensor: EvidenceModality;
}

/** The shape `makeEvidenceSubmission` (verifier's untrusted-input gate) accepts. */
export type EvidenceSubmissionInput = Parameters<typeof makeEvidenceSubmission>[0];

/** Authority-side facts the verifier checks the submission against. */
export interface VerificationRequestContext {
  readonly expectedMissionId: string;
  readonly expectedTaskId: string;
  readonly currentAssignmentVersion: number;
  readonly expectedOperatorId: string;
  readonly activePolicyId: string;
  /**
   * Verifier decision clock — MUST be on the capture's anchored capture
   * domain (captureEpochBaseMs + mission time). See clock-mapping.ts.
   */
  readonly nowMs: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Prepare the verifier's submission input from a capture. The origin is
 * taken from the capture's validated provenance (never caller-chosen) and
 * every sample must already carry the modality's backing metric kind —
 * this adapter never adds, upgrades or re-labels metrics here.
 */
export function prepareSubmission(capture: EvidenceCapture, identity: EvidenceIdentity): EvidenceAdapterResult<EvidenceSubmissionInput> {
  if (!isRecord(capture) || capture.captureSchema !== EVIDENCE_CAPTURE_SCHEMA) {
    return adapterErr("validation_error", "prepareSubmission needs an evidence capture built by this adapter");
  }
  if (identity.sensor !== capture.modality) {
    return adapterErr(
      "sensor_modality_mismatch",
      `identity sensor "${identity.sensor}" does not match the capture's modality "${capture.modality}" — evidence cannot be relabelled across modalities`,
    );
  }
  if (typeof identity.evidenceId !== "string" || identity.evidenceId.trim().length === 0) {
    return adapterErr("validation_error", "evidenceId must be a non-empty string");
  }
  if (typeof identity.taskId !== "string" || identity.taskId.trim().length === 0) {
    return adapterErr("validation_error", "taskId must be a non-empty string");
  }
  if (typeof identity.operatorId !== "string" || identity.operatorId.trim().length === 0) {
    return adapterErr("validation_error", "operatorId must be a non-empty string");
  }
  if (typeof identity.assignmentVersion !== "number" || !Number.isSafeInteger(identity.assignmentVersion) || identity.assignmentVersion < 1) {
    return adapterErr("validation_error", "assignmentVersion must be a positive safe integer");
  }
  const expectedMetricKind = capture.modality === "sonar" ? "sonar_ping" : "visibility_m";
  const unbacked = capture.samples.filter((sample) => sample.qualityMetric?.kind !== expectedMetricKind);
  if (unbacked.length > 0) {
    return adapterErr(
      "sensor_metric_unavailable",
      `capture has ${unbacked.length} sample(s) without the ${expectedMetricKind} backing metric — ${capture.modality} evidence cannot be prepared (for optical this means no valid calibration was available)`,
    );
  }
  return adapterOk({
    evidenceId: identity.evidenceId,
    missionId: capture.missionId,
    taskId: identity.taskId,
    assignmentVersion: identity.assignmentVersion,
    operatorId: identity.operatorId,
    sensor: identity.sensor,
    simulatorSource: capture.provenance.sourceKind,
    capturedAtMs: capture.window.capturedAtMs,
    samples: capture.samples,
  });
}

/**
 * Run the EXISTING verifier over a prepared capture, unchanged. All
 * acceptance logic lives in services/verifier; this is plumbing with one
 * added guard: the decision clock must be a safe integer at or after the
 * capture time, on the capture's documented domain.
 */
export function evaluateCapture(
  capture: EvidenceCapture,
  identity: EvidenceIdentity,
  policy: EvidencePolicy,
  request: VerificationRequestContext,
): EvidenceAdapterResult<VerificationOutcome> {
  if (!isRecord(capture) || capture.captureSchema !== EVIDENCE_CAPTURE_SCHEMA) {
    return adapterErr("validation_error", "evaluateCapture needs an evidence capture built by this adapter");
  }
  if (typeof request.nowMs !== "number" || !Number.isSafeInteger(request.nowMs) || request.nowMs < 0) {
    return adapterErr("validation_error", `decision nowMs must be a non-negative safe integer, got ${String(request.nowMs)}`);
  }
  if (request.nowMs < capture.window.capturedAtMs) {
    return adapterErr(
      "decision_clock_domain_mismatch",
      `decision nowMs ${request.nowMs} precedes the capture time ${capture.window.capturedAtMs} — ` +
        `the decision clock must share the capture's anchored domain (captureEpochBaseMs ${capture.clockMapping.captureEpochBaseMs} + mission time, algorithm ${capture.clockMapping.algorithm}); ` +
        "a simulator-relative or differently-anchored clock would silently corrupt every freshness rule",
    );
  }
  const prepared = prepareSubmission(capture, identity);
  if (!prepared.ok) return prepared;

  // The verifier's own untrusted-input gate re-validates every field and
  // every sample; this adapter does not weaken or bypass it. Verifier
  // rejections (contracts Result vocabulary) are surfaced with their exact
  // message under the adapter's validation code.
  const submission = makeEvidenceSubmission(prepared.value);
  if (!submission.ok) {
    return adapterErr("validation_error", `verifier rejected the prepared submission: ${submission.error.message}`);
  }

  const expectedMissionId = asMissionId(request.expectedMissionId);
  if (!expectedMissionId.ok) return adapterErr("validation_error", expectedMissionId.error.message);
  const expectedTaskId = asTaskId(request.expectedTaskId);
  if (!expectedTaskId.ok) return adapterErr("validation_error", expectedTaskId.error.message);
  const expectedOperatorId = asOperatorId(request.expectedOperatorId);
  if (!expectedOperatorId.ok) return adapterErr("validation_error", expectedOperatorId.error.message);
  const nowMs = asEpochMs(request.nowMs);
  if (!nowMs.ok) return adapterErr("validation_error", nowMs.error.message);

  const outcome = verifyEvidence(submission.value, policy, {
    expectedMissionId: expectedMissionId.value,
    expectedTaskId: expectedTaskId.value,
    currentAssignmentVersion: request.currentAssignmentVersion,
    expectedOperatorId: expectedOperatorId.value,
    activePolicyId: request.activePolicyId,
    nowMs: nowMs.value,
  });
  if (!outcome.ok) return adapterErr("validation_error", outcome.error.message);
  return adapterOk(outcome.value);
}
