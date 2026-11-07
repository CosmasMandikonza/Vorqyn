/**
 * Geometry tests — VQ-08-PREP (#20) mandatory adversarial cases, updated for
 * the #24 world alignment:
 * - Explicit local ENU conventions hold in every observation: +x east,
 *   +y north, +z up (waterline datum 0, world origin = harbor-basin center);
 *   drone inside the aerial survey band, rover exactly at the deck surface
 *   pose (ground contact on the quay deck), ROV strictly submerged.
 * - No teleport: per-step displacement never exceeds speed × dt (fixture
 *   speeds are exact for the dyadic 500ms step); world routes traverse
 *   ping-pong with no wrap-around jumps.
 * - Positions stay within the world bounds at all times.
 * - Sequence ordering, integer clock and frame/unit labels stay valid.
 *
 * Run: node --test services/simulation/core/geometry.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioKernel } from "./kernel.mjs";
import { SCENARIO_BOUNDS, DRONE_ALTITUDE_BAND, ROV_DEPTH_BAND, ROVER_SURFACE_Z_M, ROBOT_ROLES, ROUTE_MODE } from "./scenario.mjs";
import { distance3, stepToward } from "./enu.mjs";

const SEED = 555000;
const STEPS = 400; // long enough to traverse multiple waypoint legs and a ping-pong reversal

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

test("ENU sign conventions: drone in survey band, rover on deck surface, ROV submerged, waterline z=0", () => {
  const kernel = runLong();
  for (const snapshot of kernel.getObservationLog()) {
    const drone = snapshot.robots.find((r) => r.role === ROBOT_ROLES.DRONE);
    const rover = snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROVER);
    const rov = snapshot.robots.find((r) => r.role === ROBOT_ROLES.ROV);
    assert.ok(drone.pose.z > 0 && drone.pose.z >= DRONE_ALTITUDE_BAND.minZ && drone.pose.z <= DRONE_ALTITUDE_BAND.maxZ, `drone altitude in band: ${drone.pose.z}`);
    assert.equal(rover.pose.z, ROVER_SURFACE_Z_M, "rover stays exactly at the deck surface pose (wheels on the quay deck)");
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

test("world routes traverse ping-pong: index steps by ±1, bouncing at the ends, never wrapping", () => {
  const kernel = runLong();
  const log = kernel.getObservationLog();
  const roles = {
    drone: { role: ROBOT_ROLES.DRONE, length: kernel.config.robots.find((r) => r.robotId === "drone-01").waypoints.length },
    rover: { role: ROBOT_ROLES.ROVER, length: kernel.config.robots.find((r) => r.robotId === "rover-01").waypoints.length },
    rov: { role: ROBOT_ROLES.ROV, length: kernel.config.robots.find((r) => r.robotId === "rov-01").waypoints.length },
  };
  assert.equal(ROUTE_MODE, "ping-pong");
  const previous = { drone: 0, rover: 0, rov: 0 };
  const direction = { drone: 1, rover: 1, rov: 1 };
  const maxSeen = { drone: 0, rover: 0, rov: 0 };
  for (const snapshot of log) {
    for (const key of Object.keys(roles)) {
      const { role, length } = roles[key];
      const index = snapshot.robots.find((r) => r.role === role).waypointIndex;
      assert.ok(index >= 0 && index < length, `${key} waypointIndex in range: ${index}`);
      maxSeen[key] = Math.max(maxSeen[key], index);
      // The index either stays (en route) or moves exactly one waypoint along
      // the current direction; at the ends the direction flips (ping-pong).
      if (index !== previous[key]) {
        assert.equal(index, previous[key] + direction[key], `${key} index moves exactly one waypoint`);
        if (index === length - 1) assert.equal(direction[key], 1, `${key} flips to return at the far end`);
        if (index === 0) assert.equal(direction[key], -1, `${key} flips to outbound at the home end`);
        direction[key] = index === length - 1 ? -1 : index === 0 ? 1 : direction[key];
      }
      previous[key] = index;
    }
  }
  // With 400 steps the ROV (230 steps out, ~460 round trip) has reversed at
  // the far end and is on its final return leg targeting waypoint 0 — so the
  // far end must have been visited, without any wrap-around jump.
  assert.equal(maxSeen.rov, roles.rov.length - 1, "rov reached the far end (ping-pong reversal)");
  assert.equal(previous.rov, 0, `rov is heading home (emitted index ${previous.rov})`);
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
    assert.equal(snapshot.provenance.frameId, "ENU_PORT-001_LOCAL");
    assert.equal(snapshot.provenance.positionUnits, "m");
    assert.equal(snapshot.provenance.sourceKind, "SYNTHETIC_SIM");
    assert.equal(snapshot.provenance.simulatorClock, "fixed-step-simulator-time");
    for (const robot of snapshot.robots) {
      assert.ok(Number.isFinite(robot.pose.x) && Number.isFinite(robot.pose.y) && Number.isFinite(robot.pose.z), "finite coordinates");
      assert.ok(robot.speedMps > 0);
    }
  }
});
