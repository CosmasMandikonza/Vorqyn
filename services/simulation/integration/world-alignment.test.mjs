/**
 * World-alignment integration tests — issue #24 (physical world <-> simulator).
 *
 * `assets/port-world/world.json` is the AUTHORITATIVE physical reference
 * (read-only). These tests pin the simulator's coordinate frame, origin,
 * starting poses, routes and task regions to it, and contain negative
 * detectors that would catch the exact pre-alignment defects:
 *
 * - rover below the dock (z=0 instead of the deck surface) or floating;
 * - swapped ENU axes or wrong axis signs;
 * - a route leaving traversable land / water geometry;
 * - the ROV outside the designated underwater inspection region
 *   (the pre-alignment kernel route is itself used as a negative fixture);
 * - the drone outside the declared aerial survey zone;
 * - model-origin/altitude confusion (ground contact vs geometric center);
 * - ENU->glTF conversion applied twice or with a stacked rotation.
 *
 * The kernel itself re-validates its routes at construction
 * (scenario.createScenarioConfig), so a bad committed route also fails
 * every other kernel test loudly.
 *
 * Run: node --test services/simulation/integration/world-alignment.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ROBOT_FIXTURES, ROVER_SURFACE_Z_M, ROV_DEPTH_BAND, DRONE_ALTITUDE_BAND, createScenarioConfig } from "../core/scenario.mjs";
import { FRAME_ID, GLTF_CONVERSION_RULE, enuToGltfYUp } from "../core/enu.mjs";
import { createScenarioKernel, replayScenario } from "../core/kernel.mjs";

const worldUrl = new URL("../../../assets/port-world/world.json", import.meta.url);
const world = JSON.parse(readFileSync(worldUrl, "utf8"));

// ----------------------------------------------------------------------
// Pure spatial helpers (test-only; the kernel holds no zone knowledge)
// ----------------------------------------------------------------------

function insideBox(p, box) {
  return (
    p.x >= box.min[0] && p.x <= box.max[0] &&
    p.y >= box.min[1] && p.y <= box.max[1] &&
    p.z >= box.min[2] && p.z <= box.max[2]
  );
}

function zoneById(id) {
  const zone = world.zones.find((z) => z.id === id);
  assert.ok(zone, `world.json must define zone ${id}`);
  return zone;
}

const LAND_ZONE_IDS = world.zones.filter((z) => z.kind === "land").map((z) => z.id);
const WATER_ZONE_IDS = world.zones.filter((z) => z.kind === "water").map((z) => z.id);

function inAnyZone(p, zoneIds) {
  return zoneIds.some((id) => insideBox(p, zoneById(id).box_enu_m));
}

function anchorById(id) {
  const anchor = world.anchors.find((a) => a.id === id);
  assert.ok(anchor, `world.json must define anchor ${id}`);
  const [x, y, z] = anchor.position_enu_m;
  return { x, y, z };
}

function toPoint(routeEntry) {
  return { x: routeEntry[0], y: routeEntry[1], z: routeEntry[2] };
}

/** Walk a segment in <=maxSegM steps, returning inclusive sample points. */
function sampleSegment(a, b, maxSegM) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const n = Math.max(1, Math.ceil(length / maxSegM));
  const samples = [];
  for (let i = 0; i <= n; i += 1) {
    samples.push({ x: a.x + (dx * i) / n, y: a.y + (dy * i) / n, z: a.z + (dz * i) / n });
  }
  return samples;
}

function fixtureByRobotId(robotId) {
  return ROBOT_FIXTURES.find((r) => r.robotId === robotId);
}

// ----------------------------------------------------------------------
// Detectors: return a defect reason string, or null when placement is valid.
// These exist so the negative tests can prove the detectors would catch the
// classic misplacements.
// ----------------------------------------------------------------------

/** Rover wheels must be on a traversable deck/road surface, never below/floating. */
export function roverPlacementDefect(pose) {
  if (pose.z < ROVER_SURFACE_Z_M) return "below_deck";
  if (pose.z > ROVER_SURFACE_Z_M) return "floating_above_deck";
  if (!inAnyZone(pose, LAND_ZONE_IDS)) return "off_traversable_surface";
  return null;
}

/** ROV must be submerged in a water zone; survey legs must reach the target zone. */
export function rovPlacementDefect(pose, { requireInspectionZone = true } = {}) {
  if (!inAnyZone(pose, WATER_ZONE_IDS)) return "outside_water_region";
  if (requireInspectionZone) {
    const inspection = zoneById("underwater_inspection");
    if (!insideBox(pose, inspection.box_enu_m)) return "outside_underwater_inspection_region";
  }
  return null;
}

