/**
 * Guest evidence-journey derivation for POST /api/demo/evidence
 * (VQ-DEMO-EVIDENCE/1, issue #9 slice).
 *
 * REUSES, verbatim, the merged pieces — nothing here re-implements them:
 * - `executeDemoSimulation` (apps/web/lib/demo-simulation/execute): the REAL
 *   world-aligned kernel run (same module as the other guest endpoints);
 * - `createGuestObservationJournal` + `appendKernelSnapshot`
 *   (services/mission/simulation/observation-journal): the canonical
 *   source-aware journal with the fixture receipt clock;
 * - `buildEvidenceCapture` / `evaluateCapture`
 *   (services/mission/evidence-adapter): the merged, review-hardened
 *   evidence adapter (clock mapping, record integrity, metric rules);
 * - `POLICY_SEA_OBSTRUCTION_1` + `verifyEvidence`
 *   (services/verifier): Omar's verifier, UNCHANGED.
 *
 * Pure and stateless: everything is recomputed from (seed, operations); the
 * same body yields a byte-identical response. Read-only: no mission
 * lifecycle event, wallet authorization, verifier signature, chain
 * transaction or payout is produced — the response carries explicit labels
 * instead (`DEMO EVIDENCE — NOT PAYMENT AUTHORIZATION`).
 *
 * Truth rules enforced here: the sonar verdict covers EXACTLY the captured
 * window (the most recent ≤ EVIDENCE_WINDOW_SNAPSHOTS accepted snapshots)
 * and the response always includes the kernel's own coverage counters — a
 * windowed acceptance is never presented as a completed obstruction survey
 * (the flagship policy zone / route alignment is owned by Agent A). Optical
 * `visibility_m` evidence is UNAVAILABLE by default: the repository ships
 * no visibility calibration and this endpoint accepts none.
 */

import type { DemoSnapshot } from "../../../../services/simulation/demo/kernel-adapter.d.mts";
import {
  buildEvidenceCapture,
  evaluateCapture,
  makeEvidenceClockMapping,
  type EvidenceCapture,
  type EvidenceClockMapping,
  type EvidenceIdentity,
} from "../../../../services/mission/evidence-adapter";
import { POLICY_SEA_OBSTRUCTION_1 } from "../../../../services/verifier/src/policy";
import { FIXTURE_EPOCH_BASE_MS } from "@vorqyn/contracts";
import { executeDemoSimulation } from "@/lib/demo-simulation/execute";
import { DemoKernelRejection, type DemoOperation } from "@/lib/demo-simulation/contract";
import {
  appendKernelSnapshot,
  createGuestObservationJournal,
  type ObservationJournal,
} from "../../../../services/mission/simulation/observation-journal";
import { guestMissionIdForSeed } from "@/lib/simulation-journal/trace-contract";
import {
  DEMO_EVIDENCE_NOTICE,
  DEMO_IDENTITY_BINDING,
  EVIDENCE_DECISION_OFFSET_MS,
  EVIDENCE_RESPONSE_SCHEMA,
  EVIDENCE_WINDOW_SNAPSHOTS,
  type DemoEvidenceResponse,
  type EvaluatedModalityEvidence,
  type EvidencePolicyView,
  type ModalityEvidence,
  type ObservedSensorMeasurement,
} from "./contract";


const round3 = (value: number): number => Math.round(value * 1000) / 1000;

const distance2d = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

/** The bounded evidence window: the most recent accepted journal records. */
export function evidenceWindow(journal: ObservationJournal): ObservationJournal["records"] {
  const start = Math.max(0, journal.records.length - EVIDENCE_WINDOW_SNAPSHOTS);
  return journal.records.slice(start);
}

/**
 * Derive the evidence journey from an ALREADY-BUILT journal. Exposed as its
 * own function so tests can prove the record-integrity defense at this
 * layer (a tampered record can only arrive here by violating the journal —
 * the adapter rejects it anyway). `records` defaults to the journal's own
 * accepted records.
 */
