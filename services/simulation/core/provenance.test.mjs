/**
 * Provenance tests — VQ-08-PREP (#20) mandatory adversarial cases:
 * - Every emitted record is honestly labelled sourceKind "SYNTHETIC_SIM"
 *   with the local ENU frame and metre units; no command can forge it.
 * - The ONLY clock in the kernel is the integer simulator clock; wall
 *   clocks, service clocks and Solana confirmation times do not exist in
 *   any output (structural allowlist check).
 * - No blockchain confirmation timestamps, transactions or chain events
 *   are generated — the corresponding concepts are absent from the whole
 *   emitted surface.
 * - Fault effects are quantified as measured deltas (fixture-documented).
 *
 * Run: node --test services/simulation/core/provenance.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioKernel, SOURCE_KIND_SYNTHETIC_SIM } from "./kernel.mjs";
import { ROBOT_ROLES, SENSOR_KINDS } from "./scenario.mjs";

const SEED = 1000003;

/** Collect every object key in a JSON document (array indices excluded). */
function collectKeys(value) {
  const keys = new Set();
  JSON.stringify(value, (k, v) => {
    if (k !== "" && !/^\d+$/.test(k)) keys.add(k);
    return v;
  });
  return keys;
}

function runFaultDemo() {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(20); // clean
  kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: 30000,
    idempotencyKey: "provenance-fault",
  });
  kernel.step(20); // faulted
  return kernel;
}

test("every observation and the final state are labelled SYNTHETIC_SIM with ENU metre units", () => {
  const kernel = runFaultDemo();
  for (const snapshot of kernel.getObservationLog()) {
    assert.equal(snapshot.provenance.sourceKind, SOURCE_KIND_SYNTHETIC_SIM);
    assert.equal(snapshot.provenance.frameId, "ENU_PORT-001_LOCAL");
    assert.equal(snapshot.provenance.positionUnits, "m");
    assert.equal(snapshot.provenance.scenarioId, "PORT-001");
    assert.equal(snapshot.provenance.seed, SEED);
  }
  assert.equal(kernel.getState().kernelState !== undefined, true);
});

test("no command input can influence the provenance label (no forge path exists)", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  // The pause command carries an injected provenance-like field; the strict
  // schema must reject it, and observations must stay SYNTHETIC_SIM.
  const forged = kernel.issueCommand({ type: "pause", idempotencyKey: "forge-1", sourceKind: "LIVE_SITL" });
  assert.equal(forged.ok, false);
  kernel.step(3);
  for (const snapshot of kernel.getObservationLog()) {
    assert.equal(snapshot.provenance.sourceKind, SOURCE_KIND_SYNTHETIC_SIM);
  }
});

test("structural key allowlist: outputs contain only simulator-domain fields", () => {
  const kernel = runFaultDemo();
  const allowed = new Set([
    // observation snapshot
    "sequence", "simulatorTimeMs", "stepIndex", "kernelState", "appliedStepMs", "robots", "provenance",
    // robot view
    "robotId", "role", "pose", "waypointIndex", "speedMps", "linkState", "fresh", "staleness",
    "staleSinceSimMs", "activeOpticalFault", "sensors",
    // pose
    "x", "y", "z",
    // sensor view + measurement + coverage
    "sensorId", "kind", "measured", "coverage",
    "quality01", "qualityUnits", "opticalVisibilityFactorApplied",
    "modelCellsVisited", "modelCellsTotal", "coverage01",
    // provenance
    "sourceKind", "scenarioId", "seed", "frameId", "positionUnits", "simulatorClock",
    // fault view
    "faultId", "severity", "startedAtSimMs", "expiresAtSimMs",
    // state snapshot
    "faultHistory", "kernelState", "stepIndex", "simulatorTimeMs", "sequence", "scenarioId", "seed", "stepMs",
    // audit entry
    "command", "result", "sequenceBefore", "fault", "cleared", "reason", "changed",
    // commands (audit echo)
    "type", "idempotencyKey", "robotId", "durationMs", "endState",
    "opticalQualityFactor", "startedAtStep", "clearedAtSimMs",
    // run trace
    "op", "count",
  ]);
  const emitted = [
    ...kernel.getObservationLog(),
    kernel.getState(),
    ...kernel.getCommandAuditLog(),
    ...kernel.getRunTrace(),
  ];
  const keys = collectKeys(emitted);
  for (const key of keys) {
    assert.ok(allowed.has(key), `unexpected key in kernel output: ${key}`);
  }
  // Explicit negatives for the three-clock separation and chain domain:
  for (const key of keys) {
    assert.ok(!/(^|\.)occurredAt$|observedAt|receivedAt|createdAt|capturedAt|decidedAt|activatedAt/i.test(key), `no service-clock key: ${key}`);
    assert.ok(!/chain|transaction|signature|solana|slot|blockhash|lamports|wallet|payout|escrow/i.test(key), `no chain-domain key: ${key}`);
    assert.ok(!/wall|epoch|iso8601|utc|unix/i.test(key), `no wall-clock key: ${key}`);
  }
});

test("the only time field family is simulator-domain integer milliseconds", () => {
  const kernel = runFaultDemo();
  const timeKeys = [...collectKeys([...kernel.getObservationLog(), kernel.getState()])].filter((k) => /Ms$|time/i.test(k));
  // Every time-named field is simulator-clock domain: fixed step size,
  // simulator milliseconds, and fault window bounds in simulator time.
  // No wall-clock, service-receipt or chain-confirmation field exists.
  assert.deepEqual(
    timeKeys.sort(),
    [
      "appliedStepMs",
      "clearedAtSimMs",
      "durationMs",
      "expiresAtSimMs",
      "simulatorTimeMs",
      "staleSinceSimMs",
      "startedAtSimMs",
      "stepMs",
    ].sort(),
  );
  const log = kernel.getObservationLog();
  for (const snapshot of log) {
    assert.ok(Number.isInteger(snapshot.simulatorTimeMs) && snapshot.simulatorTimeMs >= 0);
  }
});

test("fault delta is measured in the observations, not asserted by a label", () => {
  const kernel = runFaultDemo();
  const log = kernel.getObservationLog();
  const cleanQuality = [];
  const faultedQuality = [];
  for (const snapshot of log) {
    const rov = snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROV);
    const optical = rov.sensors.find((s) => s.kind === SENSOR_KINDS.OPTICAL);
    if (optical.measured === null) continue;
    if (optical.measured.opticalVisibilityFactorApplied === null) cleanQuality.push(optical.measured.quality01);
    else faultedQuality.push(optical.measured.quality01);
  }
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const cleanMean = mean(cleanQuality);
  const faultedMean = mean(faultedQuality);
  const delta = cleanMean - faultedMean;
  // Fixture: baseline 0.71 ± 0.02 vs severe factor 0.12 → mean ≈ 0.0852.
  assert.ok(Math.abs(cleanMean - 0.71) < 0.01, `clean mean near fixture baseline: ${cleanMean.toFixed(4)}`);
  assert.ok(Math.abs(faultedMean - 0.71 * 0.12) < 0.005, `faulted mean near fixture model: ${faultedMean.toFixed(4)}`);
  assert.ok(delta > 0.5, `measured optical degradation delta ${delta.toFixed(4)} is far above noise`);
});
