/**
 * Determinism tests — VQ-08-PREP (#20) mandatory adversarial cases:
 * - Same seed + same commands => identical time, pose, sensor measurements,
 *   sequence numbers, and audit trail.
 * - A different seed actually changes measurement streams.
 * - replayScenario(seed, auditLog) reproduces the original observation
 *   stream exactly.
 *
 * Run: node --test services/simulation/core/determinism.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioKernel, replayScenario } from "./kernel.mjs";
import { createRng } from "./rng.mjs";

const SEED = 20261107;

/** A fixed non-trivial command script shared by all determinism scenarios. */
function commandScript(kernel) {
  const issued = [];
  issued.push(kernel.issueCommand(idempotent({ type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 9000 }, "script-fault-1")));
  kernel.step(4);
  issued.push(kernel.issueCommand(idempotent({ type: "pause" }, "script-pause-1")));
  kernel.step(3); // paused: frozen heartbeats only
  issued.push(kernel.issueCommand(idempotent({ type: "resume" }, "script-resume-1")));
  issued.push(kernel.issueCommand(idempotent({ type: "disconnectTelemetry", robotId: "drone-01" }, "script-disconnect-1")));
  kernel.step(5);
  issued.push(kernel.issueCommand(idempotent({ type: "reconnectTelemetry", robotId: "drone-01" }, "script-reconnect-1")));
  kernel.step(6);
  issued.push(kernel.issueCommand(idempotent({ type: "clearOpticalVisibilityFault", robotId: "rov-01" }, "script-clear-1")));
  kernel.step(4);
  return issued;
}

function idempotent(command, key) {
  return { ...command, idempotencyKey: key };
}

function runScript(seed) {
  const kernel = createScenarioKernel({ seed });
  const outcomes = commandScript(kernel);
  return { kernel, outcomes };
}

test("identical seed and commands produce identical observations, state and audit", () => {
  const a = runScript(SEED);
  const b = runScript(SEED);

  assert.deepEqual(b.kernel.getObservationLog(), a.kernel.getObservationLog());
  assert.deepEqual(b.kernel.getState(), a.kernel.getState());
  assert.deepEqual(b.kernel.getCommandAuditLog(), a.kernel.getCommandAuditLog());

  // Every individual element is deep-equal and sequence numbers line up.
  const logA = a.kernel.getObservationLog();
  const logB = b.kernel.getObservationLog();
  assert.equal(logB.length, logA.length);
  for (let i = 0; i < logA.length; i += 1) {
    assert.equal(logB[i].sequence, logA[i].sequence);
    assert.equal(logB[i].simulatorTimeMs, logA[i].simulatorTimeMs);
  }
  // Command outcomes match, including fault records and ids.
  assert.deepEqual(b.outcomes.map((o) => JSON.stringify(o)), a.outcomes.map((o) => JSON.stringify(o)));
});

test("a different seed changes measurement streams while structure stays valid", () => {
  const a = runScript(SEED);
  const b = runScript(SEED + 1);

  const opticalA = collectMeasurements(a.kernel.getObservationLog(), "rov-01-optical");
  const opticalB = collectMeasurements(b.kernel.getObservationLog(), "rov-01-optical");
  assert.equal(opticalB.length, opticalA.length);
  // Same scripted behaviour, different noise stream: at least one measured
  // quality differs. (Fixture means are identical, so this isolates the seed.)
  assert.notDeepEqual(opticalB, opticalA);
});

test("replayScenario from the recorded run trace reproduces the original stream", () => {
  const original = runScript(SEED);
  const trace = original.kernel.getRunTrace();

  const replayed = replayScenario({ seed: SEED, trace: trace.map((entry) => ({ ...entry })) });

  assert.deepEqual(replayed.getObservationLog(), original.kernel.getObservationLog());
  assert.deepEqual(replayed.getState(), original.kernel.getState());
  // The replayed run trace is itself identical, so replay chains further.
  assert.deepEqual(replayed.getRunTrace(), original.kernel.getRunTrace());
  // Replay also preserves paused frozen heartbeats, which a command-only
  // log could not express.
  const pausedHeartbeats = replayed.getObservationLog().filter((s) => s.kernelState === "paused");
  const originalPaused = original.kernel.getObservationLog().filter((s) => s.kernelState === "paused");
  assert.ok(pausedHeartbeats.length > 0, "script pauses the kernel, producing frozen heartbeats");
  assert.equal(pausedHeartbeats.length, originalPaused.length);
});

