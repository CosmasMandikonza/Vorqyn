/**
 * VORQYN evidence fixtures (VQ-10 / #11) — EXPLICITLY SYNTHETIC.
 *
 * These are synthetic-simulation evidence sets for the PORT-001 flagship
 * recovery loop, in the normalized evidence vocabulary this verifier
 * consumes (visibility in metres, local ENU metres). They are NOT
 * real-world sensor measurements and are never presented as such. The
 * mission-service adapter owns any normalization from kernel sensor
 * readings into this vocabulary (out of scope here).
 */

import type { TelemetrySample } from "@vorqyn/contracts";
import type { EvidenceSubmission, VerificationContext } from "./verifier";

const MISSION = "port-001";
const FRAME = "ENU_PORT001_LOCAL";
const CAPTURE_MS = 1_762_000_000_000;

interface SampleSpec {
  robotId: string;
  sequence: number;
  sourceTimestampMs: number;
  x: number;
  y: number;
  visibilityMetres?: number;
  /** Sonar modality backing metric (authoritative source evidence). */
  sonarQuality?: number;
  degraded?: boolean;
  sourceKind?: TelemetrySample["sourceKind"];
  missionId?: string;
}

export function synthSample(spec: SampleSpec): TelemetrySample {
  return {
    missionId: (spec.missionId ?? MISSION) as TelemetrySample["missionId"],
    robotId: spec.robotId as TelemetrySample["robotId"],
    sourceKind: spec.sourceKind ?? "SYNTHETIC_SIM",
    sourceTimestampMs: spec.sourceTimestampMs as TelemetrySample["sourceTimestampMs"],
    receivedAtMs: CAPTURE_MS as TelemetrySample["receivedAtMs"],
    frameId: FRAME,
    sequence: spec.sequence,
    position: { x: spec.x, y: spec.y, z: -4.2 },
    units: "metres",
    quality: spec.degraded
      ? { status: "degraded", detail: "optical-visibility-fault-active" }
      : { status: "ok" },
    ...(spec.visibilityMetres !== undefined
      ? { qualityMetric: { kind: "visibility_m", value: spec.visibilityMetres } }
      : {}),
    ...(spec.sonarQuality !== undefined
      ? { qualityMetric: { kind: "sonar_ping", value: spec.sonarQuality } }
      : {}),
  };
}

/** ROV A optical survey under the injected low-visibility fault (0.4 m). */
export function rovAOpticalSamples(visibility = 0.4): TelemetrySample[] {
  return [
    synthSample({ robotId: "rov-a-01", sequence: 10, sourceTimestampMs: CAPTURE_MS - 4_000, x: 150, y: -75, visibilityMetres: visibility, degraded: visibility < 1.5 }),
    synthSample({ robotId: "rov-a-01", sequence: 11, sourceTimestampMs: CAPTURE_MS - 3_000, x: 157, y: -78, visibilityMetres: visibility, degraded: visibility < 1.5 }),
    synthSample({ robotId: "rov-a-01", sequence: 12, sourceTimestampMs: CAPTURE_MS - 2_000, x: 163, y: -81, visibilityMetres: visibility, degraded: visibility < 1.5 }),
    synthSample({ robotId: "rov-a-01", sequence: 13, sourceTimestampMs: CAPTURE_MS - 1_000, x: 170, y: -84, visibilityMetres: visibility, degraded: visibility < 1.5 }),
  ];
}

/** ROV B sonar survey — no visibility dependency, same zone. */
export function rovBSonarSamples(): TelemetrySample[] {
  return [
    synthSample({ robotId: "rov-b-02", sequence: 40, sourceTimestampMs: CAPTURE_MS - 4_000, x: 150, y: -76, sonarQuality: 0.92 }),
    synthSample({ robotId: "rov-b-02", sequence: 41, sourceTimestampMs: CAPTURE_MS - 3_000, x: 160, y: -82, sonarQuality: 0.90 }),
    synthSample({ robotId: "rov-b-02", sequence: 42, sourceTimestampMs: CAPTURE_MS - 2_000, x: 168, y: -88, sonarQuality: 0.95 }),
    synthSample({ robotId: "rov-b-02", sequence: 43, sourceTimestampMs: CAPTURE_MS - 1_000, x: 172, y: -90, sonarQuality: 0.93 }),
  ];
}

/** Flagship submission: ROV A optical, assignment version 1. */
export const SUBMISSION_ROV_A_V1: EvidenceSubmission = {
  evidenceId: "evid-rova-v1",
  missionId: MISSION as EvidenceSubmission["missionId"],
  taskId: "task-sea-survey" as EvidenceSubmission["taskId"],
  assignmentVersion: 1,
  operatorId: "operator-rov-a" as EvidenceSubmission["operatorId"],
  sensor: "optical",
  simulatorSource: "SYNTHETIC_SIM",
  capturedAtMs: CAPTURE_MS as EvidenceSubmission["capturedAtMs"],
  samples: rovAOpticalSamples(),
};

/** Flagship submission: ROV B sonar, reassigned version 2. */
export const SUBMISSION_ROV_B_V2: EvidenceSubmission = {
  evidenceId: "evid-rovb-v2",
  missionId: MISSION as EvidenceSubmission["missionId"],
  taskId: "task-sea-survey" as EvidenceSubmission["taskId"],
  assignmentVersion: 2,
  operatorId: "operator-rov-b" as EvidenceSubmission["operatorId"],
  sensor: "sonar",
  simulatorSource: "SYNTHETIC_SIM",
  capturedAtMs: CAPTURE_MS as EvidenceSubmission["capturedAtMs"],
  samples: rovBSonarSamples(),
};

/** Authority context while ROV A holds assignment version 1. */
export const CTX_V1_ROV_A: VerificationContext = {
  expectedMissionId: MISSION as VerificationContext["expectedMissionId"],
  expectedTaskId: "task-sea-survey" as VerificationContext["expectedTaskId"],
  currentAssignmentVersion: 1,
  activePolicyId: "policy-sea-obstruction-sonar-1",
  expectedOperatorId: "operator-rov-a" as VerificationContext["expectedOperatorId"],
  nowMs: (CAPTURE_MS + 1_000) as VerificationContext["nowMs"],
};

/** Authority context after reassignment to ROV B at version 2. */
export const CTX_V2_ROV_B: VerificationContext = {
  expectedMissionId: MISSION as VerificationContext["expectedMissionId"],
  expectedTaskId: "task-sea-survey" as VerificationContext["expectedTaskId"],
  currentAssignmentVersion: 2,
  activePolicyId: "policy-sea-obstruction-sonar-1",
  expectedOperatorId: "operator-rov-b" as VerificationContext["expectedOperatorId"],
  nowMs: (CAPTURE_MS + 1_000) as VerificationContext["nowMs"],
};

export const FIXTURE_CAPTURE_MS = CAPTURE_MS;
