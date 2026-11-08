/**
 * Evidence capture tests (issue #9 slice) — real kernel observations only.
 *
 * Every capture here is built from actual `createScenarioKernel` runs
 * through the accepted guest observation journal, exactly as the future
 * orchestrator would. Pins: preserved provenance, verbatim sonar
 * measurements under `sonar_ping`, the structured optical
 * `optical_visibility_unsupported` block, explicit exclusions for
 * missing modalities / pauses / disconnects, and all stream defenses.
 */

import { describe, expect, it } from "vitest";
import { FIXTURE_EPOCH_BASE_MS } from "@vorqyn/contracts";
import {
  buildEvidenceCapture,
  makeEvidenceClockMapping,
  type EvidenceClockMapping,
} from "../../../../services/mission/evidence-adapter";
import { journalFromSnapshots, runKernel, DEMO_MAPPING, DEMO_SEED, MISSION_ID, TEST_CALIBRATION } from "./harness";

const OTHER_MAPPING: EvidenceClockMapping = (() => {
  const mapping = makeEvidenceClockMapping({ captureEpochBaseMs: FIXTURE_EPOCH_BASE_MS, seed: 42, scenarioId: "PORT-001" });
  if (!mapping.ok) throw new Error("unreachable");
  return mapping.value;
})();

