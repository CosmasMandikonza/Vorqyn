/**
 * End-to-end evidence adapter → verifier integration tests (issue #9 slice).
 *
 * The acceptance logic is Omar's EXISTING verifier, invoked unchanged via
 * the adapter's `evaluateCapture`. These tests pin the flagship outcomes:
 *
 * - real sonar capture under the shipped obstruction policy → ACCEPTED;
 * - real faulted optical capture (calibrated test fixture) → REJECTED with
 *   the measured `visibility_m_below_min` reason — the ROV A / ROV B split
 *   in the correct evidence vocabulary;
 * - the clock-mapping fix: naive relative-vs-epoch combinations produce
 *   false `sample_stale` rejections, adapter-mapped captures do not, and
 *   genuine staleness is still enforced (`capture_stale`);
 * - identity/provenance/duplicate/continuity negatives through the real
 *   verifier rules; no lifecycle or chain artifact is ever produced here.
 */

import { describe, expect, it } from "vitest";
import { asEpochMs, asMissionId, asOperatorId, asTaskId, FIXTURE_EPOCH_BASE_MS, type TelemetrySample } from "@vorqyn/contracts";
import {
  POLICY_SEA_OBSTRUCTION_1,
  POLICY_STRUCTURAL_CERTIFICATION_1,
  computeEvidenceDigest,
  makeEvidenceSubmission,
  verifyEvidence,
  type VerificationContext,
} from "../../../../services/verifier/src/index";
import {
  buildEvidenceCapture,
  evaluateCapture,
  prepareSubmission,
  type EvidenceIdentity,
} from "../../../../services/mission/evidence-adapter";
import {
  DECISION_OFFSET_MS,
  DEMO_MAPPING,
  MISSION_ID,
  OPERATOR_ROV_A,
  OPERATOR_ROV_B,
  SEA_TASK_ID,
  TEST_CALIBRATION,
  journalFromSnapshots,
  runKernel,
} from "./harness";

const SONAR_IDENTITY: EvidenceIdentity = {
  evidenceId: "evg-sonar-001",
  taskId: SEA_TASK_ID,
  assignmentVersion: 1,
  operatorId: OPERATOR_ROV_B,
  sensor: "sonar",
};

const OPTICAL_IDENTITY: EvidenceIdentity = {
  evidenceId: "evg-optical-001",
  taskId: SEA_TASK_ID,
  assignmentVersion: 1,
  operatorId: OPERATOR_ROV_A,
  sensor: "optical",
};

type ContextOverrides = Partial<{
  expectedMissionId: string;
  expectedTaskId: string;
  currentAssignmentVersion: number;
  expectedOperatorId: string;
  activePolicyId: string;
  nowMs: number;
}>;

/**
 * Build the verifier context with contract-validated (branded) identifiers.
 * The decision clock defaults to capture time + 1 s, on the capture domain.
 */
function buildContext(capturedAtMs: number, overrides: ContextOverrides = {}): VerificationContext {
  const raw = {
    expectedMissionId: MISSION_ID,
    expectedTaskId: SEA_TASK_ID,
    currentAssignmentVersion: 1,
    expectedOperatorId: OPERATOR_ROV_B,
    activePolicyId: POLICY_SEA_OBSTRUCTION_1.policyId,
    nowMs: capturedAtMs + DECISION_OFFSET_MS,
    ...overrides,
  };
  const mission = asMissionId(raw.expectedMissionId);
  const task = asTaskId(raw.expectedTaskId);
  const operator = asOperatorId(raw.expectedOperatorId);
  const now = asEpochMs(raw.nowMs);
  if (!mission.ok || !task.ok || !operator.ok || !now.ok) throw new Error("harness context must be valid");
  return {
    expectedMissionId: mission.value,
    expectedTaskId: task.value,
    currentAssignmentVersion: raw.currentAssignmentVersion,
    expectedOperatorId: operator.value,
    activePolicyId: raw.activePolicyId,
    nowMs: now.value,
  };
}

const OPTICAL_SCOPE = ["rov-01"]; // the sea task's survey robot