export function deriveDemoEvidenceFromJournal(
  journal: ObservationJournal,
  seed: number,
  records: ObservationJournal["records"] = journal.records,
): DemoEvidenceResponse {
  const missionId = journal.missionId;
  const window = evidenceWindowOf(records);
  const mapping = makeEvidenceClockMapping({
    captureEpochBaseMs: FIXTURE_EPOCH_BASE_MS,
    seed,
    scenarioId: "PORT-001",
  });
  const clockMapping = mappingOk(mapping);

  const sonar = evaluateModality(journal, "sonar", seed, missionId, clockMapping, window.records);
  // Optical is UNAVAILABLE by construction: this endpoint accepts no
  // calibration, and the repository ships none (the adapter's structured
  // block is the honest answer, surfaced verbatim).
  const optical = opticalOutcome(journal, seed, missionId, clockMapping, window.records);

  const lastWindowRecord = window.records[window.records.length - 1];
  const rovSonar = lastWindowRecord === undefined ? undefined : findSensor(lastWindowRecord.snapshot, "rov-01", "sonar");
  const coverage =
    rovSonar === undefined
      ? { modelCellsVisited: 0, modelCellsTotal: 0, coverage01: 0 }
      : {
          modelCellsVisited: rovSonar.coverage.modelCellsVisited,
          modelCellsTotal: rovSonar.coverage.modelCellsTotal,
          coverage01: rovSonar.coverage.coverage01,
        };
  const obstructionSurveyComplete = coverage.modelCellsTotal > 0 && coverage.modelCellsVisited >= coverage.modelCellsTotal;

  return {
    schema: EVIDENCE_RESPONSE_SCHEMA,
    scenarioId: "PORT-001",
    seed,
    missionId,
    sourceKind: "SYNTHETIC_SIM",
    frameId: window.firstSnapshot?.provenance.frameId ?? "ENU_PORT-001_LOCAL",
    positionUnits: window.firstSnapshot?.provenance.positionUnits ?? "m",
    stepMs: window.firstSnapshot?.appliedStepMs ?? 500,
    labels: {
      sourceKind: "SYNTHETIC_SIM",
      evidenceNotice: DEMO_EVIDENCE_NOTICE,
      measurementSemantics: {
        simulatorMeasurements:
          "kernel-measured fixture-model outputs on synthetic robots (SYNTHETIC_SIM) — real code paths, no physical hardware",
        testCalibration:
          "none in this response — optical visibility in metres stays unavailable without a documented, source-backed calibration; no test calibration is shipped or accepted here",
        genuinePhysicalMeasurements: "none — this demo contains no genuine physical sensor measurements",
      },
    },
    clockDomains: {
      simulator: "kernel simulatorTimeMs (fixed 500ms steps, integer)",
      receipt: "fixture-epoch-base+ordinal (not UTC, not simulator time)",
      capture: "fixture epoch base + source (anchored mapping vorqyn.evidence-clock-mapping/1; raw kernel time preserved per observation)",
      decision: `capture domain: capture time + ${EVIDENCE_DECISION_OFFSET_MS} ms (deterministic)`,
      chain: null,
    },
    observation: {
      recordsAccepted: journal.records.length,
      windowReturned: {
        fromSequence: window.firstSnapshot?.sequence ?? 0,
        toSequence: lastWindowRecord?.snapshot.sequence ?? 0,
        snapshots: window.records.length,
      },
      exclusionsByCode: countByCode(sonar.exclusions, optical.exclusions),
      sensorsObserved: observedSensors(window.records),
    },
    evidence: {
      sonar: sonar.outcome,
      optical: optical.outcome,
    },
    interpretation: {
      obstructionSurveyComplete,
      note: obstructionSurveyComplete
        ? "the kernel's own sonar coverage counters show the obstruction grid fully visited within this trace"
        : "the sonar verdict covers EXACTLY the captured window, not the full obstruction survey: the kernel's own coverage counters above show how much of the obstruction grid was actually visited, and the shipped policy zone (centre (0,0), r=80 m) only overlaps the survey route's start — policy/route alignment is a separate owner decision",
    },
    authorityBoundary: {
      missionLifecycleEvent: false,
      walletAuthorization: false,
      verifierAttestationSignature: false,
      chainTransaction: false,
      payoutAuthorization: false,
      note: DEMO_EVIDENCE_NOTICE,
    },
  };
}

/**
 * Full journey from (seed, operations): run the shared kernel transport,
 * derive the canonical journal, and render the evidence response. Throws
 * DemoKernelRejection for kernel-rejected operations (the route maps to
 * HTTP 422), exactly like the other guest endpoints.
 */
export function deriveDemoEvidence(input: { seed: number; operations: DemoOperation[] }): DemoEvidenceResponse {
  const { seed } = input;
  const execution = executeDemoSimulation({ seed, operations: input.operations });
  const missionId = guestMissionIdForSeed(seed);
  const created = createGuestObservationJournal({
    missionId,
    seed,
    maxRecords: Math.max(1, execution.snapshots.length),
  });
  if (!created.ok) {
    throw new DemoKernelRejection("validation_error", created.error.message, -1);
  }
  let journal = created.value;
  for (const snapshot of execution.snapshots) {
    const result = appendKernelSnapshot(journal, snapshot);
    if (result.ok) {
      journal = result.journal;
    } else {
      throw new DemoKernelRejection(result.error.code, result.error.message, snapshot.sequence);
    }
  }
  return deriveDemoEvidenceFromJournal(journal, seed);
}

// ---------------------------------------------------------------------------
// Modality outcomes
// ---------------------------------------------------------------------------

