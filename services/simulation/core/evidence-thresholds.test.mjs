/**
 * Evidence threshold tests — VQ-08-PREP (#20) mandatory adversarial cases:
 * - Optical samples below the demo quality threshold are detectable as
 *   insufficient by a threshold evaluation over the measured fields.
 * - A sonar capability/coverage does NOT automatically imply evidence
 *   acceptance: the same sonar measurement passes one policy threshold and
 *   fails a stricter one — acceptance depends on measurement + threshold,
 *   never on the capability flag.
 * - The kernel itself never accepts or rejects evidence: it emits no
 *   verdict fields at all. Policy authority stays external (VQ-10).
 *
 * The tiny evaluator below stands in for the future external policy
 * evaluator (docs/ARCHITECTURE.md §6). It lives in the TEST only; the
 * kernel has no policy code path.
 *
 * Run: node --test services/simulation/core/evidence-thresholds.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioKernel } from "./kernel.mjs";
import { DEMO_POLICY_THRESHOLDS, ROBOT_ROLES, SENSOR_KINDS } from "./scenario.mjs";

const SEED = 777654;

/** Test-only stand-in for the external evaluator: measurement vs threshold. */
function evaluateAgainstThreshold(measuredQuality01, threshold01) {
  return {
    accepted: measuredQuality01 >= threshold01,
    threshold01,
    measuredQuality01,
    ruleId: `fixture-quality-min-${threshold01}`,
  };
}

function collectSamples(kernel, role, sensorKind) {
  const out = [];
  for (const snapshot of kernel.getObservationLog()) {
    const robot = snapshot.robots.find((r) => r.role === role);
    const sensor = robot.sensors.find((s) => s.kind === sensorKind);
    if (sensor.measured !== null) {
      out.push({ simulatorTimeMs: snapshot.simulatorTimeMs, quality01: sensor.measured.quality01 });
    }
  }
  return out;
}

function runFaulted() {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(10); // clean baseline
  kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: 60000,
    idempotencyKey: "threshold-fault",
  });
  kernel.step(10); // fully inside the fault window
  return kernel;
}

test("faulted optical samples are detectable as insufficient against the demo threshold", () => {
  const kernel = runFaulted();
  const threshold = DEMO_POLICY_THRESHOLDS.opticalEvidenceQualityMin01;

  const baseline = collectSamples(kernel, ROBOT_ROLES.ROV, SENSOR_KINDS.OPTICAL).slice(0, 10);
  const faulted = collectSamples(kernel, ROBOT_ROLES.ROV, SENSOR_KINDS.OPTICAL).slice(10);

  for (const sample of baseline) {
    const verdict = evaluateAgainstThreshold(sample.quality01, threshold);
    assert.equal(verdict.accepted, true, `baseline sample ${sample.quality01} meets the demo threshold`);
  }
  for (const sample of faulted) {
    const verdict = evaluateAgainstThreshold(sample.quality01, threshold);
    assert.equal(verdict.accepted, false, `faulted sample ${sample.quality01} is insufficient`);
    assert.ok(sample.quality01 < 0.09, `faulted measurement genuinely degraded: ${sample.quality01}`);
  }
});

test("sonar capability does not imply acceptance: same measurement, two policies, two verdicts", () => {
  const kernel = runFaulted();
  const sonarSamples = collectSamples(kernel, ROBOT_ROLES.ROV, SENSOR_KINDS.SONAR).slice(10);
  assert.ok(sonarSamples.length >= 10);

  const mappingThreshold = DEMO_POLICY_THRESHOLDS.opticalEvidenceQualityMin01; // 0.5
  const structuralThreshold = DEMO_POLICY_THRESHOLDS.structuralSonarQualityMin01; // 0.8

  // The fixture sonar is a real capability: the ROV's sensor list carries it.
  const sonarFixture = kernel.config.robots.find((r) => r.role === ROBOT_ROLES.ROV).sensors.find((s) => s.kind === SENSOR_KINDS.SONAR);
  assert.equal(sonarFixture.kind, SENSOR_KINDS.SONAR, "the ROV carries a sonar capability");

  // ...yet against the STRICT structural policy its measured quality fails:
  for (const sample of sonarSamples) {
    const structural = evaluateAgainstThreshold(sample.quality01, structuralThreshold);
    assert.equal(structural.accepted, false, `sonar ${sample.quality01} fails the structural bar ${structuralThreshold}`);
    // ...and against the mapping policy the SAME measurements pass:
    const mapping = evaluateAgainstThreshold(sample.quality01, mappingThreshold);
    assert.equal(mapping.accepted, true, `sonar ${sample.quality01} meets the mapping bar ${mappingThreshold}`);
  }
  // Verdict divergence on identical measurements proves acceptance is a
  // function of measurement + threshold, NOT of capability presence.
});

test("sonar coverage grows under its own range-ring model, independently of optical", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(20);
  const optical = [];
  const sonar = [];
  for (const snapshot of kernel.getObservationLog()) {
    const rov = snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROV);
    optical.push(rov.sensors.find((s) => s.kind === SENSOR_KINDS.OPTICAL).coverage.modelCellsVisited);
    sonar.push(rov.sensors.find((s) => s.kind === SENSOR_KINDS.SONAR).coverage.modelCellsVisited);
  }
  // Both grow monotonically, but by different rules (in-cell vs range-ring):
  // the sonar ring visits at least as many cells once the ROV is on route.
  for (let i = 1; i < sonar.length; i += 1) {
    assert.ok(sonar[i] >= sonar[i - 1], "sonar coverage is monotonic");
    assert.ok(optical[i] >= optical[i - 1], "optical coverage is monotonic");
  }
  assert.ok(sonar[sonar.length - 1] >= optical[optical.length - 1], "range-ring sonar covers at least the in-cell optical set");
});

test("the kernel emits measurements only: no verdict or acceptance fields anywhere", () => {
  const kernel = runFaulted();
  const forbiddenKeys = /^(accepted|verdict|sufficient|policyDecision|evidenceAccepted|payout|reward|missionEvent|chainEvent)/;
  const json = JSON.stringify([
    ...kernel.getObservationLog(),
    kernel.getState(),
    ...kernel.getCommandAuditLog(),
  ]);
  // Recursively collect every object key in the emitted JSON.
  const keys = new Set();
  JSON.parse(json, (k, v) => {
    keys.add(k);
    return v;
  });
  for (const key of keys) {
    assert.ok(!forbiddenKeys.test(key), `no verdict-like key in kernel output: ${key}`);
  }
});
