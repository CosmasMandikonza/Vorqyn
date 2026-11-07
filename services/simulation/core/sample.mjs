/**
 * VORQYN lane-2 simulation kernel — deterministic sample run generator.
 *
 * Scope: VQ-08-PREP (#20). Produces the committed deterministic sample
 * output used as a golden fixture (fixtures/sample-run.json) and as an
 * executable demonstration of the kernel's semantics:
 * clean survey → bounded optical-visibility fault (with an idempotent
 * duplicate attempt) → deterministic expiry → telemetry link loss with
 * honest stale labelling → pause/resume → typed rejection demos.
 *
 * Purity: buildSampleRun() is a pure function of the hardcoded demo seed.
 * The CLI entry prints JSON to stdout; it performs no I/O beyond the
 * console and consults no clock.
 *
 * Run: node services/simulation/core/sample.mjs
 * Regenerate the committed fixture:
 *   node services/simulation/core/sample.mjs > services/simulation/core/fixtures/sample-run.json
 */

import { pathToFileURL } from "node:url";
import process from "node:process";

import { createScenarioKernel } from "./kernel.mjs";
import { ROBOT_ROLES, SENSOR_KINDS } from "./scenario.mjs";

const DEMO_SEED = 20261107;

/**
 * Build the full deterministic sample document.
 * @returns {object} JSON-serializable sample run (see fixtures/sample-run.json)
 */
export function buildSampleRun() {
  const kernel = createScenarioKernel({ seed: DEMO_SEED });
  const commandOutcomes = [];

  const record = (label, outcome) => {
    commandOutcomes.push({ label, ok: outcome.ok, duplicate: outcome.duplicate === true, failure: outcome.failure ?? null, faultId: outcome.fault?.faultId ?? outcome.original?.result?.fault?.faultId ?? null });
  };

  // --- Phase A: clean three-role survey --------------------------------
  kernel.step(20); // simulatorTimeMs 500..10000

  // --- Phase B: bounded underwater optical-visibility fault ------------
  // Injected at simulatorTimeMs 10000, duration 9000 -> active while a
  // step starts before 19000; the step starting at 19000 is clean.
  record("injectOpticalVisibilityFault", kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: 9000,
    idempotencyKey: "sample-optical-fault-1",
  }));
  // Idempotency demo: the retried command resolves to the original record
  // and does NOT stack a second degradation.
  record("injectOpticalVisibilityFault (duplicate retry)", kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: 9000,
    idempotencyKey: "sample-optical-fault-1",
  }));
  kernel.step(18); // simulatorTimeMs 10500..19000 (faulted window)
  kernel.step(2); // simulatorTimeMs 19500..20000 (expired, clean again)

  // --- Phase C: telemetry link loss on the drone ------------------------
  const staleWindowStartSequence = kernel.getState().sequence;
  record("disconnectTelemetry drone-01", kernel.issueCommand({
    type: "disconnectTelemetry",
    robotId: "drone-01",
    idempotencyKey: "sample-drone-link-cut",
  }));
  kernel.step(4); // drone frozen + labelled link-disconnected
  record("reconnectTelemetry drone-01", kernel.issueCommand({
    type: "reconnectTelemetry",
    robotId: "drone-01",
    idempotencyKey: "sample-drone-link-fix",
  }));
  kernel.step(2); // drone fresh again, resuming from its frozen pose
  const staleWindow = {
    fromSequence: staleWindowStartSequence,
    toSequence: kernel.getState().sequence,
  };

  // --- Phase D: pause / resume ------------------------------------------
  record("pause", kernel.issueCommand({ type: "pause", idempotencyKey: "sample-pause" }));
  kernel.step(3); // frozen heartbeats, clock held
  record("resume", kernel.issueCommand({ type: "resume", idempotencyKey: "sample-resume" }));
  kernel.step(3);

  // --- Rejection demos ---------------------------------------------------
  record("fault on aerial drone (wrong role)", kernel.issueCommand({
    type: "injectOpticalVisibilityFault", robotId: "drone-01", severity: "severe", durationMs: 9000, idempotencyKey: "sample-reject-role",
  }));
  record("unknown robot", kernel.issueCommand({
    type: "disconnectTelemetry", robotId: "rov-99", idempotencyKey: "sample-reject-robot",
  }));
  record("unknown severity", kernel.issueCommand({
    type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "tidal", durationMs: 9000, idempotencyKey: "sample-reject-severity",
  }));
  record("out-of-bounds duration", kernel.issueCommand({
    type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 999999, idempotencyKey: "sample-reject-duration",
  }));
  record("resume while running", kernel.issueCommand({ type: "resume", idempotencyKey: "sample-reject-transition" }));
  record("forged provenance field", kernel.issueCommand({ type: "pause", idempotencyKey: "sample-reject-forge", sourceKind: "LIVE_SITL" }));

  // --- Derived document --------------------------------------------------
  const fullLog = kernel.getObservationLog();
  const observations = fullLog.map(compactSnapshot);
  const faultDelta = computeFaultDelta(fullLog);
  const state = kernel.getState();

  return {
    meta: {
      purpose: "VQ-08-PREP deterministic sample output (internal fixture, not a shared contract)",
      scenarioId: state.scenarioId,
      seed: state.seed,
      stepMs: state.stepMs,
      provenance: {
        sourceKind: "SYNTHETIC_SIM",
        frame: "ENU_PORT_LOCAL (+x east, +y north, +z up; metres; z=0 waterline datum)",
        clock: "simulatorTimeMs only — fixed 500ms integer steps; no wall, service or chain clock appears anywhere in this document",
      },
      honestyNotes: [
        "All values are synthetic fixture model outputs, not physical measurements.",
        "The optical-visibility fault changes measured quality01 values themselves (see faultDelta), not just a label.",
        "Stale and disconnected entries carry measured: null — frozen states are never dressed up as fresh readings.",
        "This kernel emits measurements only; evidence acceptance belongs to an external policy evaluator (VQ-10).",
      ],
    },
    commandOutcomes,
    staleWindow,
    faultDelta,
    finalState: {
      kernelState: state.kernelState,
      simulatorTimeMs: state.simulatorTimeMs,
      stepIndex: state.stepIndex,
      sequence: state.sequence,
      robots: state.robots.map((robot) => ({
        robotId: robot.robotId,
        role: robot.role,
        pose: robot.pose,
        linkState: robot.linkState,
        coverage01: latestCoverage(fullLog, robot.robotId),
      })),
    },
    observations,
  };
}