describe("evidence capture — sonar from real kernel observations", () => {
  it("builds a contract-valid, provenance-preserving sonar capture from a clean survey window", () => {
    const { snapshots } = runKernel((k) => {
      k.step(6); // ROV still inside the flagship policy zone near its route start
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;

    const value = capture.value;
    expect(value.captureSchema).toBe("vorqyn.evidence-capture/1");
    expect(value.modality).toBe("sonar");
    expect(value.missionId).toBe(MISSION_ID);
    expect(value.seed).toBe(DEMO_SEED);
    expect(value.scenarioId).toBe("PORT-001");
    // Provenance preserved from the kernel's own snapshot provenance.
    expect(value.provenance.sourceKind).toBe("SYNTHETIC_SIM");
    expect(value.provenance.frameId).toBe("ENU_PORT-001_LOCAL");
    expect(value.provenance.positionUnits).toBe("m");
    expect(value.provenance.simulatorClock).toBe("fixed-step-simulator-time"); // kernel's own clock label, preserved
    expect(value.clockMapping).toEqual(DEMO_MAPPING);
    expect(value.calibration).toBeNull();

    // Only the ROV carries sonar; the drone/rover exclusions are explicit.
    expect(value.samples.every((sample) => sample.robotId === "rov-01")).toBe(true);
    expect(value.samples).toHaveLength(6);
    expect(value.samples.every((sample) => sample.qualityMetric?.kind === "sonar_ping")).toBe(true);
    expect(value.samples.every((sample) => sample.sourceKind === "SYNTHETIC_SIM")).toBe(true);
    expect(value.samples.every((sample) => sample.frameId === "ENU_PORT-001_LOCAL")).toBe(true);
    expect(value.samples.every((sample) => sample.units === "metres")).toBe(true);
    // Mapped capture-clock source times: base + the kernel's relative times.
    expect(value.samples.map((sample) => sample.sourceTimestampMs)).toEqual([500, 1000, 1500, 2000, 2500, 3000].map((t) => FIXTURE_EPOCH_BASE_MS + t));
    // Receipt clock preserved from the journal's own deterministic domain.
    expect(value.samples.every((sample) => sample.receivedAtMs === FIXTURE_EPOCH_BASE_MS + sample.sequence - 1)).toBe(true);

    // Observation audit matches the kernel log byte-for-byte on measurements.
    const rovSnapshot0 = snapshots[0];
    expect(rovSnapshot0).toBeDefined();
    if (rovSnapshot0 === undefined) return;
    const kernelSonar = rovSnapshot0.robots.find((r) => r.robotId === "rov-01")?.sensors.find((s) => s.kind === "sonar");
    expect(kernelSonar?.measured).not.toBeNull();
    const observation0 = value.observations[0];
    expect(observation0).toBeDefined();
    if (kernelSonar?.measured === null || kernelSonar === undefined || observation0 === undefined) return;
    expect(observation0.sensorId).toBe("rov-01-sonar");
    expect(observation0.sourceSimulatorTimeMs).toBe(rovSnapshot0.simulatorTimeMs);
    expect(observation0.quality01).toBe(kernelSonar.measured.quality01);
    expect(observation0.qualityUnits).toBe("unitless_0_to_1_fixture_model");
    expect(observation0.opticalVisibilityFactorApplied).toBeNull();
    expect(observation0.metric).toEqual({ kind: "sonar_ping", value: kernelSonar.measured.quality01 });

    // Explicit exclusions: drone and rover have no sonar sensor (6 records x 2 robots).
    expect(value.excluded).toHaveLength(12);
    expect(value.excluded.every((exclusion) => exclusion.code === "sensor_modality_missing")).toBe(true);

    // Window on both clocks.
    expect(value.window).toEqual({
      firstSequence: 1,
      lastSequence: 6,
      firstSourceSimulatorTimeMs: 500,
      lastSourceSimulatorTimeMs: 3000,
      capturedAtMs: FIXTURE_EPOCH_BASE_MS + 3000,
    });
  });

  it("never manufactures sonar evidence for robots without a sonar sensor", () => {
    const { snapshots } = runKernel((k) => {
      k.step(2);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    // Every sample's metric came from a real sonar observation (rov-01 only),
    // and no sample carries any optical-derived value.
    for (const observation of capture.value.observations) {
      expect(observation.sensorId).toBe("rov-01-sonar");
      expect(observation.modality).toBe("sonar");
    }
    const robotIds = new Set(capture.value.samples.map((sample) => sample.robotId));
    expect(robotIds).toEqual(new Set(["rov-01"]));
  });
});

describe("evidence capture — optical visibility requires a documented calibration", () => {
  it("returns the structured unsupported result without a calibration (never quality01-as-metres)", () => {
    const { snapshots } = runKernel((k) => {
      k.step(3);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "optical", clockMapping: DEMO_MAPPING });
    expect(capture.ok).toBe(false);
    if (capture.ok) return;
    expect(capture.error.code).toBe("optical_visibility_unsupported");
    expect(capture.error.message).toMatch(/unitless_0_to_1_fixture_model/);
    expect(capture.error.message).toMatch(/VisibilityCalibration/);
  });

  it("produces visibility_m samples and records the calibration verbatim when calibrated", () => {
    const { snapshots } = runKernel((k) => {
      k.step(3);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({
      journal,
      modality: "optical",
      clockMapping: DEMO_MAPPING,
      calibration: TEST_CALIBRATION,
    });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    const value = capture.value;
    expect(value.modality).toBe("optical");
    expect(value.samples.every((sample) => sample.qualityMetric?.kind === "visibility_m")).toBe(true);
    expect(value.calibration).toEqual({
      schema: "vorqyn.visibility-calibration/1",
      calibrationId: "cal-test-fixture-1",
      version: 1,
      sourceRef: TEST_CALIBRATION.sourceRef,
      derivation: TEST_CALIBRATION.derivation,
      inputKind: "unitless_quality01",
      points: TEST_CALIBRATION.points,
    });
    // Clean ROV optical baseline 0.71 +- noise maps to ~2.4 m on the test scale.
    const firstObservation = value.observations.find((observation) => observation.robotId === "rov-01");
    const rovSample = value.samples.find((sample) => sample.robotId === "rov-01");
    expect(firstObservation).toBeDefined();
    expect(rovSample).toBeDefined();
    if (firstObservation === undefined || rovSample === undefined) return;
    expect(rovSample.qualityMetric?.value).toBeCloseTo(firstObservation.quality01 * 3.4, 6);
    expect(rovSample.quality.status).toBe("ok");
  });

  it("rejects a calibration supplied for sonar evidence", () => {
    const { snapshots } = runKernel((k) => {
      k.step(2);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, calibration: TEST_CALIBRATION });
    expect(capture.ok).toBe(false);
    if (capture.ok) return;
    expect(capture.error.code).toBe("calibration_not_applicable");
  });

  it("rejects an invalid calibration before any evidence is produced", () => {
    const { snapshots } = runKernel((k) => {
      k.step(2);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const invalid = { ...TEST_CALIBRATION, points: [{ quality01: 0.4, visibilityM: 1 }, { quality01: 0.2, visibilityM: 2 }] };
    const capture = buildEvidenceCapture({ journal, modality: "optical", clockMapping: DEMO_MAPPING, calibration: invalid });
    expect(capture.ok).toBe(false);
  });
});

describe("evidence capture — accepted-record integrity (review P1-B)", () => {
  it("rejects a cloned record whose sonar quality was tampered", () => {
    const { snapshots } = runKernel((k) => {
      k.step(3);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const tampered = structuredClone(journal.records) as Array<typeof journal.records[number]>;
    const first = tampered[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const sonar = first.snapshot.robots.find((robot) => robot.robotId === "rov-01")?.sensors.find((sensor) => sensor.kind === "sonar");
    expect(sonar?.measured).not.toBeNull();
    if (sonar === undefined || sonar.measured === null) return;
    (sonar.measured as { quality01: number }).quality01 = 0.99;
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, records: tampered });
    expect(capture.ok).toBe(false);
    if (capture.ok) return;
    expect(capture.error.code).toBe("record_content_mismatch");
  });

  it("rejects a cloned record whose pose was tampered", () => {
    const { snapshots } = runKernel((k) => {
      k.step(3);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const tampered = structuredClone(journal.records) as Array<typeof journal.records[number]>;
    const first = tampered[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const drone = first.snapshot.robots.find((robot) => robot.robotId === "drone-01");
    expect(drone).toBeDefined();
    if (drone === undefined) return;
    drone.pose.x += 25;
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, records: tampered });
    expect(capture.ok).toBe(false);
    if (capture.ok) return;
    expect(capture.error.code).toBe("record_content_mismatch");
  });

  it("rejects records that are not members of the journal (foreign recordOrdinal)", () => {
    const { snapshots } = runKernel((k) => {
      k.step(3);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const foreign = structuredClone(journal.records) as Array<typeof journal.records[number]>;
    const first = foreign[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    (first as { recordOrdinal: number }).recordOrdinal = 999;
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, records: foreign });
    expect(capture.ok).toBe(false);
    if (capture.ok) return;
    expect(capture.error.code).toBe("record_not_in_journal");
  });

  it("rejects a record whose missionId or seed disagrees with the journal", () => {
    const { snapshots } = runKernel((k) => {
      k.step(3);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const relabeled = structuredClone(journal.records) as Array<typeof journal.records[number]>;
    const first = relabeled[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    (first as { missionId: string }).missionId = "harbor-002";
    const missionMismatch = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, records: relabeled });
    expect(missionMismatch.ok).toBe(false);
    if (!missionMismatch.ok) expect(missionMismatch.error.code).toBe("record_content_mismatch");

    const reseeded = structuredClone(journal.records) as Array<typeof journal.records[number]>;
    const firstReseeded = reseeded[0];
    if (firstReseeded === undefined) return;
    (firstReseeded as { seed: number }).seed = journal.seed + 1;
    const seedMismatch = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, records: reseeded });
    expect(seedMismatch.ok).toBe(false);
    if (!seedMismatch.ok) expect(seedMismatch.error.code).toBe("record_content_mismatch");
  });

  it("accepts an exact rehydrated copy of accepted records (JSON round-trip)", () => {
    const { snapshots } = runKernel((k) => {
      k.step(3);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const rehydrated = JSON.parse(JSON.stringify(journal.records));
    const fromRehydrated = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, records: rehydrated });
    const fromJournal = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    expect(fromRehydrated.ok).toBe(true);
    expect(fromJournal.ok).toBe(true);
    if (!fromRehydrated.ok || !fromJournal.ok) return;
    expect(fromRehydrated.value).toEqual(fromJournal.value);
  });
});

describe("evidence capture — stream and record defenses", () => {
  it("rejects a clock mapping bound to a different stream", () => {
    const { snapshots } = runKernel((k) => {
      k.step(2);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: OTHER_MAPPING });
    expect(capture.ok).toBe(false);
    if (capture.ok) return;
    expect(capture.error.code).toBe("mapping_stream_mismatch");
  });

  it("rejects duplicate/regressed record sequences", () => {
    const { snapshots } = runKernel((k) => {
      k.step(2);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const firstRecord = journal.records[0];
    const secondRecord = journal.records[1];
    expect(firstRecord).toBeDefined();
    expect(secondRecord).toBeDefined();
    if (firstRecord === undefined || secondRecord === undefined) return;
    const duplicated = [firstRecord, firstRecord, secondRecord];
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, records: duplicated });
    expect(capture.ok).toBe(false);
    if (capture.ok) return;
    expect(capture.error.code).toBe("duplicate_or_regressed_sequence");
  });

  it("rejects records whose provenance claims a foreign source kind (false LIVE_SITL at the source)", () => {
    const { snapshots } = runKernel((k) => {
      k.step(2);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const tampered = structuredClone(journal.records) as Array<typeof journal.records[number]>;
    const first = tampered[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    (first.snapshot.provenance as { sourceKind: string }).sourceKind = "LIVE_SITL";
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, records: tampered });
    expect(capture.ok).toBe(false);
    if (capture.ok) return;
    // Layered defense: any altered byte (including provenance) is caught
    // FIRST by accepted-record integrity (review P1-B); the provenance rule
    // itself remains as defense-in-depth behind it (e.g. for rehydrated
    // journal stores).
    expect(capture.error.code).toBe("record_content_mismatch");
  });

  it("records paused snapshots as exclusions, never as evidence", () => {
    const { snapshots } = runKernel((k) => {
      k.step(2);
      k.issueCommand({ type: "pause", idempotencyKey: "capture-test-pause" });
      k.step(2);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const pausedOnly = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, records: journal.records.slice(2) });
    expect(pausedOnly.ok).toBe(false);
    if (pausedOnly.ok) return;
    expect(pausedOnly.error.code).toBe("no_fresh_observations");

    const mixed = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    const pausedExclusions = mixed.value.excluded.filter((exclusion) => exclusion.code === "kernel_paused");
    expect(pausedExclusions).toHaveLength(2); // two paused snapshots
    expect(pausedExclusions.every((exclusion) => exclusion.robotId === null)).toBe(true);
    // Only the two running snapshots contribute sonar samples.
    expect(mixed.value.samples.map((sample) => sample.sequence).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("records disconnected robots as exclusions and never fills their gap", () => {
    const { snapshots } = runKernel((k) => {
      k.step(2);
      k.issueCommand({ type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "capture-test-disconnect" });
      k.step(3);
      k.issueCommand({ type: "reconnectTelemetry", robotId: "rov-01", idempotencyKey: "capture-test-reconnect" });
      k.step(2);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING });
    expect(capture.ok).toBe(true);
    if (!capture.ok) return;
    const linkExclusions = capture.value.excluded.filter((exclusion) => exclusion.code === "link_disconnected");
    expect(linkExclusions).toHaveLength(3);
    expect(linkExclusions.every((exclusion) => exclusion.robotId === "rov-01")).toBe(true);
    // The frozen-pose window produces NO samples: sequences 3,4,5 are absent.
    const rovSequences = capture.value.samples.map((sample) => sample.sequence).sort((a, b) => a - b);
    expect(rovSequences).toEqual([1, 2, 6, 7]);
  });

  it("fails with no_fresh_observations when a window has zero fresh modality observations", () => {
    const { snapshots } = runKernel((k) => {
      k.step(1);
      k.issueCommand({ type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "capture-test-disconnect-2" });
      k.step(2);
    });
    const journal = journalFromSnapshots(MISSION_ID, snapshots);
    const capture = buildEvidenceCapture({ journal, modality: "sonar", clockMapping: DEMO_MAPPING, records: journal.records.slice(1) });
    expect(capture.ok).toBe(false);
    if (capture.ok) return;
    expect(capture.error.code).toBe("no_fresh_observations");
  });
});
