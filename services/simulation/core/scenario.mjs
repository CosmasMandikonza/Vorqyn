/**
 * VORQYN lane-2 simulation kernel — port scenario fixture, WORLD-ALIGNED (v2).
 *
 * Scope: VQ-08-PREP (#20) + #24 world/simulator alignment.
 *
 * FRAME CONTRACT (authoritative): as of alignment issue #24, this scenario is
 * expressed directly in the physical frame of the versioned world metadata
 * `assets/port-world/world.json` (schema `vorqyn.port-world/1`, world
 * `PORT-001`): local ENU, origin at the **harbor-basin center at waterline**,
 * +x east, +y north (land lies north), +z up, metres, waterline z = 0, quay
 * deck z = 4. The kernel performs NO runtime coordinate transform and no
 * ENU-to-glTF conversion — that boundary belongs to the 3D viewer (see
 * `services/simulation/integration/FRAME_CONTRACT.md` and `enuToGltfYUp`).
 *
 * Routes: the per-role waypoint routes below are the world-defined routes
 * from `world.json.routes`, verbatim, with one documented addition: the
 * drone route is prepended with the `drone_home` staging anchor so every
 * vehicle starts at its world anchor (rover/rov routes already start at
 * their homes). Because these are out-and-back survey paths rather than
 * closed loops, traversal mode is "ping-pong" (route is walked forward then
 * reversed) — this preserves the no-teleport invariant without inventing
 * return geometry.
 *
 * EVERY number below is an explicit internal fixture value chosen for a
 * testable synthetic scenario. They are model parameters of a synthetic
 * simulator, NOT measurements of any physical harbour, and NOT physical
 * truth claims. Sensor quality/coverage numbers are documented synthetic
 * test data per docs/ARCHITECTURE.md §5.
 *
 * The demo thresholds at the bottom are illustrative values an external
 * policy evaluator (VQ-10) could use. The kernel itself NEVER accepts or
 * rejects evidence; it only produces measurements these thresholds can be
 * evaluated against. Do not treat them as the authoritative policy.
 */

export const SCENARIO_ID = "PORT-001";

/** The authoritative physical world this scenario is aligned with. */
export const WORLD_REF = Object.freeze({
  file: "assets/port-world/world.json",
  schema: "vorqyn.port-world/1",
  worldId: "PORT-001",
  frameType: "ENU_local",
  origin: "harbor-basin center at waterline; land lies north (+y)",
});

/** Simulator clock: fixed integer step, independent of wall/chain time. */
export const STEP_MS = 500; // dyadic => dt = 0.5 s is exact in binary floating point

/**
 * Plan-view scenario bounds, taken from `world.json.bounds_enu_m`
 * (x/y components): a 600 x 440 m world centred on the harbour basin.
 * Route waypoints and poses stay inside these bounds (kernel-validated).
 */
export const SCENARIO_BOUNDS = Object.freeze({ minX: -300, maxX: 300, minY: -200, maxY: 240 });

/** Waterline datum and quay deck height, from world.json (metres, ENU z). */
export const WATERLINE_Z_M = 0;
export const QUAY_DECK_Z_M = 4;

/**
 * Rover pose z on deck roads: quay_deck_z_m (4) + 0.05 m ground-contact
 * clearance — matches the world rover route/anchor z exactly. The rover
 * reference model origin convention is "ground contact", so this pose z
 * places the wheels on the deck surface, not below or floating above it.
 */
export const ROVER_SURFACE_Z_M = 4.05;

/**
 * Depth band the ROV fixture operates in (metres, negative = below datum):
 * the world's underwater_inspection / obstruction_zone z range. The ROV
 * reference model origin is the "geometric center (neutrally buoyant)", so
 * pose z is the vehicle centre height, not a hull contact point.
 */
export const ROV_DEPTH_BAND = Object.freeze({ minZ: -12.5, maxZ: -0.5 });

/** Altitude band the drone fixture operates in: the aerial_survey zone. */
export const DRONE_ALTITUDE_BAND = Object.freeze({ minZ: 15, maxZ: 90 });

/**
 * Route traversal mode for all world routes: out-and-back survey paths are
 * walked forward, then reversed ("ping-pong"). Closed loops would need a
 * teleport from the last waypoint back to the first, which the kernel
 * forbids. See kernel.integrateMotion.
 */
export const ROUTE_MODE = "ping-pong";

const ROLES = Object.freeze({
  DRONE: "aerial-drone",
  ROVER: "ground-rover",
  ROV: "underwater-rov",
});

export const ROBOT_ROLES = ROLES;

/**
 * Sensor modality identifiers. Optical and sonar are independent models:
 * an optical fault never silently changes sonar measurements, and sonar
 * coverage is accumulated by a different rule than optical coverage.
 */
export const SENSOR_KINDS = Object.freeze({ OPTICAL: "optical", SONAR: "sonar" });