/** Drone must stay inside the declared aerial survey zone. */
export function dronePlacementDefect(pose) {
  const zone = zoneById("aerial_survey");
  if (!insideBox(pose, zone.box_enu_m)) return "outside_aerial_survey_zone";
  return null;
}

// ----------------------------------------------------------------------
// 1. World metadata sanity (catches invalid world data before the kernel)
// ----------------------------------------------------------------------

test("world.json declares the authoritative ENU frame, datums and bounds coherently", () => {
  assert.equal(world.schema, "vorqyn.port-world/1");
  assert.equal(world.world_id, "PORT-001");
  assert.equal(world.frame.type, "ENU_local");
  assert.deepEqual(world.frame.axes, { x: "east", y: "north", z: "up" });
  assert.equal(world.frame.units, "meter");
  assert.match(world.frame.origin, /harbor-basin center at waterline/);
  assert.equal(world.waterline_z_m, 0);
  assert.equal(world.quay_deck_z_m, 4);
  const bounds = world.bounds_enu_m;
  assert.deepEqual(bounds.min, [-300, -200, -16]);
  assert.deepEqual(bounds.max, [300, 240, 100]);
  for (const zone of world.zones) {
    assert.ok(insideBox({ x: zone.box_enu_m.min[0], y: zone.box_enu_m.min[1], z: zone.box_enu_m.min[2] }, bounds), `zone ${zone.id} min inside world bounds`);
    assert.ok(insideBox({ x: zone.box_enu_m.max[0], y: zone.box_enu_m.max[1], z: zone.box_enu_m.max[2] }, bounds), `zone ${zone.id} max inside world bounds`);
  }
  for (const anchor of world.anchors) {
    const [x, y, z] = anchor.position_enu_m;
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `anchor ${anchor.id} finite`);
    assert.ok(insideBox({ x, y, z }, bounds), `anchor ${anchor.id} inside world bounds`);
  }
});

test("all required anchors exist and sit in physically sensible zones", () => {
  const required = ["port_datum", "drone_home", "rover_home", "rov_home", "crane_boom_tip", "obstruction_primary", "pier_c_collapse"];
  for (const id of required) {
    assert.ok(world.anchors.some((a) => a.id === id), `missing anchor: ${id}`);
  }
  const roverHome = anchorById("rover_home");
  assert.ok(inAnyZone(roverHome, LAND_ZONE_IDS), "rover_home is on land (trunk road)");
  assert.equal(roverHome.z, ROVER_SURFACE_Z_M, "rover_home z is the deck surface pose");
  const rovHome = anchorById("rov_home");
  assert.ok(insideBox(rovHome, zoneById("harbor_basin").box_enu_m), "rov_home is submerged in the harbor basin");
  const droneHome = anchorById("drone_home");
  assert.ok(insideBox(droneHome, zoneById("aerial_survey").box_enu_m), "drone_home is inside the aerial survey zone");
  const obstruction = anchorById("obstruction_primary");
  assert.ok(insideBox(obstruction, zoneById("obstruction_zone").box_enu_m), "primary obstruction is inside the task-target obstruction zone");
});

// ----------------------------------------------------------------------
// 2. Kernel fixtures are pinned to world routes, anchors and zones
// ----------------------------------------------------------------------

test("rover route equals world.json.routes.rover verbatim and starts at rover_home", () => {
  const fixture = fixtureByRobotId("rover-01");
  const expected = world.routes.rover.map(toPoint);
  assert.deepEqual(fixture.waypoints, expected);
  assert.deepEqual(fixture.waypoints[0], anchorById("rover_home"));
  assert.equal(fixture.routeSource, "world.json.routes.rover");
});

test("ROV route equals world.json.routes.rov verbatim, starts at rov_home, ends in the obstruction zone", () => {
  const fixture = fixtureByRobotId("rov-01");
  const expected = world.routes.rov.map(toPoint);
  assert.deepEqual(fixture.waypoints, expected);
  assert.deepEqual(fixture.waypoints[0], anchorById("rov_home"));
  assert.equal(fixture.routeSource, "world.json.routes.rov");
  const last = fixture.waypoints[fixture.waypoints.length - 1];
  assert.ok(
    insideBox(last, zoneById("obstruction_zone").box_enu_m),
    `final ROV survey waypoint ${JSON.stringify(last)} reaches the obstruction task-target zone`,
  );
});