describe("flagship integration — sonar evidence accepted under the shipped policy", () => {
  it("accepts a real clean-window sonar capture for the currently assigned operator", () => {
    // Survey the ACTUAL world obstruction (v2 zone at (170, -90)): the ROV
    // route runs into the obstruction box; only in-box records form the
    // survey subset — harbour transit is excluded by box membership, never
    // silently dropped.
    const { snapshots } = runKernel((k) => {
      k.step(230); // full outbound leg ends at the obstruction centre (170, -90)
    });
    const inBox = snapshots.filter((snapshot) => {
      const pose = snapshot.robots.find((r) => r.robotId === "rov-01")?.pose;
      return pose !== undefined && pose.x >= 120 && pose.x <= 220 && pose.y >= -120 && pose.y <= -60;
    });
    expect(inBox.length).toBeGreaterThanOrEqual(POLICY_SEA_OBSTRUCTION_1.minSamples);
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({
      journal,
      modality: "sonar",
      clockMapping: DEMO_MAPPING,
      records: journal.records.filter((record) => {
        const pose = record.snapshot.robots.find((r) => r.robotId === "rov-01")?.pose;
        return pose !== undefined && pose.x >= 120 && pose.x <= 220 && pose.y >= -120 && pose.y <= -60;
      }),
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;

    const outcome = evaluateCapture(capture.value, SONAR_IDENTITY, POLICY_SEA_OBSTRUCTION_1, buildContext(capture.value.window.capturedAtMs));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(true);
    expect(outcome.value.verdict.reasons).toEqual([]);
    expect(outcome.value.verdict.verifierId).toBe("verifier-vorqyn-lane1");
    expect(outcome.value.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.value.sampleRefs).toEqual(expect.arrayContaining([expect.stringMatching(/^rov-01#\d+@\d+$/)]));
  });

  it("is deterministic: same seed and trace produce the same digest; tampered bytes do not", () => {
    const first = runKernel((k) => {
      k.step(6);
    });
    const second = runKernel((k) => {
      k.step(6);
    });
    const firstCapture = buildEvidenceCapture({ journal: journalFromSnapshots(MISSION_ID, first.snapshots), modality: "sonar", clockMapping: DEMO_MAPPING });
    const secondCapture = buildEvidenceCapture({ journal: journalFromSnapshots(MISSION_ID, second.snapshots), modality: "sonar", clockMapping: DEMO_MAPPING });
    expect(firstCapture.ok && secondCapture.ok).toBe(true);
    if (!firstCapture.ok || !secondCapture.ok) return;
    const firstPrepared = prepareSubmission(firstCapture.value, SONAR_IDENTITY);
    const secondPrepared = prepareSubmission(secondCapture.value, SONAR_IDENTITY);
    expect(firstPrepared.ok && secondPrepared.ok).toBe(true);
    if (!firstPrepared.ok || !secondPrepared.ok) return;
    const firstSubmission = makeEvidenceSubmission(firstPrepared.value);
    const secondSubmission = makeEvidenceSubmission(secondPrepared.value);
    expect(firstSubmission.ok && secondSubmission.ok).toBe(true);
    if (!firstSubmission.ok || !secondSubmission.ok) return;
    expect(computeEvidenceDigest(firstSubmission.value)).toBe(computeEvidenceDigest(secondSubmission.value));

    // Tampered bytes → different digest (position of one sample shifted).
    // The prepared input's samples are the verifier's untrusted unknown[] —
    // they are TelemetrySample values produced by this adapter's capture.
    const preparedSamples = firstPrepared.value.samples as readonly TelemetrySample[];
    const tamperedInput = {
      ...firstPrepared.value,
      samples: preparedSamples.map((sample, index) =>
        index === 0 ? { ...sample, position: { ...sample.position, x: sample.position.x + 0.001 } } : sample,
      ),
    };
    const tampered = makeEvidenceSubmission(tamperedInput);
    expect(tampered.ok).toBe(true);
    if (!tampered.ok) return;
    expect(computeEvidenceDigest(tampered.value)).not.toBe(computeEvidenceDigest(firstSubmission.value));
  });
});

describe("flagship integration — the optical fault in the correct evidence vocabulary", () => {
  it("rejects the faulted ROV optical survey with a measured visibility_m_below_min reason", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
      const command = k.issueCommand({
        type: "injectOpticalVisibilityFault",
        robotId: "rov-01",
        severity: "severe",
        durationMs: 9000,
        idempotencyKey: "integration-fault-1",
      });
      expect(command.ok).toBe(true);
      k.step(4); // faulted window: quality01 ~ 0.71 x 0.12
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({
      journal,
      modality: "optical",
      clockMapping: DEMO_MAPPING,
      calibration: TEST_CALIBRATION,
      records: journal.records.slice(6), // the faulted window only
      robotIds: OPTICAL_SCOPE,
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    // The fault is MEASURED: the kernel applied its factor to every sample.
    for (const observation of capture.value.observations) {
      expect(observation.opticalVisibilityFactorApplied).toBe(0.12);
      expect(observation.quality01).toBeLessThan(0.1);
    }
    const rovSamples = capture.value.samples.filter((sample) => sample.robotId === "rov-01");
    expect(rovSamples.length).toBeGreaterThanOrEqual(3);
    expect(rovSamples.every((sample) => sample.quality?.status === "degraded")).toBe(true);
    expect(rovSamples.every((sample) => (sample.qualityMetric?.value ?? 0) < 1.5)).toBe(true);

    const outcome = evaluateCapture(capture.value, OPTICAL_IDENTITY, POLICY_SEA_OBSTRUCTION_1, buildContext(capture.value.window.capturedAtMs, { expectedOperatorId: OPERATOR_ROV_A }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/^visibility_m_below_min:worst=0\.\d+:min=1\.5$/)]),
    );
  });

  it("accepts the same optical survey when visibility clears the bar (clean window, calibrated)", () => {
    // Survey the actual obstruction leg under clean water: the calibrated
    // optical quality clears the 1.5 m bar and every sample lies inside the
    // world obstruction box (v2 zone).
    const { snapshots } = runKernel((k) => {
      k.step(230); // full outbound leg: in-box survey through (170, -90)
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({
      journal,
      modality: "optical",
      clockMapping: DEMO_MAPPING,
      calibration: TEST_CALIBRATION,
      records: journal.records.filter((record) => {
        const pose = record.snapshot.robots.find((r) => r.robotId === "rov-01")?.pose;
        return pose !== undefined && pose.x >= 120 && pose.x <= 220 && pose.y >= -120 && pose.y <= -60;
      }),
      robotIds: OPTICAL_SCOPE,
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    const outcome = evaluateCapture(capture.value, OPTICAL_IDENTITY, POLICY_SEA_OBSTRUCTION_1, buildContext(capture.value.window.capturedAtMs, { expectedOperatorId: OPERATOR_ROV_A }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(true);
    expect(outcome.value.verdict.reasons).toEqual([]);
  });

  it("cannot prepare optical evidence at all without a calibration (structured block)", () => {
    const { snapshots } = runKernel((k) => {
      k.step(3);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "optical", clockMapping: DEMO_MAPPING, robotIds: OPTICAL_SCOPE });
    expect(capture.ok).toBe(false);
    if (capture.ok) return;
    expect(capture.error.code).toBe("optical_visibility_unsupported");
  });
});

describe("flagship integration — clock domains", () => {
  it("the pre-fix bug is real: relative source times vs epoch capture produce false sample_stale", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    const prepared = prepareSubmission(capture.value, SONAR_IDENTITY);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    // Rebuild the submission the OLD (broken) way: raw simulator-relative
    // source times combined with an epoch-shaped capture time. The prepared
    // samples are the verifier's untrusted unknown[] — typed here via the
    // TelemetrySample values this adapter's capture produced.
    const preparedSamples = prepared.value.samples as readonly TelemetrySample[];
    const naiveInput = {
      ...prepared.value,
      capturedAtMs: FIXTURE_EPOCH_BASE_MS + 7, // journal receipt domain, as the old code conflated
      samples: preparedSamples.map((sample, index) => {
        const observation = capture.value.observations[index];
        if (observation === undefined) throw new Error("missing observation");
        return { ...sample, sourceTimestampMs: observation.sourceSimulatorTimeMs };
      }),
    };
    const naive = makeEvidenceSubmission(naiveInput);
    expect(naive.ok).toBe(true);
    if (!naive.ok) return;
    const outcome = verifyEvidence(naive.value, POLICY_SEA_OBSTRUCTION_1, buildContext(prepared.value.capturedAtMs));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/^sample_stale:rov-01#\d+:age_ms=176\d{10}:max=120000$/)]),
    );
  });

  it("the adapter-mapped capture carries no sample_stale reason (fix proven end-to-end)", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    if (!capture.ok) throw new Error("unreachable");
    const outcome = evaluateCapture(capture.value, SONAR_IDENTITY, POLICY_SEA_OBSTRUCTION_1, buildContext(capture.value.window.capturedAtMs));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.reasons.filter((reason) => reason.startsWith("sample_stale"))).toEqual([]);
  });

  it("genuine staleness is still enforced: an old capture rejects capture_stale", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    if (!capture.ok) throw new Error("unreachable");
    const lateDecision = evaluateCapture(capture.value, SONAR_IDENTITY, POLICY_SEA_OBSTRUCTION_1, buildContext(capture.value.window.capturedAtMs, { nowMs: capture.value.window.capturedAtMs + 400_000 }));
    expect(lateDecision.ok).toBe(true);
    if (!lateDecision.ok) return;
    expect(lateDecision.value.verdict.accepted).toBe(false);
    expect(lateDecision.value.verdict.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/^capture_stale:age_ms=400000:max=300000$/)]),
    );
  });

  it("a decision clock that precedes the capture fails LOUDLY with a domain error", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    if (!capture.ok) throw new Error("unreachable");
    const guard = evaluateCapture(capture.value, SONAR_IDENTITY, POLICY_SEA_OBSTRUCTION_1, buildContext(capture.value.window.capturedAtMs, { nowMs: 20000 }));
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.error.code).toBe("decision_clock_domain_mismatch");
    expect(guard.error.message).toMatch(/captureEpochBaseMs/);
  });
});

describe("flagship integration — identity, policy and continuity negatives", () => {
  it("rejects evidence replayed from a prior assignment version", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    if (!capture.ok) throw new Error("unreachable");
    const outcome = evaluateCapture(capture.value, SONAR_IDENTITY, POLICY_SEA_OBSTRUCTION_1, buildContext(capture.value.window.capturedAtMs, { currentAssignmentVersion: 2 }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toEqual(expect.arrayContaining(["stale_assignment_version:submitted=1:current=2"]));
  });

  it("rejects mismatched operator, mission and task bindings", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    if (!capture.ok) throw new Error("unreachable");
    const cases: ContextOverrides[] = [
      { expectedOperatorId: OPERATOR_ROV_A },
      { expectedMissionId: "harbor-002" },
      { expectedTaskId: "task-air-visual" },
    ];
    const patterns = [/^operator_mismatch:/, /^mission_mismatch:/, /^task_mismatch:/];
    for (let index = 0; index < cases.length; index += 1) {
      const overrides = cases[index];
      const pattern = patterns[index];
      if (overrides === undefined || pattern === undefined) continue;
      const outcome = evaluateCapture(capture.value, SONAR_IDENTITY, POLICY_SEA_OBSTRUCTION_1, buildContext(capture.value.window.capturedAtMs, overrides));
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(outcome.value.verdict.accepted).toBe(false);
      expect(outcome.value.verdict.reasons).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));
    }
  });

  it("rejects a policy change between capture and claim", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    if (!capture.ok) throw new Error("unreachable");
    const outcome = evaluateCapture(capture.value, SONAR_IDENTITY, POLICY_STRUCTURAL_CERTIFICATION_1, buildContext(capture.value.window.capturedAtMs));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/^policy_mismatch:active=policy-sea-obstruction-sonar-1:applied=policy-structural-certification-1$/)]),
    );
  });

  it("sonar cannot certify structure under the optical-only policy", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    if (!capture.ok) throw new Error("unreachable");
    const outcome = evaluateCapture(capture.value, SONAR_IDENTITY, POLICY_STRUCTURAL_CERTIFICATION_1, buildContext(capture.value.window.capturedAtMs, { activePolicyId: POLICY_STRUCTURAL_CERTIFICATION_1.policyId }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toEqual(expect.arrayContaining(["sensor_not_permitted:sonar"]));
  });

  it("duplicate samples are rejected by the verifier (defense in depth behind the adapter)", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    if (!capture.ok) throw new Error("unreachable");
    const prepared = prepareSubmission(capture.value, SONAR_IDENTITY);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const firstSample = prepared.value.samples[0];
    expect(firstSample).toBeDefined();
    if (firstSample === undefined) return;
    const duplicatedInput = { ...prepared.value, samples: [...prepared.value.samples, firstSample] };
    const submission = makeEvidenceSubmission(duplicatedInput);
    expect(submission.ok).toBe(true);
    if (!submission.ok) return;
    const outcome = verifyEvidence(submission.value, POLICY_SEA_OBSTRUCTION_1, buildContext(prepared.value.capturedAtMs));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^sequence_duplicate:rov-01#\d+$/)]));
  });

  it("a capture spanning a telemetry disconnect honestly fails sequence continuity", () => {
    const { snapshots } = runKernel((k) => {
      k.step(2);
      k.issueCommand({ type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "integration-disconnect-1" });
      k.step(3);
      k.issueCommand({ type: "reconnectTelemetry", robotId: "rov-01", idempotencyKey: "integration-reconnect-1" });
      k.step(2);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, robotIds: ["rov-01"] });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    const outcome = evaluateCapture(capture.value, SONAR_IDENTITY, POLICY_SEA_OBSTRUCTION_1, buildContext(capture.value.window.capturedAtMs));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/^sequence_missing:rov-01:2->6:missing=3:max=1$/)]),
    );
  });

  it("a forged LIVE_SITL claim over synthetic samples is rejected by the origin rules", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    if (!capture.ok) throw new Error("unreachable");
    const prepared = prepareSubmission(capture.value, SONAR_IDENTITY);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.simulatorSource).toBe("SYNTHETIC_SIM"); // adapter cannot be asked to claim otherwise
    const forgedInput = { ...prepared.value, simulatorSource: "LIVE_SITL" };
    const forged = makeEvidenceSubmission(forgedInput);
    expect(forged.ok).toBe(true);
    if (!forged.ok) return;
    const outcome = verifyEvidence(forged.value, POLICY_SEA_OBSTRUCTION_1, buildContext(prepared.value.capturedAtMs));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toEqual(
      expect.arrayContaining([expect.stringMatching(/^origin_claim_mismatch:claimed=LIVE_SITL:samples=SYNTHETIC_SIM$/)]),
    );
  });

  it("refuses to prepare a submission whose samples lost their backing metric", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    if (!capture.ok) throw new Error("unreachable");
    const stripped = structuredClone(capture.value) as typeof capture.value;
    const firstSample = stripped.samples[0];
    expect(firstSample).toBeDefined();
    if (firstSample === undefined) return;
    (firstSample as { qualityMetric?: unknown }).qualityMetric = undefined;
    const prepared = prepareSubmission(stripped, SONAR_IDENTITY);
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.error.code).toBe("sensor_metric_unavailable");
  });
});

describe("flagship integration — authority boundary", () => {
  it("captures and prepared submissions contain no lifecycle, payment or chain artifacts", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    const serialized = JSON.stringify(capture.value);
    for (const forbidden of ["evidenceAccepted", "payout", "receipt", "chainTime", "attestation", "assignmentVersion"]) {
      expect(serialized).not.toContain(forbidden);
    }
    const prepared = prepareSubmission(capture.value, SONAR_IDENTITY);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    // assignmentVersion is caller-supplied context, never derived by the adapter.
    const preparedSerialized = JSON.stringify(prepared.value);
    for (const forbidden of ["evidenceAccepted", "payout", "receipt", "chainTime", "attestation", "verdict"]) {
      expect(preparedSerialized).not.toContain(forbidden);
    }
  });
});
