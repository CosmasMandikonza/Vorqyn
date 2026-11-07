/**
 * Geometry tests — VQ-08-PREP (#20) mandatory adversarial cases:
 * - Explicit local ENU conventions hold in every observation: +x east,
 *   +y north, +z up (waterline datum 0); drone strictly above, rover at
 *   the datum plane, ROV strictly below.
 * - No teleport: per-step displacement never exceeds speed × dt (fixture
 *   speeds are exact for the dyadic 500ms step).
 * - Positions stay within the documented scenario bounds at all times.
 * - Sequence ordering, integer clock and frame/unit labels stay valid.
 *
 * Run: node --test services/simulation/core/geometry.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioKernel } from "./kernel.mjs";
import { SCENARIO_BOUNDS, DRONE_ALTITUDE_BAND, ROV_DEPTH_BAND, ROBOT_ROLES } from "./scenario.mjs";
import { distance3, stepToward } from "./enu.mjs";

const SEED = 555000;
const STEPS = 400; // long enough to traverse multiple waypoint legs

test("stepToward rejects non-finite and negative displacement budgets", () => {
  const origin = { x: 0, y: 0, z: 0 };
  const target = { x: 5, y: 0, z: 0 };
  for (const maxStep of [NaN, Infinity, -Infinity, -1]) {
    assert.throws(() => stepToward(origin, target, maxStep), RangeError);
  }
  const stationary = stepToward(origin, target, 0);
  assert.equal(stationary.movedM, 0);
  assert.deepEqual(stationary.position, origin);
});

function runLong() {
  const kernel = createScenarioKernel({ seed: SEED });
  kernel.step(STEPS);
  return kernel;
}

test("ENU sign conventions: drone above, rover at datum, ROV below, waterline at z=0", () => {
  const kernel = runLong();
  for (const snapshot of kernel.getObservationLog()) {
    const drone = snapshot.robots.find((r) => r.role === ROBOT_ROLES.DRONE);
    const rover = snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROVER);
    const rov = snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROV);
    assert.ok(drone.pose.z > 0 && drone.pose.z >= DRONE_ALTITUDE_BAND.minZ && drone.pose.z <= DRONE_ALTITUDE_BAND.maxZ, `drone altitude in band: ${drone.pose.z}`);
    assert.equal(rover.pose.z, 0, "rover stays exactly at the waterline datum plane");
    assert.ok(rov.pose.z < 0 && rov.pose.z >= ROV_DEPTH_BAND.minZ && rov.pose.z <= ROV_DEPTH_BAND.maxZ, `ROV depth in band: ${rov.pose.z}`);
  }
});

test("positions stay within the documented scenario bounds (no runaway)", () => {
  const kernel = runLong();
  for (const snapshot of kernel.getObservationLog()) {
    for (const robot of snapshot.robots) {
      assert.ok(robot.pose.x >= SCENARIO_BOUNDS.minX && robot.pose.x <= SCENARIO_BOUNDS.maxX, `x within bounds: ${robot.pose.x}`);
      assert.ok(robot.pose.y >= SCENARIO_BOUNDS.minY && robot.pose.y <= SCENARIO_BOUNDS.maxY, `y within bounds: ${robot.pose.y}`);
    }
  }
});

test("no teleport: consecutive displacement never exceeds speed × step", () => {
  const kernel = runLong();
  const log = kernel.getObservationLog();
  const epsilonM = 1e-4; // rounding of emitted coordinates to 1e-6 m each
  for (let i = 1; i < log.length; i += 1) {
    const previous = log[i - 1];
    const current = log[i];
    for (const robot of current.robots) {
      const maxStepM = robot.speedMps * (kernel.config.stepMs / 1000);
      const before = previous.robots.find((r) => r.robotId === robot.robotId).pose;
      const displacement = distance3(before, robot.pose);
      assert.ok(
        displacement <= maxStepM + epsilonM,
        `${robot.robotId} moved ${displacement.toFixed(6)}m in step ${i}, max ${maxStepM}m`,
      );
    }
  }
});

test("waypoint route is followed in order (waypointIndex cycles forward only)", () => {
  const kernel = runLong();
  let previous = { drone: 0, rover: 0, rov: 0 };
  for (const snapshot of kernel.getObservationLog()) {
    const indices = {
      drone: snapshot.robots.find((r) => r.role === ROBOT_ROLES.DRONE).waypointIndex,
      rover: snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROVER).waypointIndex,
      rov: snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROV).waypointIndex,
    };
    // Each waypoint index either stays (en route) or advances by exactly
    // one (cyclically) per step — never skips or jumps backwards.
    assert.ok(indices.drone === previous.drone || indices.drone === (previous.drone + 1) % 4);
    assert.ok(indices.rover === previous.rover || indices.rover === (previous.rover + 1) % 4);
    assert.ok(indices.rov === previous.rov || indices.rov === (previous.rov + 1) % 4);
    previous = indices;
  }
});

test("step size is exact: running steps advance the clock by exactly stepMs", () => {
  const kernel = createScenarioKernel({ seed: SEED });
  const stepMs = kernel.config.stepMs;
  kernel.step(1);
  kernel.step(2);
  const log = kernel.getObservationLog();
  assert.equal(log.length, 3);
  for (let i = 0; i < log.length; i += 1) {
    assert.equal(log[i].kernelState, "running");
    assert.equal(log[i].simulatorTimeMs, (i + 1) * stepMs, `snapshot ${i} at exact step time ${(i + 1) * stepMs}`);
  }
  assert.equal(kernel.getState().simulatorTimeMs, 3 * stepMs);
});

test("sequence ordering and frame/unit labels remain valid over the whole run", () => {
  const kernel = runLong();
  const log = kernel.getObservationLog();
  for (let i = 0; i < log.length; i += 1) {
    const snapshot = log[i];
    assert.equal(snapshot.sequence, i + 1, "sequence is dense and ordered from 1");
    assert.equal(snapshot.provenance.frameId, "ENU_PORT_LOCAL");
    assert.equal(snapshot.provenance.positionUnits, "m");
    assert.equal(snapshot.provenance.sourceKind, "SYNTHETIC_SIM");
    assert.equal(snapshot.provenance.simulatorClock, "fixed-step-simulator-time");
    for (const robot of snapshot.robots) {
      assert.ok(Number.isFinite(robot.pose.x) && Number.isFinite(robot.pose.y) && Number.isFinite(robot.pose.z), "finite coordinates");
      assert.ok(robot.speedMps > 0);
    }
  }
});