/** Compact, JSON-friendly observation row (fields documented in README). */
function compactSnapshot(snapshot) {
  const robots = {};
  for (const robot of snapshot.robots) {
    const sensors = {};
    for (const sensor of robot.sensors) {
      sensors[sensor.sensorId] = {
        q: sensor.measured === null ? null : sensor.measured.quality01,
        cov: sensor.coverage.coverage01,
        f: sensor.measured === null ? null : sensor.measured.opticalVisibilityFactorApplied,
      };
    }
    robots[robot.robotId] = {
      pose: [robot.pose.x, robot.pose.y, robot.pose.z],
      wp: robot.waypointIndex,
      link: robot.linkState,
      fresh: robot.fresh,
      staleness: robot.staleness,
      staleSince: robot.staleSinceSimMs,
      fault: robot.activeOpticalFault === null ? null : robot.activeOpticalFault.severity,
      sensors,
    };
  }
  return {
    seq: snapshot.sequence,
    tMs: snapshot.simulatorTimeMs,
    state: snapshot.kernelState,
    dMs: snapshot.appliedStepMs,
    robots,
  };
}

function computeFaultDelta(log) {
  const cleanOptical = [];
  const faultedOptical = [];
  const cleanSonar = [];
  const faultedSonar = [];
  for (const snapshot of log) {
    const rov = snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROV);
    const optical = rov.sensors.find((s) => s.kind === SENSOR_KINDS.OPTICAL);
    const sonar = rov.sensors.find((s) => s.kind === SENSOR_KINDS.SONAR);
    if (optical.measured !== null) {
      (optical.measured.opticalVisibilityFactorApplied === null ? cleanOptical : faultedOptical).push(optical.measured.quality01);
    }
    if (sonar.measured !== null) {
      const rovFaulted = optical.measured !== null && optical.measured.opticalVisibilityFactorApplied !== null;
      (rovFaulted ? faultedSonar : cleanSonar).push(sonar.measured.quality01);
    }
  }
  const mean = (arr) => (arr.length === 0 ? null : Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 1e6) / 1e6);
  const opticalCleanMean = mean(cleanOptical);
  const opticalFaultedMean = mean(faultedOptical);
  return {
    optical: {
      cleanSamples: cleanOptical.length,
      faultedSamples: faultedOptical.length,
      cleanMeanQuality01: opticalCleanMean,
      faultedMeanQuality01: opticalFaultedMean,
      meanDelta01: opticalCleanMean === null || opticalFaultedMean === null ? null : Math.round((opticalCleanMean - opticalFaultedMean) * 1e6) / 1e6,
    },
    sonar: {
      cleanSamples: cleanSonar.length,
      faultedSamples: faultedSonar.length,
      cleanMeanQuality01: mean(cleanSonar),
      faultedMeanQuality01: mean(faultedSonar),
    },
    interpretation:
      "Optical mean drops by the fixture factor (severe = 0.12); sonar stays at its own fixture baseline, confirming the fault is optical-modality-only and measured, not labelled.",
  };
}

function latestCoverage(log, robotId) {
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const robot = log[i].robots.find((r) => r.robotId === robotId);
    const sensor = robot.sensors[0];
    if (sensor.coverage.modelCellsTotal > 0) {
      return sensor.coverage.coverage01;
    }
  }
  return 0;
}

// --- CLI entry -----------------------------------------------------------

const invokedAsScript = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  console.log(JSON.stringify(buildSampleRun(), null, 2));
}
