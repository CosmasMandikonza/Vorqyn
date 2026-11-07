/**
 * Fault tests — VQ-08-PREP (#20) mandatory adversarial cases:
 * - Fault injection changes MEASURED optical quality, not merely a status
 *   label; the degradation is far larger than the fixture noise band.
 * - Sonar measurements are unaffected: separate modality, separate model.
 * - Replaying the same seed reproduces the same degradation exactly.
 * - Duplicate fault commands are idempotent (no double effect).
 * - Bounded fault duration expires deterministically; the underwater role
 *   constraint is enforced; clearing is idempotent.
 *
 * Run: node --test services/simulation/core/fault.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioKernel, replayScenario } from "./kernel.mjs";
import { ROBOT_ROLES, SENSOR_KINDS, OPTICAL_VISIBILITY_FAULT } from "./scenario.mjs";

const SEED = 424242;

/** Steps the kernel, returning the rov-01 optical measurements per snapshot. */
function rovSeries(kernel, sensorKind) {
  const out = [];
  for (const snapshot of kernel.getObservationLog()) {
    const rov = snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROV);
    const sensor = rov.sensors.find((s) => s.kind === sensorKind);
    out.push({
      simulatorTimeMs: snapshot.simulatorTimeMs,
      quality01: sensor.measured === null ? null : sensor.measured.quality01,
      factorApplied: sensor.measured === null ? null : sensor.measured.opticalVisibilityFactorApplied,
      activeFault: rov.activeOpticalFault,
    });
  }
  return out;
}

function runFaultScenario({ severity = "severe", durationMs = 9000, key = "fault-key-1" } = {}) {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(10); // clean baseline period
  const injected = kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity,
    durationMs,
    idempotencyKey: key,
  });
  kernel.step(30); // spans the fault and its expiry
  return { kernel, injected };
}

test("fault injection degrades measured optical quality far beyond the noise band", () => {
  const { kernel } = runFaultScenario({});
  const series = rovSeries(kernel, SENSOR_KINDS.OPTICAL);

  const clean = series.filter((s) => s.factorApplied === null);
  const faulted = series.filter((s) => s.factorApplied !== null);

  assert.ok(clean.length >= 10, "has a clean baseline period");
  assert.ok(faulted.length >= 18, "has a faulted period");

  const baseline = { min: 0.71 - 0.02, max: 0.71 + 0.02 };
  // The fixture noise band keeps clean optical samples near baseline.
  for (const sample of clean) {
    assert.ok(sample.quality01 > baseline.min && sample.quality01 < baseline.max, `clean sample near baseline: ${sample.quality01}`);
  }
  // Faulted samples are pulled down by the fixture factor 0.12:
  // worst case (baseline + full noise) * 0.12 = 0.0876 < any clean sample.
  const maxFaulted = Math.max(...faulted.map((s) => s.quality01));
  const minClean = Math.min(...clean.map((s) => s.quality01));
  assert.ok(maxFaulted < 0.09, `faulted maximum ${maxFaulted} far below baseline`);
  assert.ok(maxFaulted < minClean, "faulted and clean distributions are strictly separated");
  // The applied factor recorded on each measurement is the fixture value.
  for (const sample of faulted) {
    assert.equal(sample.factorApplied, OPTICAL_VISIBILITY_FAULT.severities.severe.opticalQualityFactor);
    assert.equal(sample.activeFault.severity, "severe");
  }
});

test("sonar measurements are unaffected by the optical visibility fault", () => {
  const { kernel } = runFaultScenario({});
  const sonar = rovSeries(kernel, SENSOR_KINDS.SONAR);

  const duringFault = sonar.filter((s) => s.simulatorTimeMs > 5000 && s.simulatorTimeMs <= 10000);
  assert.ok(duringFault.length >= 10, "samples exist inside the fault window");
  for (const sample of duringFault) {
    // Sonar fixture baseline 0.63, noise ±0.025: bounded well away from the
    // degraded optical band and NOT dragged down by the optical fault.
    assert.ok(sample.quality01 > 0.6 && sample.quality01 < 0.66, `sonar steady during fault: ${sample.quality01}`);
  }
  // The sonar series carries no optical-visibility factor marker.
  for (const snapshot of kernel.getObservationLog()) {
    const rov = snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROV);
    const sonarSensor = rov.sensors.find((s) => s.kind === SENSOR_KINDS.SONAR);
    if (sonarSensor.measured !== null) {
      assert.equal(sonarSensor.measured.opticalVisibilityFactorApplied, null);
    }
  }
});

test("replaying the same seed reproduces the identical degradation curve", () => {
  const original = runFaultScenario({});
  const replayed = replayScenario({ seed: SEED, trace: original.kernel.getRunTrace().map((e) => ({ ...e })) });
  assert.deepEqual(
    replayed.getObservationLog(),
    original.kernel.getObservationLog(),
    "replayed observations (including faulted measurements) are identical",
  );
  // Spot-check the degradation itself is present in both.
  for (const kernel of [original.kernel, replayed]) {
    const series = rovSeries(kernel, SENSOR_KINDS.OPTICAL);
    const faulted = series.filter((s) => s.factorApplied !== null).map((s) => s.quality01);
    assert.ok(faulted.length > 0);
    assert.ok(Math.max(...faulted) < 0.09);
  }
});

