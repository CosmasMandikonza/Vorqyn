/** QA only: real kernel/journal inputs, no verifier metric or chain receipt fabrication. */
import { executeDemoSimulation } from "@/lib/demo-simulation/execute";
import { deriveGuestTrace } from "@/lib/simulation-journal/trace-execute";
import type { DemoOperation } from "@/lib/demo-simulation/contract";
import {
  appendKernelSnapshot,
  createGuestObservationJournal,
} from "../../../../services/mission/simulation/observation-journal";
import {
  makeEvidenceSubmission,
  verifyEvidence,
  POLICY_SEA_OBSTRUCTION_1,
} from "../../../../services/verifier/src/index";
import { FIXTURE_EPOCH_BASE_MS, type Result } from "@vorqyn/contracts";

export function unwrap<T>(result: Result<T>): T {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
export const SEED = 20261107;
export const MISSION = `guest-port-${SEED}`;
export const TASK = "task-sea-survey";
export const OPERATIONS: DemoOperation[] = [
  { op: "step", count: 2 },
  {
    op: "command",
    command: {
      type: "injectOpticalVisibilityFault",
      robotId: "rov-01",
      severity: "severe",
      durationMs: 2000,
      idempotencyKey: "qa-optical-fault",
    },
  },
  { op: "step", count: 6 },
];
export function scenario(seed = SEED, missionId = `guest-port-${seed}`) {
  const execution = executeDemoSimulation({ seed, operations: OPERATIONS });
  let journal = unwrap(createGuestObservationJournal({ missionId, seed }));
  for (const snapshot of execution.snapshots) {
    const next = appendKernelSnapshot(journal, snapshot);
    if (!next.ok) throw new Error(next.error.message);
    journal = next.journal;
  }
  const samples = journal.records
    .flatMap((r) => r.telemetry.map((entry) => entry.sample))
    .filter((s) => s.robotId === "rov-01");
  const trace = deriveGuestTrace({
    seed,
    operations: OPERATIONS,
    cursor: { afterSequence: 0, limit: 400 },
  }).response;
  return { execution, journal, samples, trace };
}
export function verifierInput(sensor = "optical") {
  const { samples } = scenario();
  const submission = unwrap(
    makeEvidenceSubmission({
      evidenceId: "evidence-real-kernel-qa",
      missionId: MISSION,
      taskId: TASK,
      assignmentVersion: 1,
      operatorId: "operator-rov-a",
      sensor,
      simulatorSource: "SYNTHETIC_SIM",
      capturedAtMs: FIXTURE_EPOCH_BASE_MS + 20,
      samples,
    }),
  );
  const context = {
    expectedMissionId: submission.missionId,
    expectedTaskId: submission.taskId,
    currentAssignmentVersion: 1,
    activePolicyId: POLICY_SEA_OBSTRUCTION_1.policyId,
    expectedOperatorId: submission.operatorId,
    nowMs: submission.capturedAtMs,
  };
  return { submission, context };
}
export function currentBoundaryFindings() {
  const { submission, context } = verifierInput();
  const outcome = unwrap(
    verifyEvidence(submission, POLICY_SEA_OBSTRUCTION_1, context),
  );
  return {
    sourceKind: submission.simulatorSource,
    emittedMetricKinds: [
      ...new Set(submission.samples.map((s) => s.qualityMetric?.kind)),
    ],
    requiredMetricKinds: ["visibility_m", "sonar_ping"],
    sampleSourceTimesMs: submission.samples.map((s) => s.sourceTimestampMs),
    capturedAtMs: submission.capturedAtMs,
    accepted: outcome.verdict.accepted,
    reasons: outcome.verdict.reasons,
    metricCompatibility: "BLOCKED",
    clockMapping: "BLOCKED",
    explanation:
      "Unitless optical sensor ID is not visibility metres; receipt epochs do not rebase simulator source clocks. No source-backed conversion or clock mapping is implemented by QA.",
  };
}