interface ModalityWork {
  readonly outcome: ModalityEvidence;
  readonly exclusions: readonly { readonly code: string }[];
}

function evaluateModality(
  journal: ObservationJournal,
  modality: "sonar" | "optical",
  seed: number,
  missionId: string,
  clockMapping: EvidenceClockMapping,
  records: ObservationJournal["records"],
): ModalityWork {
  if (records.length === 0) {
    return {
      outcome: { status: "capture_failed", modality, code: "no_records", message: "the requested trace produced no accepted observations" },
      exclusions: [],
    };
  }
  const capture = buildEvidenceCapture({ journal, modality, clockMapping, records });
  if (!capture.ok) {
    return { outcome: { status: "capture_failed", modality, code: capture.error.code, message: capture.error.message }, exclusions: [] };
  }
  const identity = identityFor(modality, missionId, capture.value);
  // The merged adapter's own integration helper: prepareSubmission →
  // makeEvidenceSubmission → verifyEvidence, plus the decision-clock domain
  // guard. The verifier's rules are unchanged and byte-for-byte authoritative.
  const outcome = evaluateCapture(capture.value, identity.evidenceIdentity, POLICY_SEA_OBSTRUCTION_1, {
    expectedMissionId: missionId,
    expectedTaskId: DEMO_IDENTITY_BINDING.taskId,
    currentAssignmentVersion: DEMO_IDENTITY_BINDING.assignmentVersion,
    expectedOperatorId: DEMO_IDENTITY_BINDING[modality === "sonar" ? "sonarOperatorId" : "opticalOperatorId"],
    activePolicyId: POLICY_SEA_OBSTRUCTION_1.policyId,
    nowMs: capture.value.window.capturedAtMs + EVIDENCE_DECISION_OFFSET_MS,
  });
  if (!outcome.ok) {
    return { outcome: { status: "capture_failed", modality, code: outcome.error.code, message: outcome.error.message }, exclusions: capture.value.excluded };
  }
  const zone = POLICY_SEA_OBSTRUCTION_1.zone;
  return {
    outcome: {
      status: "evaluated",
      modality,
      captureId: captureIdFor(modality, seed, capture.value),
      evidenceId: identity.evidenceIdentity.evidenceId,
      digest: outcome.value.digest,
      sampleRefs: outcome.value.sampleRefs,
      window: {
        fromSequence: capture.value.window.firstSequence,
        toSequence: capture.value.window.lastSequence,
        capturedAtMs: capture.value.window.capturedAtMs,
        sourceClockRaw: {
          firstSourceSimulatorTimeMs: capture.value.window.firstSourceSimulatorTimeMs,
          lastSourceSimulatorTimeMs: capture.value.window.lastSourceSimulatorTimeMs,
        },
      },
      identity: identity.view,
      policy: policyView(POLICY_SEA_OBSTRUCTION_1),
      zoneChecks: capture.value.samples.map((sample) => {
        const d = distance2d(sample.position.x, sample.position.y, zone.centerX, zone.centerY);
        return { sequence: sample.sequence, distanceM: round3(d), radiusM: zone.radiusMetres, inside: d <= zone.radiusMetres };
      }),
      coverage: coverageOf(journal, capture.value),
      verdict: {
        accepted: outcome.value.verdict.accepted,
        reasons: outcome.value.verdict.reasons,
        verifierId: outcome.value.verdict.verifierId,
        decidedAtMs: outcome.value.verdict.decidedAtMs,
      },
    },
    exclusions: capture.value.excluded,
  };
}

