/**
 * VORQYN lane-2 simulation kernel — seeded port scenario fixture.
 *
 * Scope: VQ-08-PREP (#20) only.
 *
 * EVERY number below is an explicit internal fixture value chosen for a
 * testable synthetic scenario. They are model parameters of a synthetic
 * simulator, NOT measurements of any physical harbour, and NOT physical
 * truth claims. docs/ARCHITECTURE.md §5 requires exactly this honesty:
 * "Uncertainty/coverage data is measurements or documented synthetic test
 * data".
 *
 * The demo thresholds at the bottom are illustrative values an external
 * policy evaluator (VQ-10) could use. The kernel itself NEVER accepts or
 * rejects evidence; it only produces measurements these thresholds can be
 * evaluated against. Do not treat them as the authoritative policy.
 */

export const SCENARIO_ID = "PORT-LOCAL-001";

/** Simulator clock: fixed integer step, independent of wall/chain time. */
export const STEP_MS = 500; // dyadic => dt = 0.5 s is exact in binary floating point

/**
 * Plan-view scenario bounds in the local ENU frame, metres.
 * Origin (0, 0, 0): south-west corner of the modelled quay area at the
 * documented waterline datum. z increases upward; underwater is negative z.
 */
export const SCENARIO_BOUNDS = Object.freeze({ minX: -200, maxX: 200, minY: -150, maxY: 150 });

/**
 * Depth band the ROV fixture operates in (metres, negative = below datum).
 * The ROV route and bounds keep it inside this band.
 */
export const ROV_DEPTH_BAND = Object.freeze({ minZ: -12, maxZ: -2 });

/** Altitude band the drone fixture operates in (metres above datum). */
export const DRONE_ALTITUDE_BAND = Object.freeze({ minZ: 15, maxZ: 45 });

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
 * Robot fixture definitions. Speeds and dt are dyadic so per-step motion is
 * exact in binary floating point (drone 2.0 m/step, rover 1.25, rov 0.6).
 */
export const ROBOT_FIXTURES = Object.freeze([
  Object.freeze({
    robotId: "drone-01",
    role: ROLES.DRONE,
    speedMps: 4,
    altitudeBand: DRONE_ALTITUDE_BAND,
    // Aerial survey loop above the quay, clockwise, constant z = 30 m.
    waypoints: Object.freeze([
      Object.freeze({ x: -120, y: -80, z: 30 }),
      Object.freeze({ x: 120, y: -80, z: 30 }),
      Object.freeze({ x: 120, y: 80, z: 30 }),
      Object.freeze({ x: -120, y: 80, z: 30 }),
    ]),
    taskRegion: Object.freeze({
      id: "aerial-obstruction-survey",
      box: Object.freeze({ minX: -120, maxX: 120, minY: -80, maxY: 80, minZ: 15, maxZ: 45 }),
      cellsX: 8,
      cellsY: 4,
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
    // Rover is a ground vehicle: z is fixed at the datum, 0 m.
    waypoints: Object.freeze([
      Object.freeze({ x: -150, y: -40, z: 0 }),
      Object.freeze({ x: 150, y: -40, z: 0 }),
      Object.freeze({ x: 150, y: 40, z: 0 }),
      Object.freeze({ x: -150, y: 40, z: 0 }),
    ]),
    taskRegion: Object.freeze({
      id: "dock-access-road",
      box: Object.freeze({ minX: -150, maxX: 150, minY: -40, maxY: 40, minZ: 0, maxZ: 0 }),
      cellsX: 8,
      cellsY: 4,
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
    // Underwater survey loop beneath the docks, constant z = -8 m.
    waypoints: Object.freeze([
      Object.freeze({ x: -80, y: -20, z: -8 }),
      Object.freeze({ x: 80, y: -20, z: -8 }),
      Object.freeze({ x: 80, y: 60, z: -8 }),
      Object.freeze({ x: -80, y: 60, z: -8 }),
    ]),
    taskRegion: Object.freeze({
      id: "submerged-obstruction-survey",
      box: Object.freeze({ minX: -80, maxX: 80, minY: -20, maxY: 60, minZ: -12, maxZ: -2 }),
      cellsX: 8,
      cellsY: 4,
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
 * accepts or rejects evidence and emits no verdicts.
 */
export const DEMO_POLICY_THRESHOLDS = Object.freeze({
  /** docs/ARCHITECTURE.md §6 example: optical evidence needs real quality. */
  opticalEvidenceQualityMin01: 0.5,
  /** Stricter "structural mapping" bar that the fixture sonar does NOT meet. */
  structuralSonarQualityMin01: 0.8,
});

/** Build a frozen, self-consistent scenario config for a given integer seed. */
export function createScenarioConfig(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    throw new RangeError(`scenario seed must be an unsigned 32-bit integer, got ${seed}`);
  }
  return Object.freeze({
    scenarioId: SCENARIO_ID,
    seed,
    stepMs: STEP_MS,
    bounds: SCENARIO_BOUNDS,
    robots: ROBOT_FIXTURES,
    fault: OPTICAL_VISIBILITY_FAULT,
    demoThresholds: DEMO_POLICY_THRESHOLDS,
  });
}
