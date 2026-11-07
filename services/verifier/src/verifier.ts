/**
 * VORQYN deterministic task-evidence verifier (VQ-10 / #11).
 *
 * Judges an evidence submission against a versioned policy using ONLY the
 * normalized source records it carries. Deterministic by construction:
 * every input (including the decision clock `nowMs`) is explicit; no
 * wall-clock, no randomness, no LLM output can qualify as a verdict.
 * Missing data NEVER defaults to pass — an absent required metric is a
 * measured rejection. Every rejection carries machine-readable rule IDs
 * with the measured values that tripped them.
 *
 * TRUST BOUNDARY (issue #11 checklist): this module validates POLICY over
 * SOURCE RECORDS. It does not attest physical truth — the independent
 * verifier authority (separate key from AI and operators, VQ-06 registry)
 * signs the accepted attestation and owns that responsibility.
 */

import {
  err,
  makeTelemetrySample,
  ok,
  type EpochMs,
  type EvidenceDigest,
  type MissionId,
  type OperatorId,
  type Result,
  type TelemetrySample,
  type TaskId,
  type Verdict,
} from "@vorqyn/contracts";
import { computeEvidenceDigest } from "./digest";
import { VERDICT_VERSION, VERIFIER_ID, type EvidencePolicy } from "./policy";

/** What an operator submits: identity tuple + sensor + actual samples. */
export interface EvidenceSubmission {
  readonly evidenceId: string;
  readonly missionId: MissionId;
  readonly taskId: TaskId;
  readonly assignmentVersion: number;
  readonly operatorId: OperatorId;
  /** Sensor the survey claims to have used, e.g. "sonar" | "optical". */
  readonly sensor: string;
  readonly simulatorSource: TelemetrySample["sourceKind"];
  readonly capturedAtMs: EpochMs;
  readonly samples: readonly TelemetrySample[];
}

/** The authority-side facts the verifier checks the submission against. */
export interface VerificationContext {
  /** The mission this evidence must belong to (PR #49 review finding 1). */
  readonly expectedMissionId: MissionId;
  /** The task this evidence must belong to (PR #49 review finding 1). */
  readonly expectedTaskId: TaskId;
  /** The mission projection's CURRENT assignment version for the task. */
  readonly currentAssignmentVersion: number;
  /** From TaskConfig.acceptancePolicyId — which policy governs this task. */
  readonly activePolicyId: string;
  /** The currently assigned operator (from the same projection). */
  readonly expectedOperatorId: OperatorId;
  /** Decision clock (explicit; deterministic for tests and replay). */
  readonly nowMs: EpochMs;
}

/** A verdict plus the artifacts VQ-06's claim path consumes. */
export interface VerificationOutcome {
  readonly verdict: Verdict;
  readonly digest: EvidenceDigest;
  /** Stable per-sample references (robotId#sequence@sourceTimestampMs). */
  readonly sampleRefs: readonly string[];
}

/** Parse + validate untrusted submission input into contract samples. */
export function makeEvidenceSubmission(input: {
  evidenceId: string;
  missionId: string;
  taskId: string;
  assignmentVersion: number;
  operatorId: string;
  sensor: string;
  simulatorSource: string;
  capturedAtMs: number;
  samples: readonly unknown[];
}): Result<EvidenceSubmission> {
  if (typeof input.assignmentVersion !== "number" || !Number.isSafeInteger(input.assignmentVersion) || input.assignmentVersion < 1)
    return err("validation_error", "assignmentVersion must be a positive integer");
  if (typeof input.capturedAtMs !== "number" || !Number.isSafeInteger(input.capturedAtMs) || input.capturedAtMs < 0)
    return err("validation_error", "capturedAtMs must be a non-negative integer");
  if (typeof input.sensor !== "string" || input.sensor.trim().length === 0)
    return err("validation_error", "sensor must be a non-empty string");
  const samples: TelemetrySample[] = [];
  for (const raw of input.samples) {
    const sample = makeTelemetrySample(raw);
    if (!sample.ok) return sample;
    samples.push(sample.value);
  }
  return ok({
    evidenceId: input.evidenceId,
    missionId: input.missionId as MissionId,
    taskId: input.taskId as TaskId,
    assignmentVersion: input.assignmentVersion,
    operatorId: input.operatorId as OperatorId,
    sensor: input.sensor,
    simulatorSource: input.simulatorSource as TelemetrySample["sourceKind"],
    capturedAtMs: input.capturedAtMs as EpochMs,
    samples,
  });
}

