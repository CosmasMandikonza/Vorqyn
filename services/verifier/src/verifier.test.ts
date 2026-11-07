/**
 * VQ-10 verifier tests (issue #11 mandatory cases). All fixtures are
 * explicitly SYNTHETIC simulation evidence — no real-sensor claim.
 */

import type { TelemetrySample } from "@vorqyn/contracts";
import { describe, expect, it } from "vitest";
import {
  CTX_V1_ROV_A,
  CTX_V2_ROV_B,
  POLICY_SEA_OBSTRUCTION_1,
  POLICY_STRUCTURAL_CERTIFICATION_1,
  SUBMISSION_ROV_A_V1,
  SUBMISSION_ROV_B_V2,
  rovAOpticalSamples,
  synthSample,
  verifyEvidence,
  type EvidenceSubmission,
} from "./index";

describe("flagship verdicts (PORT-001 recovery loop)", () => {
  it("rejects ROV A optical survey under low visibility with measured values", () => {
    const outcome = verifyEvidence(SUBMISSION_ROV_A_V1, POLICY_SEA_OBSTRUCTION_1, CTX_V1_ROV_A);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons.some((r) => r.startsWith("visibility_m_below_min:"))).toBe(true);
    expect(outcome.value.verdict.reasons.join(" ")).toContain("worst=0.400");
  });

  it("accepts ROV B sonar for obstruction mapping after reassignment", () => {
    const outcome = verifyEvidence(SUBMISSION_ROV_B_V2, POLICY_SEA_OBSTRUCTION_1, CTX_V2_ROV_B);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(true);
    expect(outcome.value.verdict.reasons).toEqual([]);
    expect(outcome.value.sampleRefs).toHaveLength(4);
  });

  it("permits sonar for obstruction mapping ONLY — structural certification rejects sonar", () => {
    const outcome = verifyEvidence(SUBMISSION_ROV_B_V2, POLICY_STRUCTURAL_CERTIFICATION_1, {
      ...CTX_V2_ROV_B,
      activePolicyId: POLICY_STRUCTURAL_CERTIFICATION_1.policyId,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toContain("sensor_not_permitted:sonar");
  });
});

describe("binding defences (stale / forged / mismatched)", () => {
  it("rejects replay from a prior assignment version even with perfect evidence", () => {
    // ROV B's fine sonar evidence, but submitted against version 1 context
    // (the projection moved on after reassignment).
    const outcome = verifyEvidence(SUBMISSION_ROV_B_V2, POLICY_SEA_OBSTRUCTION_1, CTX_V1_ROV_A);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons.join(" ")).toContain("stale_assignment_version:submitted=2:current=1");
    expect(outcome.value.verdict.reasons.join(" ")).toContain("operator_mismatch");
  });

  it("rejects the wrong operator submitting the current version", () => {
    const forged: EvidenceSubmission = { ...SUBMISSION_ROV_B_V2, operatorId: "operator-rov-a" as EvidenceSubmission["operatorId"] };
    const outcome = verifyEvidence(forged, POLICY_SEA_OBSTRUCTION_1, CTX_V2_ROV_B);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons.join(" ")).toContain("operator_mismatch:submitted=operator-rov-a:expected=operator-rov-b");
  });

  it("rejects evidence from another mission (cross-mission contamination)", () => {
    const foreign = synthSample({ robotId: "rov-x-99", sequence: 50, sourceTimestampMs: 1_762_000_000_000 - 1_000, x: 1, y: 1, missionId: "port-999" });
    const outcome = verifyEvidence(
      { ...SUBMISSION_ROV_B_V2, samples: [...SUBMISSION_ROV_B_V2.samples, foreign] },
      POLICY_SEA_OBSTRUCTION_1,
      CTX_V2_ROV_B,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.reasons.join(" ")).toContain("cross_mission_sample:rov-x-99#50@port-999");
  });

  it("rejects when the active policy changed between capture and claim", () => {
    const outcome = verifyEvidence(SUBMISSION_ROV_B_V2, POLICY_STRUCTURAL_CERTIFICATION_1, CTX_V2_ROV_B);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.reasons.join(" ")).toContain("policy_mismatch");
  });
});

