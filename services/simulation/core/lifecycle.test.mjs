/**
 * Lifecycle tests — VQ-08-PREP (#20) mandatory adversarial cases:
 * - Paused simulations produce NO phantom movement: the clock, all poses
 *   and coverage freeze, and frozen snapshots are explicitly labelled
 *   "kernel-paused" and non-fresh.
 * - Stopped simulations are terminal: no steps, no time, no movement.
 * - Disconnected telemetry freezes the robot at its last authoritative
 *   pose, labels samples stale/disconnected, emits no fabricated fresh
 *   measurements, and reconnection resumes from the frozen pose.
 *
 * Run: node --test services/simulation/core/lifecycle.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioKernel, KernelStoppedError } from "./kernel.mjs";
import { ROBOT_ROLES } from "./scenario.mjs";

const SEED = 90210;

function poseOf(snapshot, robotId) {
  const robot = snapshot.robots.find((r) => r.robotId === robotId);
  return robot.pose;
}

test("paused kernel: no clock advance, no movement, honest frozen labels", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(6);
  const before = kernel.getState();

  const paused = kernel.issueCommand({ type: "pause", idempotencyKey: "pause-1" });
  assert.equal(paused.ok, true);

  const frozenSnapshots = [];
  for (let i = 0; i < 5; i += 1) {
    frozenSnapshots.push(kernel.step());
  }

  const after = kernel.getState();
  assert.equal(after.simulatorTimeMs, before.simulatorTimeMs, "clock frozen while paused");
  assert.equal(after.stepIndex, before.stepIndex, "no world steps while paused");
  for (const robotId of ["drone-01", "rover-01", "rov-01"]) {
    assert.deepEqual(poseOf(after, robotId), poseOf(before, robotId), `${robotId} pose frozen`);
  }

  for (const snapshot of frozenSnapshots) {
    assert.equal(snapshot.kernelState, "paused");
    assert.equal(snapshot.simulatorTimeMs, before.simulatorTimeMs);
    assert.equal(snapshot.appliedStepMs, 0, "no simulated time applied");
    for (const robot of snapshot.robots) {
      assert.equal(robot.fresh, false, "paused samples are not fresh");
      assert.equal(robot.staleness, "kernel-paused");
      assert.ok(robot.sensors.length >= 1);
      for (const sensor of robot.sensors) {
        assert.equal(sensor.measured, null, "no fabricated fresh measurements while paused");
      }
    }
  }
  // Sequence numbers still advance (honest heartbeat events) while content
  // stays frozen — later assertions rely on snapshots being event-sourced.
  const sequences = frozenSnapshots.map((s) => s.sequence);
  for (let i = 1; i < sequences.length; i += 1) {
    assert.ok(sequences[i] > sequences[i - 1]);
  }
});

test("resume continues motion from the frozen pose, with no jump", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(4);
  kernel.issueCommand({ type: "pause", idempotencyKey: "p" });
  const frozen = kernel.getState();
  kernel.step(3); // heartbeats only
  kernel.issueCommand({ type: "resume", idempotencyKey: "r" });
  const firstAfterResume = kernel.step();

  assert.equal(firstAfterResume.simulatorTimeMs, frozen.simulatorTimeMs + kernel.config.stepMs);
  for (const robotId of ["drone-01", "rover-01", "rov-01"]) {
    const a = poseOf(frozen, robotId);
    const b = poseOf(firstAfterResume, robotId);
    const maxStep = kernel.config.robots.find((r) => r.robotId === robotId).speedMps * (kernel.config.stepMs / 1000);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const displacement = Math.sqrt(dx * dx + dy * dy + dz * dz);
    assert.ok(displacement <= maxStep + 1e-4, `${robotId} resumed within one step: ${displacement} <= ${maxStep}`);
  }
});

test("stopped kernel is terminal: no steps, no commands, no phantom movement", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(5);
  const before = kernel.getState();
  const stopped = kernel.issueCommand({ type: "stop", idempotencyKey: "stop" });
  assert.equal(stopped.ok, true);

  assert.throws(() => kernel.step(), KernelStoppedError);
  assert.throws(() => kernel.step(10), KernelStoppedError);

  const after = kernel.getState();
  assert.equal(after.kernelState, "stopped");
  assert.equal(after.simulatorTimeMs, before.simulatorTimeMs);
  assert.equal(after.stepIndex, before.stepIndex);
  for (const robotId of ["drone-01", "rover-01", "rov-01"]) {
    assert.deepEqual(poseOf(after, robotId), poseOf(before, robotId));
  }
  // Link commands are also invalid after stop.
  const link = kernel.issueCommand({ type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "post-stop" });
  assert.equal(link.ok, false);
  assert.equal(link.failure.code, "invalid_transition");
});

test("disconnected robot freezes at its last authoritative pose and is labelled stale", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(8);
  const lastFreshPose = poseOf(kernel.getState(), "rov-01");
  const lastFreshTime = kernel.getState().simulatorTimeMs;

  kernel.issueCommand({ type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "link-cut" });
  const othersBefore = kernel.getState();

  const disconnectedSnapshots = [];
  for (let i = 0; i < 6; i += 1) {
    disconnectedSnapshots.push(kernel.step());
  }

  const after = kernel.getState();
  // Clock and OTHER robots keep moving; the disconnected ROV is frozen.
  assert.ok(after.simulatorTimeMs > lastFreshTime, "world clock keeps running for connected robots");
  assert.notDeepEqual(poseOf(after, "rover-01"), poseOf(othersBefore, "rover-01"), "rover kept moving while the ROV link was down");

  assert.deepEqual(poseOf(after, "rov-01"), lastFreshPose, "ROV frozen at last authoritative pose");

  for (const snapshot of disconnectedSnapshots) {
    const rov = snapshot.robots.find((r) => r.robotId === "rov-01");
    assert.equal(rov.linkState, "disconnected");
    assert.equal(rov.fresh, false, "disconnected samples are not fresh");
    assert.equal(rov.staleness, "link-disconnected");
    assert.equal(rov.staleSinceSimMs, lastFreshTime, "staleness anchored to last fresh simulator time");
    for (const sensor of rov.sensors) {
      assert.equal(sensor.measured, null, "no fabricated measurements during link loss");
    }
  }
});

test("coverage and noise streams freeze during disconnection; reconnect resumes truthfully", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(6);
  kernel.issueCommand({ type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "cut-1" });
  kernel.step(10);

  const snapshotsWithCoverage = kernel.getObservationLog().slice(-10);
  const coverageCounts = snapshotsWithCoverage.map(
    (snapshot) => snapshot.robots.find((r) => r.robotId === "rov-01").sensors[0].coverage.modelCellsVisited,
  );
  assert.equal(Math.max(...coverageCounts), Math.min(...coverageCounts), "coverage frozen during link loss");

  kernel.issueCommand({ type: "reconnectTelemetry", robotId: "rov-01", idempotencyKey: "fix-1" });
  const afterReconnect = kernel.step();
  const rov = afterReconnect.robots.find((r) => r.robotId === "rov-01");
  assert.equal(rov.linkState, "connected");
  assert.equal(rov.fresh, true);
  assert.equal(rov.staleness, "none");
  assert.equal(rov.staleSinceSimMs, null, "fresh sample exists again");
  assert.notEqual(rov.sensors[0].measured, null, "fresh measurement flows after reconnect");
});

test("all three robots keep moving while running (multi-role scenario stays coherent)", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  const first = kernel.step();
  const last = kernel.step(20);
  for (const robotId of ["drone-01", "rover-01", "rov-01"]) {
    assert.notDeepEqual(poseOf(last, robotId), poseOf(first, robotId), `${robotId} moved`);
  }
  // Every snapshot carries the whole three-role scenario.
  for (const snapshot of kernel.getObservationLog()) {
    assert.equal(snapshot.robots.length, 3);
    assert.deepEqual(
      snapshot.robots.map((r) => r.role),
      [ROBOT_ROLES.DRONE, ROBOT_ROLES.ROVER, ROBOT_ROLES.ROV],
    );
  }
});