test("the PRNG itself is seed-reproducible and consumption-order dependent", () => {
  const x = createRng(SEED);
  const y = createRng(SEED);
  const streamX = [x(), x(), x(), x()];
  const streamY = [y(), y(), y(), y()];
  assert.deepEqual(streamY, streamX);

  // A partially consumed stream continues exactly where it left off.
  const z = createRng(SEED);
  assert.equal(z(), streamX[0]);
  assert.equal(z(), streamX[1]);
  // Two consumed values shift the stream relative to a fresh one.
  const w = createRng(SEED);
  w();
  w();
  assert.notEqual(w(), streamX[0]);
  for (const v of streamX) {
    assert.ok(v >= 0 && v < 1, `rng value in [0,1): ${v}`);
  }
});

test("sequence strictly increases; time advances exactly one step while running and freezes while paused", () => {
  const { kernel } = runScript(SEED);
  const log = kernel.getObservationLog();
  const stepMs = kernel.config.stepMs;
  let previousSeq = 0;
  let previousTime = 0; // simulator clock starts at 0
  for (const snapshot of log) {
    assert.ok(snapshot.sequence > previousSeq, `sequence increased at ${snapshot.sequence}`);
    assert.ok(Number.isInteger(snapshot.simulatorTimeMs), "simulator time is an integer");
    if (snapshot.kernelState === "running") {
      assert.equal(snapshot.simulatorTimeMs - previousTime, stepMs, `running step advanced exactly ${stepMs}ms`);
      assert.equal(snapshot.appliedStepMs, stepMs);
    } else {
      assert.equal(snapshot.kernelState, "paused");
      assert.equal(snapshot.simulatorTimeMs, previousTime, "paused snapshot holds the clock frozen");
      assert.equal(snapshot.appliedStepMs, 0);
    }
    previousSeq = snapshot.sequence;
    previousTime = snapshot.simulatorTimeMs;
  }
  assert.equal(previousSeq, log.length);
});

test("read-only observation, command and replay accessors cannot rewrite kernel history", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(2);
  const command = kernel.issueCommand({ type: "pause", idempotencyKey: "immutable-history-1" });
  assert.equal(command.ok, true);
  const observations = kernel.getObservationLog();
  const audit = kernel.getCommandAuditLog();
  const trace = kernel.getRunTrace();
  assert.deepEqual([observations.length, audit.length, trace.length], [2, 1, 2]);

  for (const [label, records] of [["observations", observations], ["audit", audit], ["trace", trace]]) {
    assert.equal(Object.isFrozen(records), true, `${label} accessor returns an immutable array`);
    assert.throws(() => records.push({ forged: true }), TypeError, `${label} cannot append fabricated history`);
    assert.throws(() => records.splice(0, 1), TypeError, `${label} cannot erase recorded history`);
  }

  assert.deepEqual([kernel.getObservationLog().length, kernel.getCommandAuditLog().length, kernel.getRunTrace().length], [2, 1, 2]);
  kernel.issueCommand({ type: "resume", idempotencyKey: "immutable-history-2" });
  kernel.step();
  assert.equal(kernel.getObservationLog().length, 3, "future observations remain recorded");
  assert.equal(kernel.getCommandAuditLog().length, 2, "future commands remain recorded");
  assert.equal(kernel.getRunTrace().length, 4, "future operations remain recorded");
  assert.equal(observations.length, 2, "prior immutable snapshot remains a stable snapshot");
  const replayed = replayScenario({ seed: SEED, trace: kernel.getRunTrace() });
  assert.deepEqual(replayed.getObservationLog(), kernel.getObservationLog(), "immutable tape remains replayable");
});

test("PRNG and scenario seeds reject fractional or out-of-range input", () => {
  for (const seed of [1.25, -1, 4294967296, NaN, Infinity, -Infinity]) {
    assert.throws(() => createScenarioKernel({ seed }), RangeError);
    assert.throws(() => createRng(seed), RangeError);
  }
});

function collectMeasurements(log, sensorId) {
  const out = [];
  for (const snapshot of log) {
    for (const robot of snapshot.robots) {
      for (const sensor of robot.sensors) {
        if (sensor.sensorId === sensorId && sensor.measured !== null) {
          out.push(sensor.measured.quality01);
        }
      }
    }
  }
  return out;
}