test("drone route equals drone_home anchor plus world.json.routes.drone_survey, starting at drone_home", () => {
  const fixture = fixtureByRobotId("drone-01");
  const expected = [anchorById("drone_home"), ...world.routes.drone_survey.map(toPoint)];
  assert.deepEqual(fixture.waypoints, expected);
  assert.deepEqual(fixture.waypoints[0], anchorById("drone_home"));
  assert.match(fixture.routeSource, /drone_survey/);
});

test("kernel task regions equal the authoritative world zone boxes", () => {
  const drone = fixtureByRobotId("drone-01").taskRegion;
  const droneZone = zoneById("aerial_survey").box_enu_m;
  assert.equal(drone.id, "aerial_survey");
  assert.deepEqual([drone.box.minX, drone.box.minY, drone.box.minZ], droneZone.min);
  assert.deepEqual([drone.box.maxX, drone.box.maxY, drone.box.maxZ], droneZone.max);

  const rov = fixtureByRobotId("rov-01").taskRegion;
  const rovZone = zoneById("obstruction_zone").box_enu_m;
  assert.equal(rov.id, "obstruction_zone");
  assert.deepEqual([rov.box.minX, rov.box.minY, rov.box.minZ], rovZone.min);
  assert.deepEqual([rov.box.maxX, rov.box.maxY, rov.box.maxZ], rovZone.max);

  const rover = fixtureByRobotId("rover-01").taskRegion;
  assert.equal(rover.id, "rover-access-network");
  assert.equal(rover.box.minZ, ROVER_SURFACE_Z_M, "rover grid sits at the deck surface pose");
});

test("scenario constants derive from world.json (bounds, datum, bands, frame id)", () => {
  const config = createScenarioConfig(1);
  assert.equal(config.scenarioId, world.world_id);
  assert.equal(config.worldRef.schema, world.schema);
  assert.equal(config.worldRef.file, "assets/port-world/world.json");
  assert.deepEqual(
    [config.bounds.minX, config.bounds.minY, config.bounds.maxX, config.bounds.maxY],
    [world.bounds_enu_m.min[0], world.bounds_enu_m.min[1], world.bounds_enu_m.max[0], world.bounds_enu_m.max[1]],
  );
  assert.equal(ROVER_SURFACE_Z_M, world.quay_deck_z_m + 0.05);
  assert.deepEqual([ROV_DEPTH_BAND.minZ, ROV_DEPTH_BAND.maxZ], [zoneById("underwater_inspection").box_enu_m.min[2], zoneById("underwater_inspection").box_enu_m.max[2]]);
  assert.deepEqual([DRONE_ALTITUDE_BAND.minZ, DRONE_ALTITUDE_BAND.maxZ], [zoneById("aerial_survey").box_enu_m.min[2], zoneById("aerial_survey").box_enu_m.max[2]]);
  assert.equal(FRAME_ID, "ENU_PORT-001_LOCAL");
});

// ----------------------------------------------------------------------
// 3. Whole-route spatial validation against world geometry
// ----------------------------------------------------------------------

test("every rover waypoint AND segment sample stands on traversable land at deck height", () => {
  const route = fixtureByRobotId("rover-01").waypoints;
  for (const waypoint of route) {
    assert.equal(roverPlacementDefect(waypoint), null, `rover waypoint ${JSON.stringify(waypoint)} is valid`);
  }
  for (let i = 1; i < route.length; i += 1) {
    for (const sample of sampleSegment(route[i - 1], route[i], 5)) {
      assert.equal(
        roverPlacementDefect(sample),
        null,
        `rover segment ${i - 1}->${i} leaves traversable geometry at ${JSON.stringify(sample)}`,
      );
    }
  }
});

test("every ROV waypoint AND segment sample is submerged; survey legs reach the inspection region", () => {
  const route = fixtureByRobotId("rov-01").waypoints;
  for (let i = 0; i < route.length; i += 1) {
    // Transit from the launch point is allowed in the basin; from the third
    // waypoint onward (index >= 2, y <= -55) the vehicle is inside the
    // designated underwater inspection region.
    assert.equal(rovPlacementDefect(route[i], { requireInspectionZone: i >= 2 }), null, `ROV waypoint ${i} valid`);
  }
  for (let i = 1; i < route.length; i += 1) {
    for (const sample of sampleSegment(route[i - 1], route[i], 5)) {
      assert.equal(
        rovPlacementDefect(sample, { requireInspectionZone: false }),
        null,
        `ROV segment ${i - 1}->${i} leaves water geometry at ${JSON.stringify(sample)}`,
      );
    }
  }
});