/**
 * Optical-visibility fault fixture. `opticalQualityFactor` multiplies the
 * sensor's baseline quality measurement while the fault is active, so the
 * MEASURED quality genuinely drops; this is a measurement change, not a
 * status label. Sonar values are untouched by this fault model.
 * (Unchanged by the #24 alignment: fault behaviour must survive it.)
 */
export const OPTICAL_VISIBILITY_FAULT = Object.freeze({
  kind: "optical-visibility",
  severities: Object.freeze({
    moderate: Object.freeze({ opticalQualityFactor: 0.35 }),
    severe: Object.freeze({ opticalQualityFactor: 0.12 }),
  }),
  /** Fault duration bounds, in simulator milliseconds (bounded, user-triggered). */
  minDurationMs: 1000,
  maxDurationMs: 120000,
});

/**
 * World route waypoints, verbatim from `world.json.routes` (issue #24).
 * Coordinates are ENU metres in the world frame.
 */
const WORLD_ROVER_ROUTE = Object.freeze([
  [-160, 160, 4.05],
  [-140, 160, 4.05],
  [-140, 60, 4.05],
  [-140, 48, 4.05],
  [-140, -20, 4.05],
  [-140, -40, 4.05],
  [-140, 48, 4.05],
  [-20, 52, 4.05],
  [0, 48, 4.05],
  [0, -30, 4.05],
]);

const WORLD_ROV_ROUTE = Object.freeze([
  [60, -10, -2.5],
  [90, -30, -4],
  [120, -55, -6],
  [150, -75, -8],
  [170, -90, -9],
]);

const WORLD_DRONE_SURVEY_ROUTE = Object.freeze([
  [-180, -60, 45],
  [60, -60, 45],
  [180, -90, 45],
  [60, -120, 45],
  [-180, 10, 45],
]);

/** World staging anchors (world.json.anchors) used as vehicle start poses. */
const DRONE_HOME = [-40, 80, 55]; // "Drone staging hover"
// rover route already starts at rover_home [-160, 160, 4.05]
// rov route already starts at rov_home [60, -10, -2.5]

function toWaypoints(route) {
  return Object.freeze(route.map(([x, y, z]) => Object.freeze({ x, y, z })));
}

/** Drone route = staging anchor, then the world survey route verbatim. */
const DRONE_ROUTE = toWaypoints([DRONE_HOME, ...WORLD_DRONE_SURVEY_ROUTE]);

/**
 * Robot fixture definitions. Speeds and dt are dyadic so per-step motion is
 * exact in binary floating point (drone 2.0 m/step, rover 1.25, rov 0.6).
 * Task regions are derived from world zones: the drone grid covers the
 * `aerial_survey` zone plan box, the ROV grid covers the `obstruction_zone`
 * (the world's task_target zone inside `underwater_inspection`), and the
 * rover grid covers the plan bounding box of its access route (cells over
 * water are unreachable and simply never get visited).
 */
export const ROBOT_FIXTURES = Object.freeze([
  Object.freeze({
    robotId: "drone-01",
    role: ROLES.DRONE,
    speedMps: 4,
    altitudeBand: DRONE_ALTITUDE_BAND,
    routeMode: ROUTE_MODE,
    routeSource: "world.json.routes.drone_survey (prepended with anchors.drone_home)",
    waypoints: DRONE_ROUTE,
    taskRegion: Object.freeze({
      id: "aerial_survey",
      box: Object.freeze({ minX: -280, maxX: 280, minY: -180, maxY: 220, minZ: 15, maxZ: 90 }),
      cellsX: 14,
      cellsY: 10,
    }),
    sensors: Object.freeze([
      Object.freeze({
        sensorId: "drone-01-optical",
        kind: SENSOR_KINDS.OPTICAL,
        /** Fixture baseline quality [0..1] in clear air (documented fixture). */
        baselineQuality01: 0.92,
        /** Symmetric noise amplitude on the measured quality per sample. */
        qualityNoise01: 0.015,
        /** Optical coverage: only the plan grid cell the robot is inside. */
        coverageModel: "in-cell",
      }),
    ]),
  }),
  Object.freeze({
    robotId: "rover-01",
    role: ROLES.ROVER,
    speedMps: 2.5,
    surfaceZM: ROVER_SURFACE_Z_M,
    routeMode: ROUTE_MODE,
    routeSource: "world.json.routes.rover",
    waypoints: toWaypoints(WORLD_ROVER_ROUTE),
    taskRegion: Object.freeze({
      id: "rover-access-network",
      box: Object.freeze({ minX: -160, maxX: 0, minY: -40, maxY: 160, minZ: 4.05, maxZ: 4.05 }),
      cellsX: 8,
      cellsY: 10,
    }),
    sensors: Object.freeze([
      Object.freeze({
        sensorId: "rover-01-optical",
        kind: SENSOR_KINDS.OPTICAL,
        baselineQuality01: 0.88,
        qualityNoise01: 0.015,
        coverageModel: "in-cell",
      }),
    ]),
  }),
  Object.freeze({
    robotId: "rov-01",
    role: ROLES.ROV,
    speedMps: 1.2,
    depthBand: ROV_DEPTH_BAND,
    routeMode: ROUTE_MODE,
    routeSource: "world.json.routes.rov",
    waypoints: toWaypoints(WORLD_ROV_ROUTE),
    taskRegion: Object.freeze({
      id: "obstruction_zone",
      box: Object.freeze({ minX: 120, maxX: 220, minY: -120, maxY: -60, minZ: -12.5, maxZ: -0.5 }),
      cellsX: 5,
      cellsY: 3,
    }),
    sensors: Object.freeze([
      Object.freeze({
        sensorId: "rov-01-optical",
        kind: SENSOR_KINDS.OPTICAL,
        /**
         * Fixture baseline in turbid harbour water. Already moderate; the
         * optical-visibility fault drives it far below any reasonable
         * evidence threshold.
         */
        baselineQuality01: 0.71,
        qualityNoise01: 0.02,
        coverageModel: "in-cell",
      }),
      Object.freeze({
        sensorId: "rov-01-sonar",
        kind: SENSOR_KINDS.SONAR,
        /**
         * Fixture sonar baseline. Independently seeded and independently
         * modelled: unaffected by the optical-visibility fault, and its
         * measured quality is NOT automatically policy-acceptable.
         */
        baselineQuality01: 0.63,
        qualityNoise01: 0.025,
        /**
         * Sonar coverage uses a different rule than optical: every plan
         * grid cell whose centre lies within this slant range of the ROV
         * is observed this step (a beam/range model, not in-cell).
         */
        coverageModel: "range-ring",
        rangeM: 25,
      }),
    ]),
  }),
]);