describe("measurement defences (never default-accept)", () => {
  it("treats a MISSING visibility metric as a rejection, not a pass", () => {
    const noMetric = rovAOpticalSamples().map((s) => ({ ...s, qualityMetric: undefined }));
    const outcome = verifyEvidence(
      { ...SUBMISSION_ROV_A_V1, samples: noMetric },
      POLICY_SEA_OBSTRUCTION_1,
      CTX_V1_ROV_A,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toContain("metric_missing:visibility_m");
  });

  it("rejects stale samples with measured age", () => {
    const stale: EvidenceSubmission = {
      ...SUBMISSION_ROV_B_V2,
      samples: SUBMISSION_ROV_B_V2.samples.map((s) => ({
        ...s,
        sourceTimestampMs: (1_762_000_000_000 - 300_000) as TelemetrySample["sourceTimestampMs"],
      })),
    };
    const outcome = verifyEvidence(stale, POLICY_SEA_OBSTRUCTION_1, CTX_V2_ROV_B);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.reasons.join(" ")).toMatch(/sample_stale:rov-b-02#40:age_ms=300000/);
  });

  it("rejects out-of-order timestamps and sequence gaps/duplicates", () => {
    // 40 -> 43 is a gap; the two #43s duplicate AND reverse time order.
    const cap = 1_762_000_000_000;
    const gapped = synthSample({ robotId: "rov-b-02", sequence: 40, sourceTimestampMs: cap - 1_000, x: 1, y: 1 });
    const dupLate = synthSample({ robotId: "rov-b-02", sequence: 43, sourceTimestampMs: cap - 800, x: 2, y: 2 });
    const dupEarly = synthSample({ robotId: "rov-b-02", sequence: 43, sourceTimestampMs: cap - 900, x: 3, y: 3 });
    const outcome = verifyEvidence(
      // Input order matters for the stable sort: this sorts to
      // [40, 43@-800, 43@-900] — the trailing #43 moves TIME BACKWARD.
      { ...SUBMISSION_ROV_B_V2, samples: [dupLate, gapped, dupEarly] },
      POLICY_SEA_OBSTRUCTION_1,
      CTX_V2_ROV_B,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const all = outcome.value.verdict.reasons.join(" ");
    expect(all).toContain("sequence_gap:rov-b-02:40->43");
    expect(all).toContain("sequence_duplicate:rov-b-02#43");
    expect(all).toContain("out_of_order_timestamps:rov-b-02#43");
  });

  it("rejects samples outside the coverage zone with measured distance", () => {
    const far = synthSample({ robotId: "rov-b-02", sequence: 60, sourceTimestampMs: 1_762_000_000_000 - 1_000, x: 500, y: 500 });
    const outcome = verifyEvidence(
      { ...SUBMISSION_ROV_B_V2, samples: [...SUBMISSION_ROV_B_V2.samples, far] },
      POLICY_SEA_OBSTRUCTION_1,
      CTX_V2_ROV_B,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.reasons.join(" ")).toMatch(/outside_zone:rov-b-02#60:distance_m=/);
  });

  it("rejects disallowed origins (REPLAY evidence under a live-only policy)", () => {
    const replayed = SUBMISSION_ROV_B_V2.samples.map((s) => ({ ...s, sourceKind: "REPLAY" as const }));
    const outcome = verifyEvidence(
      { ...SUBMISSION_ROV_B_V2, samples: replayed },
      POLICY_SEA_OBSTRUCTION_1,
      CTX_V2_ROV_B,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.reasons.join(" ")).toContain("origin_not_allowed:REPLAY");
  });

  it("rejects insufficient sample volume", () => {
    const outcome = verifyEvidence(
      { ...SUBMISSION_ROV_B_V2, samples: SUBMISSION_ROV_B_V2.samples.slice(0, 2) },
      POLICY_SEA_OBSTRUCTION_1,
      CTX_V2_ROV_B,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.reasons).toContain("insufficient_samples:2<3");
  });
});

describe("review corrections (PR #49)", () => {
  it("rejects a submission for a DIFFERENT mission or task than the authority context", () => {
    // Failing-first pre-fix: a wholly-foreign submission sailed through
    // the binding checks (only sample-vs-submission mismatch was caught).
    const outcome = verifyEvidence(
      { ...SUBMISSION_ROV_B_V2, missionId: "port-999" as typeof SUBMISSION_ROV_B_V2.missionId, taskId: "task-other" as typeof SUBMISSION_ROV_B_V2.taskId },
      POLICY_SEA_OBSTRUCTION_1,
      CTX_V2_ROV_B,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toContain("mission_mismatch:submitted=port-999:expected=port-001");
    expect(outcome.value.verdict.reasons).toContain("task_mismatch:submitted=task-other:expected=task-sea-survey");
  });

  it("rejects internally-consistent evidence captured long before the decision clock", () => {
    // Failing-first pre-fix: freshness only measured capture-vs-sample;
    // an ancient but internally consistent capture was accepted.
    const ancient = { ...SUBMISSION_ROV_B_V2, capturedAtMs: (CTX_V2_ROV_B.nowMs - 10 * 60_000) as typeof SUBMISSION_ROV_B_V2.capturedAtMs,
      samples: SUBMISSION_ROV_B_V2.samples.map((s) => ({ ...s, sourceTimestampMs: (s.sourceTimestampMs - 10 * 60_000) as typeof s.sourceTimestampMs })) };
    const outcome = verifyEvidence(ancient, POLICY_SEA_OBSTRUCTION_1, CTX_V2_ROV_B);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons.join(" ")).toMatch(/capture_stale:age_ms=600000:max=300000/);
  });

  it("rejects a sonar LABEL without sonar-backed source metrics", () => {
    // Failing-first pre-fix: the caller-provided sensor string was the
    // only modality signal — optical-only samples relabeled "sonar" paid.
    const relabeled = SUBMISSION_ROV_B_V2.samples.map((s) => ({
      ...s, qualityMetric: { kind: "visibility_m", value: 2.0 },
    }));
    const outcome = verifyEvidence(
      { ...SUBMISSION_ROV_B_V2, sensor: "sonar", samples: relabeled },
      POLICY_SEA_OBSTRUCTION_1,
      CTX_V2_ROV_B,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.verdict.accepted).toBe(false);
    expect(outcome.value.verdict.reasons).toContain("sensor_backing_missing:sonar:kind=sonar_ping");
  });
});