test("every drone waypoint AND segment sample stays inside the aerial survey zone", () => {
  const route = fixtureByRobotId("drone-01").waypoints;
  for (const waypoint of route) {
    assert.equal(dronePlacementDefect(waypoint), null, `drone waypoint ${JSON.stringify(waypoint)} valid`);
  }
  for (let i = 1; i < route.length; i += 1) {
    for (const sample of sampleSegment(route[i - 1], route[i], 10)) {
      assert.equal(dronePlacementDefect(sample), null, `drone segment ${i - 1}->${i} exits the survey zone at ${JSON.stringify(sample)}`);
    }
  }
});

// ----------------------------------------------------------------------
// 4. Negative detectors: the classic misplacements must be caught
// ----------------------------------------------------------------------

test("detector catches the rover below the dock, floating, and with swapped ENU axes", () => {
  const belowDeck = { x: -160, y: 160, z: 0 }; // the pre-alignment rover pose height
  assert.equal(roverPlacementDefect(belowDeck), "below_deck");
  assert.equal(roverPlacementDefect({ x: -160, y: 160, z: 30 }), "floating_above_deck");
  const swapped = { x: -160, y: 160, z: ROVER_SURFACE_Z_M };
  const axisSwapped = { x: swapped.y, y: swapped.x, z: swapped.z }; // (160, -160): water
  assert.equal(roverPlacementDefect(axisSwapped), "off_traversable_surface");
  // old-kernel rover route point (-150,-40,0): below deck AND over water
  assert.equal(roverPlacementDefect({ x: -150, y: -40, z: 0 }), "below_deck");
});

test("detector catches the ROV outside the underwater inspection region (pre-alignment route)", () => {
  // The pre-alignment kernel ROV route: (-80,-20,-8) is water, but NOT the
  // world's designated inspection region — exactly the defect issue #24 cites.
  assert.equal(
    rovPlacementDefect({ x: -80, y: -20, z: -8 }),
    "outside_underwater_inspection_region",
  );
  // Dry land under the yard (submerged below an land zone = buried).
  assert.equal(rovPlacementDefect({ x: 0, y: 100, z: -5 }), "outside_water_region");
  // Correct world route points pass.
  assert.equal(rovPlacementDefect({ x: 60, y: -10, z: -2.5 }, { requireInspectionZone: false }), null);
  assert.equal(rovPlacementDefect({ x: 170, y: -90, z: -9 }), null);
});

test("detector catches the drone outside the declared survey bounds", () => {
  assert.equal(dronePlacementDefect({ x: 0, y: 0, z: 100 }), "outside_aerial_survey_zone");
  assert.equal(dronePlacementDefect({ x: 0, y: -190, z: 45 }), "outside_aerial_survey_zone");
  assert.equal(dronePlacementDefect({ x: 0, y: 0, z: 10 }), "outside_aerial_survey_zone"); // below zone floor
  assert.equal(dronePlacementDefect({ x: -180, y: -60, z: 45 }), null);
});

// ----------------------------------------------------------------------
// 5. ENU -> glTF conversion: exactly once, at the viewer boundary only
// ----------------------------------------------------------------------

test("the glTF conversion rule matches world.json and maps anchors correctly", () => {
  assert.equal(world.gltf_conversion.gltf_up, "Y");
  assert.equal(GLTF_CONVERSION_RULE, world.gltf_conversion.rule);
  assert.deepEqual(world.gltf_conversion.root_rotation_quaternion_xyzw, [0, 0, 0, 1], "identity root: no extra rotation allowed");

  // gltf_x = enu_x; gltf_y = enu_z; gltf_z = -enu_y
  assert.deepEqual(enuToGltfYUp(anchorById("rover_home")), { x: -160, y: 4.05, z: -160 });
  assert.deepEqual(enuToGltfYUp(anchorById("rov_home")), { x: 60, y: -2.5, z: 10 });
  assert.deepEqual(enuToGltfYUp(anchorById("obstruction_primary")), { x: 205, y: -9.2, z: 95 });
  assert.deepEqual(enuToGltfYUp({ x: -300, y: -200, z: -16 }), { x: -300, y: -16, z: 200 }, "world min corner");
  assert.deepEqual(enuToGltfYUp({ x: 300, y: 240, z: 100 }), { x: 300, y: 100, z: -240 }, "world max corner");
});