function opticalOutcome(
  journal: ObservationJournal,
  seed: number,
  missionId: string,
  clockMapping: EvidenceClockMapping,
  records: ObservationJournal["records"],
): ModalityWork {
  const capture = buildEvidenceCapture({ journal, modality: "optical", clockMapping, records, robotIds: ["rov-01"] });
  if (!capture.ok && capture.error.code === "optical_visibility_unsupported") {
    const message = capture.error.message.length > 300 ? `${capture.error.message.slice(0, 300)}…` : capture.error.message;
    return { outcome: { status: "unavailable", modality: "optical", code: capture.error.code, message }, exclusions: [] };
  }
  if (!capture.ok) {
    return { outcome: { status: "capture_failed", modality: "optical", code: capture.error.code, message: capture.error.message }, exclusions: [] };
  }
  // Unreachable today (no calibration exists), kept honest for the day a
  // real calibration is merged: the optical outcome flows through the same
  // evaluated path as sonar.
  const evaluated = evaluateModality(journal, "optical", seed, missionId, clockMapping, records);
  return evaluated;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mappingOk(mapping: ReturnType<typeof makeEvidenceClockMapping>): EvidenceClockMapping {
  if (!mapping.ok) throw new DemoKernelRejection("validation_error", mapping.error.message, -1);
  return mapping.value;
}

function evidenceWindowOf(records: ObservationJournal["records"]): {
  readonly records: ObservationJournal["records"];
  readonly firstSnapshot: DemoSnapshot | undefined;
} {
  const start = Math.max(0, records.length - EVIDENCE_WINDOW_SNAPSHOTS);
  const window = records.slice(start);
  return { records: window, firstSnapshot: window[0]?.snapshot };
}

function identityFor(modality: "sonar" | "optical", missionId: string, capture: EvidenceCapture): {
  readonly evidenceIdentity: EvidenceIdentity;
  readonly view: EvaluatedModalityEvidence["identity"];
} {
  const operatorId = modality === "sonar" ? DEMO_IDENTITY_BINDING.sonarOperatorId : DEMO_IDENTITY_BINDING.opticalOperatorId;
  const lastSequence = capture.window.lastSequence;
  const evidenceId = `evg-guest-${capture.seed}-${modality}-${lastSequence}`;
  return {
    evidenceIdentity: {
      evidenceId,
      taskId: DEMO_IDENTITY_BINDING.taskId,
      assignmentVersion: DEMO_IDENTITY_BINDING.assignmentVersion,
      operatorId,
      sensor: modality,
    },
    view: {
      missionId,
      taskId: DEMO_IDENTITY_BINDING.taskId,
      operatorId,
      assignmentVersion: DEMO_IDENTITY_BINDING.assignmentVersion,
      note: DEMO_IDENTITY_BINDING.note,
    },
  };
}

function captureIdFor(modality: "sonar" | "optical", seed: number, capture: EvidenceCapture): string {
  return `evc-${modality}-${seed}-${capture.window.lastSequence}`;
}

function policyView(policy: typeof POLICY_SEA_OBSTRUCTION_1): EvidencePolicyView {
  const sonarRule = policy.sensors.find((rule) => rule.sensorId === "sonar");
  const opticalRule = policy.sensors.find((rule) => rule.sensorId === "optical");
  return {
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    zone: { ...policy.zone },
    minSamples: policy.minSamples,
    maxSourceAgeMs: policy.maxSourceAgeMs,
    maxCaptureAgeMs: policy.maxCaptureAgeMs,
    maxMissingSamples: policy.maxMissingSamples,
    sonarBackingMetricKind: sonarRule?.backingMetricKind ?? "sonar_ping",
    opticalRequiresMetric: { kind: opticalRule?.requiresMetric?.kind ?? "visibility_m", minMetres: opticalRule?.requiresMetric?.minMetres ?? 1.5 },
  };
}

function coverageOf(journal: ObservationJournal, capture: EvidenceCapture): EvaluatedModalityEvidence["coverage"] {
  const last = capture.observations[capture.observations.length - 1];
  if (last === undefined) return { modelCellsVisited: 0, modelCellsTotal: 0, coverage01: 0 };
  const record = journal.records.find((entry) => entry.snapshot.sequence === last.sequence);
  const rov = record?.snapshot.robots.find((robot) => robot.robotId === last.robotId);
  const sensor = rov?.sensors.find((candidate) => candidate.sensorId === last.sensorId);
  if (sensor === undefined) return { modelCellsVisited: 0, modelCellsTotal: 0, coverage01: 0 };
  return {
    modelCellsVisited: sensor.coverage.modelCellsVisited,
    modelCellsTotal: sensor.coverage.modelCellsTotal,
    coverage01: sensor.coverage.coverage01,
  };
}

function findSensor(snapshot: DemoSnapshot, robotId: string, kind: string) {
  return snapshot.robots.find((robot) => robot.robotId === robotId)?.sensors.find((sensor) => sensor.kind === kind);
}

function observedSensors(records: ObservationJournal["records"]): ObservedSensorMeasurement[] {
  const observed: ObservedSensorMeasurement[] = [];
  for (const record of records) {
    for (const robot of record.snapshot.robots) {
      for (const sensor of robot.sensors) {
        observed.push({
          sequence: record.snapshot.sequence,
          robotId: robot.robotId,
          sensorId: sensor.sensorId,
          kind: sensor.kind,
          quality01: sensor.measured === null ? null : sensor.measured.quality01,
          qualityUnits: sensor.measured === null ? null : sensor.measured.qualityUnits,
          opticalVisibilityFactorApplied: sensor.measured === null ? null : sensor.measured.opticalVisibilityFactorApplied,
          coverage01: sensor.coverage.coverage01,
        });
      }
    }
  }
  return observed;
}

function countByCode(...lists: readonly (readonly { readonly code: string }[])[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const list of lists) {
    for (const entry of list) {
      counts[entry.code] = (counts[entry.code] ?? 0) + 1;
    }
  }
  return counts;
}