/**
 * ILLUSTRATIVE evaluation thresholds a future external policy evaluator
 * could apply to the measured fields this kernel emits. Exported only so
 * tests can demonstrate insufficiency detection; the kernel itself never
 * accepts or rejects evidence and emits no verdicts. (Unchanged by #24.)
 */
export const DEMO_POLICY_THRESHOLDS = Object.freeze({
  /** docs/ARCHITECTURE.md §6 example: optical evidence needs real quality. */
  opticalEvidenceQualityMin01: 0.5,
  /** Stricter "structural mapping" bar that the fixture sonar does NOT meet. */
  structuralSonarQualityMin01: 0.8,
});

/**
 * Validate the world-aligned route fixtures at config construction: finite
 * coordinates, inside the world plan bounds, and within the role's vertical
 * band / surface constraint. A route edit that leaves the physical world
 * fails loudly here instead of silently producing off-world telemetry.
 */
function validateRouteFixtures() {
  for (const fixture of ROBOT_FIXTURES) {
    if (fixture.routeMode !== "ping-pong" || fixture.waypoints.length < 2) {
      throw new RangeError(`robot ${fixture.robotId}: world-aligned routes must be ping-pong with >= 2 waypoints`);
    }
    fixture.waypoints.forEach((wp, index) => {
      const at = `${fixture.robotId} waypoint ${index}`;
      for (const key of ["x", "y", "z"]) {
        if (!Number.isFinite(wp[key])) {
          throw new RangeError(`${at}: non-finite ${key} coordinate ${wp[key]} — invalid route coordinate`);
        }
      }
      if (wp.x < SCENARIO_BOUNDS.minX || wp.x > SCENARIO_BOUNDS.maxX || wp.y < SCENARIO_BOUNDS.minY || wp.y > SCENARIO_BOUNDS.maxY) {
        throw new RangeError(`${at}: (${wp.x}, ${wp.y}) outside world plan bounds`);
      }
      if (fixture.role === ROLES.ROVER && wp.z !== ROVER_SURFACE_Z_M) {
        throw new RangeError(`${at}: rover z ${wp.z} must be the deck surface pose ${ROVER_SURFACE_Z_M} (ground contact)`);
      }
      if (fixture.role === ROLES.ROV && (wp.z < ROV_DEPTH_BAND.minZ || wp.z > ROV_DEPTH_BAND.maxZ)) {
        throw new RangeError(`${at}: ROV z ${wp.z} outside world underwater depth band`);
      }
      if (fixture.role === ROLES.DRONE && (wp.z < DRONE_ALTITUDE_BAND.minZ || wp.z > DRONE_ALTITUDE_BAND.maxZ)) {
        throw new RangeError(`${at}: drone z ${wp.z} outside world aerial survey band`);
      }
    });
  }
}

/** Build a frozen, self-consistent world-aligned scenario config for a seed. */
export function createScenarioConfig(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    throw new RangeError(`scenario seed must be an unsigned 32-bit integer, got ${seed}`);
  }
  validateRouteFixtures();
  return Object.freeze({
    scenarioId: SCENARIO_ID,
    worldRef: WORLD_REF,
    seed,
    stepMs: STEP_MS,
    bounds: SCENARIO_BOUNDS,
    robots: ROBOT_FIXTURES,
    fault: OPTICAL_VISIBILITY_FAULT,
    demoThresholds: DEMO_POLICY_THRESHOLDS,
  });
}