const distance2d = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/**
 * The deterministic verdict. Rule evaluation order is fixed so reason
 * lists are reproducible byte-for-byte for identical inputs.
 */
export function verifyEvidence(
  submission: EvidenceSubmission,
  policy: EvidencePolicy,
  ctx: VerificationContext,
): Result<VerificationOutcome> {
  const reasons: string[] = [];

  // 1. Binding: the submission must target THIS task, mission, operator
  //    and the CURRENT assignment version (replay from a prior assignment
  //    is rejected even if the evidence itself was fine back then).
  if (submission.assignmentVersion !== ctx.currentAssignmentVersion)
    reasons.push(
      `stale_assignment_version:submitted=${submission.assignmentVersion}:current=${ctx.currentAssignmentVersion}`,
    );
  if (submission.operatorId !== ctx.expectedOperatorId)
    reasons.push(
      `operator_mismatch:submitted=${submission.operatorId}:expected=${ctx.expectedOperatorId}`,
    );
  if (submission.missionId !== ctx.expectedMissionId)
    reasons.push(
      `mission_mismatch:submitted=${submission.missionId}:expected=${ctx.expectedMissionId}`,
    );
  if (submission.taskId !== ctx.expectedTaskId)
    reasons.push(
      `task_mismatch:submitted=${submission.taskId}:expected=${ctx.expectedTaskId}`,
    );
  for (const s of submission.samples) {
    if (s.missionId !== submission.missionId)
      reasons.push(`cross_mission_sample:${s.robotId}#${s.sequence}@${s.missionId}`);
  }

  // 2. Policy identity: the ACTIVE policy must be the one whose rules we
  //    are applying (policy change between capture and claim rejects).
  if (policy.policyId !== ctx.activePolicyId)
    reasons.push(`policy_mismatch:active=${ctx.activePolicyId}:applied=${policy.policyId}`);

  // 3. Origin: every sample must come from an allowed source kind.
  for (const s of submission.samples) {
    if (!policy.allowedOrigins.includes(s.sourceKind))
      reasons.push(`origin_not_allowed:${s.sourceKind}:${s.robotId}#${s.sequence}`);
  }

  // 4. Sensor + measured quality (the flagship split).
  const sensorRule = policy.sensors.find((r) => r.sensorId === submission.sensor);
  if (sensorRule === undefined) {
    reasons.push(`sensor_not_permitted:${submission.sensor}`);
  } else {
    // Modality must be SOURCE-BACKED: the declared sensor needs at least
    // one sample carrying its authoritative backing metric kind — a bare
    // caller-provided label never qualifies (PR #49 review finding 3).
    const backing = sensorRule.backingMetricKind ?? sensorRule.requiresMetric?.kind;
    if (backing === undefined) {
      reasons.push(`sensor_rule_incomplete:${submission.sensor}`);
    } else if (!submission.samples.some((s) => s.qualityMetric?.kind === backing)) {
      reasons.push(`sensor_backing_missing:${submission.sensor}:kind=${backing}`);
    }
  }
  if (sensorRule !== undefined && !sensorRule.satisfiesOnItsOwn && sensorRule.requiresMetric !== undefined) {
    const rule = sensorRule.requiresMetric;
    if (rule === undefined) {
      // No metric requirement recorded for a non-self-sufficient sensor is
      // a policy authoring bug: fail closed.
      reasons.push(`sensor_rule_incomplete:${submission.sensor}`);
    } else {
      const metric = submission.samples.find(
        (s) => s.qualityMetric !== undefined && s.qualityMetric.kind === rule.kind,
      )?.qualityMetric;
      if (metric === undefined) {
        reasons.push(`metric_missing:${rule.kind}`);
      } else {
        const worst = Math.min(
          ...submission.samples
            .map((s) => (s.qualityMetric !== undefined && s.qualityMetric.kind === rule.kind ? s.qualityMetric.value : Number.POSITIVE_INFINITY))
            .filter((v) => Number.isFinite(v)),
        );
        if (worst < rule.minMetres)
          reasons.push(
            `${rule.kind}_below_min:worst=${worst.toFixed(3)}:min=${rule.minMetres}`,
          );
      }
    }
  }

  // 4b. Capture freshness: the WHOLE capture must be recent relative to
  //     the decision clock — internal consistency alone is not enough
  //     (PR #49 review finding 2).
  const captureAge = ctx.nowMs - submission.capturedAtMs;
  if (captureAge < 0 || captureAge > policy.maxCaptureAgeMs)
    reasons.push(`capture_stale:age_ms=${captureAge}:max=${policy.maxCaptureAgeMs}`);

  // 5. Freshness: every sample's source clock within the capture window.
  for (const s of submission.samples) {
    const age = submission.capturedAtMs - s.sourceTimestampMs;
    if (age < 0 || age > policy.maxSourceAgeMs)
      reasons.push(`sample_stale:${s.robotId}#${s.sequence}:age_ms=${age}:max=${policy.maxSourceAgeMs}`);
  }

  // 6. Sequence continuity: duplicates/regressions/gaps break provenance.
  const byRobot = new Map<string, TelemetrySample[]>();
  for (const s of submission.samples) {
    const list = byRobot.get(s.robotId) ?? [];
    list.push(s);
    byRobot.set(s.robotId, list);
  }
  for (const [robotId, list] of byRobot) {
    const ordered = [...list].sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1];
      const curr = ordered[i];
      if (prev === undefined || curr === undefined) continue; // unreachable; satisfies noUncheckedIndexedAccess-style narrowing
      const gap = curr.sequence - prev.sequence;
      if (gap === 0) reasons.push(`sequence_duplicate:${robotId}#${curr.sequence}`);
      if (gap > policy.maxSequenceGap + 1)
        reasons.push(`sequence_gap:${robotId}:${prev.sequence}->${curr.sequence}`);
      if (curr.sourceTimestampMs < prev.sourceTimestampMs)
        reasons.push(`out_of_order_timestamps:${robotId}#${curr.sequence}`);
    }
  }

  // 7. Coverage zone: every sample inside the policy zone (measured).
  for (const s of submission.samples) {
    const d = distance2d(s.position.x, s.position.y, policy.zone.centerX, policy.zone.centerY);
    if (d > policy.zone.radiusMetres)
      reasons.push(
        `outside_zone:${s.robotId}#${s.sequence}:distance_m=${d.toFixed(3)}:radius_m=${policy.zone.radiusMetres}`,
      );
  }

  // 8. Minimum evidence volume.
  if (submission.samples.length < policy.minSamples)
    reasons.push(`insufficient_samples:${submission.samples.length}<${policy.minSamples}`);

  const verdict: Verdict = {
    evidenceId: submission.evidenceId as Verdict["evidenceId"],
    accepted: reasons.length === 0,
    reasons,
    verifierId: VERIFIER_ID,
    verdictVersion: VERDICT_VERSION,
    decidedAtMs: ctx.nowMs,
  };
  return ok({
    verdict,
    digest: computeEvidenceDigest(submission),
    sampleRefs: submission.samples.map((s) => `${s.robotId}#${s.sequence}@${s.sourceTimestampMs}`),
  });
}