test("double-applying the glTF conversion is detectable and wrong; the kernel stays ENU", () => {
  const once = enuToGltfYUp(anchorById("rover_home")); // (x, z, -y) => (-160, 4.05, -160)
  const twice = enuToGltfYUp(once); // (x, -y, -z) => (-160, -160, -4.05)
  assert.notDeepEqual(twice, once, "applying the conversion twice changes the point");
  assert.deepEqual(twice, { x: -160, y: -160, z: -4.05 }, "double application scrambles y/z — deck height is lost, the bug this test guards against");

  // The kernel must emit raw ENU poses: run it briefly and check the first
  // observation of each robot equals its world-frame start anchor, with ENU
  // semantics intact (rover deck height positive z, ROV submerged negative z).
  const kernel = createScenarioKernel({ seed: 1 });
  const snapshot = kernel.step();
  const roverPose = snapshot.robots.find((r) => r.robotId === "rover-01").pose;
  const rovPose = snapshot.robots.find((r) => r.robotId === "rov-01").pose;
  assert.equal(roverPose.z, ROVER_SURFACE_Z_M, "kernel emits ENU z (deck height), not glTF y");
  assert.ok(rovPose.z < 0, "kernel emits ENU negative z for submerged ROV, not glTF");
  assert.deepEqual(roverPose, fixtureByRobotId("rover-01").waypoints[0]);
});

// ----------------------------------------------------------------------
// 6. Determinism, no-teleport and fault behaviour survive the alignment
// ----------------------------------------------------------------------

test("aligned kernel remains deterministic and replayable (post-alignment regression)", () => {
  const seed = 20261107;
  const kernel = createScenarioKernel({ seed });
  kernel.step(50);
  kernel.issueCommand({
    type: "injectOpticalVisibilityFault",
    robotId: "rov-01",
    severity: "severe",
    durationMs: 60000,
    idempotencyKey: "alignment-replay-fault",
  });
  kernel.step(20);
  const replayed = replayScenario({ seed, trace: kernel.getRunTrace().map((e) => ({ ...e })) });
  assert.deepEqual(replayed.getObservationLog(), kernel.getObservationLog());
});

test("aligned routes keep movement within speed x elapsed time (no teleport on world geometry)", () => {
  const kernel = createScenarioKernel({ seed: 2 });
  kernel.step(120);
  const log = kernel.getObservationLog();
  const eps = 1e-4;
  for (let i = 1; i < log.length; i += 1) {
    for (const robot of log[i].robots) {
      const maxStepM = robot.speedMps * (kernel.config.stepMs / 1000);
      const before = log[i - 1].robots.find((r) => r.robotId === robot.robotId).pose;
      const d = Math.sqrt(
        (robot.pose.x - before.x) ** 2 + (robot.pose.y - before.y) ** 2 + (robot.pose.z - before.z) ** 2,
      );
      assert.ok(d <= maxStepM + eps, `${robot.robotId} moved ${d}m > ${maxStepM}m at step ${i}`);
    }
  }
});

test("aligned ROV route genuinely enters the world inspection region (movement regression)", () => {
  const kernel = createScenarioKernel({ seed: 3 });
  // ROV travels 157m of route at 0.6m/step; ~262 steps reach the final
  // waypoint; run long enough to be deep inside the obstruction zone.
  kernel.step(400);
  const rovPoses = kernel.getObservationLog().map(
    (snapshot) => snapshot.robots.find((r) => r.robotId === "rov-01").pose,
  );
  const inObstructionZone = rovPoses.filter((p) => insideBox(p, zoneById("obstruction_zone").box_enu_m));
  assert.ok(inObstructionZone.length >= 100, `ROV spends ${inObstructionZone.length} steps inside the obstruction zone`);
  const roverPoses = kernel.getObservationLog().map(
    (snapshot) => snapshot.robots.find((r) => r.robotId === "rover-01").pose,
  );
  for (const pose of roverPoses) {
    assert.equal(roverPlacementDefect(pose), null, `rover stayed validly placed at ${JSON.stringify(pose)}`);
  }
  const dronePoses = kernel.getObservationLog().map(
    (snapshot) => snapshot.robots.find((r) => r.robotId === "drone-01").pose,
  );
  for (const pose of dronePoses) {
    assert.equal(dronePlacementDefect(pose), null, `drone stayed inside the survey zone at ${JSON.stringify(pose)}`);
  }
});