test("duplicate fault command with the same idempotency key has no additional effect", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(2);
  const first = kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: 9000,
    idempotencyKey: "dup-key",
  });
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  const stateBefore = kernel.getState();

  const second = kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: 9000,
    idempotencyKey: "dup-key",
  });
  assert.equal(second.ok, true, "duplicate resolves successfully");
  assert.equal(second.duplicate, true, "duplicate is flagged");
  assert.deepEqual(second.original.result.fault, first.fault, "duplicate returns the original record");

  // The duplicate command itself did not advance time, steps or state.
  const stateAfterCommand = kernel.getState();
  assert.equal(stateAfterCommand.stepIndex, stateBefore.stepIndex);
  assert.equal(stateAfterCommand.simulatorTimeMs, stateBefore.simulatorTimeMs);

  kernel.step(2);
  const after = rovSeries(kernel, SENSOR_KINDS.OPTICAL);
  // Exactly one fault window: the fault applied during the first two post-
  // inject steps is the SAME fault (same faultId), not a stacked second one.
  const faultIds = new Set(after.filter((s) => s.activeFault).map((s) => s.activeFault.faultId));
  assert.equal(faultIds.size, 1);
  assert.equal(faultIds.has(first.fault.faultId), true);
});

test("a second distinct fault while one is active is rejected, not stacked", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "moderate",
    durationMs: 60000,
    idempotencyKey: "k1",
  });
  const second = kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: 60000,
    idempotencyKey: "k2",
  });
  assert.equal(second.ok, false);
  assert.equal(second.failure.code, "fault_already_active");
});

test("fault duration is bounded and expiry restores clean measurements deterministically", () => {
  const { kernel } = runFaultScenario({ severity: "severe", durationMs: 9000 });
  const series = rovSeries(kernel, SENSOR_KINDS.OPTICAL);

  // Injected at t=5000ms (after the 10-step baseline) with duration 9000:
  // steps starting before 14000ms are faulted; the step starting at
  // exactly 14000ms is not, so expiry is a pure function of simulator time.
  const at14000 = series.find((s) => s.simulatorTimeMs === 14000);
  const at14500 = series.find((s) => s.simulatorTimeMs === 14500);
  assert.ok(at14000 !== undefined && at14000.factorApplied !== null, "sample at 14000ms still reflects the fault");
  assert.equal(at14500.factorApplied, null, "sample at 14500ms is clean again");
  assert.equal(at14500.activeFault, null);
  assert.ok(at14500.quality01 > 0.69, `post-expiry quality back near baseline: ${at14500.quality01}`);

  // Bounded duration is enforced at injection time.
  const kernel2 = createScenarioKernel({ seed: SEED });
  const tooShort = kernel2.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: OPTICAL_VISIBILITY_FAULT.minDurationMs - 1,
    idempotencyKey: "short",
  });
  const tooLong = kernel2.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: OPTICAL_VISIBILITY_FAULT.maxDurationMs + 1,
    idempotencyKey: "long",
  });
  assert.equal(tooShort.ok, false);
  assert.equal(tooShort.failure.code, "invalid_fault_duration");
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.failure.code, "invalid_fault_duration");
});

test("fault applies only to the underwater role; clearing is idempotent", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  const onDrone = kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "drone-01",
    severity: "severe",
    durationMs: 60000,
    idempotencyKey: "wrong-target",
  });
  assert.equal(onDrone.ok, false);
  assert.equal(onDrone.failure.code, "fault_target_invalid");
  const onRover = kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rover-01",
    severity: "severe",
    durationMs: 60000,
    idempotencyKey: "wrong-target-2",
  });
  assert.equal(onRover.ok, false);
  assert.equal(onRover.failure.code, "fault_target_invalid");

  const inject = kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "moderate",
    durationMs: 60000,
    idempotencyKey: "clear-test",
  });
  assert.equal(inject.ok, true);
  const clear1 = kernel.issueCommand({ type: "clearOpticalVisibilityFault", robotId: "rov-01", idempotencyKey: "clear-key" });
  assert.equal(clear1.ok, true);
  assert.equal(clear1.cleared, true);
  const clear2 = kernel.issueCommand({ type: "clearOpticalVisibilityFault", robotId: "rov-01", idempotencyKey: "clear-key" });
  assert.equal(clear2.ok, true);
  assert.equal(clear2.duplicate, true, "duplicate clear is idempotent");
  // After clearing, measurements return to the unfaulted model.
  kernel.step(1);
  const series = rovSeries(kernel, SENSOR_KINDS.OPTICAL);
  const last = series[series.length - 1];
  assert.equal(last.factorApplied, null);
  assert.ok(last.quality01 > 0.69);
});
