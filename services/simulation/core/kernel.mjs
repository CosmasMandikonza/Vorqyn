/**
 * VORQYN lane-2 simulation kernel — deterministic scenario kernel.
 *
 * Scope: VQ-08-PREP (#20) only. Pure, dependency-free, no I/O.
 *
 * Purity contract (tested in determinism.test.mjs and provenance.test.mjs):
 * - No Math.random, no Date.now, no process, no network, no imports outside
 *   this directory. All state derives from the caller-supplied 32-bit seed.
 * - The only clock is the integer `simulatorTimeMs`, advanced by fixed
 *   STEP_MS increments. Wall-clock time, service event time and Solana
 *   confirmation time are deliberately absent from this module and from
 *   every value it emits; the simulator structurally cannot produce chain
 *   events or confirmations.
 *
 * Honesty contract (tested in lifecycle.test.mjs and provenance.test.mjs):
 * - Every emitted observation is labelled sourceKind "SYNTHETIC_SIM" with an
 *   explicit local ENU frameId and metre units.
 * - Paused, stopped, disconnected and stale states are explicit fields; a
 *   frozen pose is never re-labelled as fresh "live" telemetry.
 * - The kernel emits MEASUREMENTS only. It never accepts or rejects
 *   evidence, never issues verdicts, and has no policy authority; that
 *   belongs to the future external evaluator (VQ-10) and shared contracts
 *   (VQ-01 / #2). See README.md for the adapter boundary.
 *
 * Public-MissionEvent note: the observation snapshots below are internal,
 * model-independent debug/fixture views. They are deliberately NOT the
 * shared MissionEvent/MissionTask/ChainEvent schema and must only reach the
 * rest of the system through the future adapter described in README.md.
 */

import { createScenarioConfig, ROBOT_ROLES, SENSOR_KINDS } from "./scenario.mjs";
import { deriveSeed, createSymmetricNoise } from "./rng.mjs";
import { FRAME_ID, POSITION_UNITS, stepToward, planGridIndexOf } from "./enu.mjs";

export const SOURCE_KIND_SYNTHETIC_SIM = "SYNTHETIC_SIM";

const KERNEL_STATES = Object.freeze({
  RUNNING: "running",
  PAUSED: "paused",
  STOPPED: "stopped",
});

const LINK_STATES = Object.freeze({
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
});

const STALENESS = Object.freeze({
  NONE: "none",
  KERNEL_PAUSED: "kernel-paused",
  LINK_DISCONNECTED: "link-disconnected",
});

const COMMAND_TYPES = Object.freeze([
  "pause",
  "resume",
  "stop",
  "injectOpticalVisibilityFault",
  "clearOpticalVisibilityFault",
  "disconnectTelemetry",
  "reconnectTelemetry",
]);

/**
 * Strict per-command field schemas. Unknown or missing fields are rejected:
 * a caller can never smuggle in fields this kernel does not own — e.g. an
 * attempted `sourceKind` override, which would try to forge provenance.
 */
const COMMAND_FIELD_SCHEMAS = Object.freeze({
  pause: Object.freeze({ required: Object.freeze(["type", "idempotencyKey"]) }),
  resume: Object.freeze({ required: Object.freeze(["type", "idempotencyKey"]) }),
  stop: Object.freeze({ required: Object.freeze(["type", "idempotencyKey"]) }),
  injectOpticalVisibilityFault: Object.freeze({
    required: Object.freeze(["type", "idempotencyKey", "robotId", "severity", "durationMs"]),
  }),
  clearOpticalVisibilityFault: Object.freeze({ required: Object.freeze(["type", "idempotencyKey", "robotId"]) }),
  disconnectTelemetry: Object.freeze({ required: Object.freeze(["type", "idempotencyKey", "robotId"]) }),
  reconnectTelemetry: Object.freeze({ required: Object.freeze(["type", "idempotencyKey", "robotId"]) }),
});

/** Typed rejection for invalid commands (returned, not thrown). */
class KernelInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KernelInputError";
    this.code = code;
  }
}

/** Typed error for stepping a stopped kernel (thrown — programming error). */
export class KernelStoppedError extends Error {
  constructor(message = "simulation kernel is stopped; no further steps or movement are possible") {
    super(message);
    this.name = "KernelStoppedError";
    this.code = "kernel_stopped";
  }
}

export { KernelInputError };

/**
 * Create a deterministic scenario kernel for the fixed port fixture.
 *
 * @param {{ seed: number }} options seed: unsigned 32-bit integer.
 * @returns a kernel with step/issueCommand/getState/getObservationLog/
 *   getCommandAuditLog. All emitted values are deep-frozen.
 */
export function createScenarioKernel({ seed }) {
  const config = createScenarioConfig(seed);

  // ------------------------------------------------------------------
  // Mutable internal state (never handed out directly; snapshots only).
  // ------------------------------------------------------------------
  let kernelState = KERNEL_STATES.RUNNING;
  let stepCount = 0; // completed fixed steps
  let simulatorTimeMs = 0;
  let sequence = 0; // last emitted observation sequence number

  const robots = config.robots.map((fixture, robotIndex) => {
    const robot = {
      fixture,
      robotIndex,
      pose: { ...fixture.waypoints[0] },
      waypointIndex: 0,
      /** Ping-pong traversal direction: +1 outbound, -1 returning. */
      routeDirection: 1,
      linkState: LINK_STATES.CONNECTED,
      /** Simulator time of the last fresh sample for this robot (null before first step). */
      lastFreshSampleSimMs: null,
      /** Per-sensor noise streams; advanced once per fresh sample only. */
      noiseStreams: new Map(),
      /** Per-sensor visited-cell Sets over the robot's task region grid. */
      coverage: new Map(),
      /** Active optical fault or null. */
      activeFault: null,
      /** Completed fault records for audit. */
      faultHistory: [],
    };
    for (const sensor of fixture.sensors) {
      const streamSeed = deriveSeed(seed, 0x5eed0001, robotIndex, sensorIndex(fixture, sensor));
      robot.noiseStreams.set(sensor.sensorId, createSymmetricNoise(streamSeed));
      robot.coverage.set(sensor.sensorId, new Set());
    }
    return robot;
  });

  function sensorIndex(fixture, sensor) {
    return fixture.sensors.indexOf(sensor);
  }

  /** Idempotency keys already consumed, command-type scoped: `${type}\u0000${key}`. */
  const idempotencyKeys = new Map();
  /** Ordered audit of accepted commands (includes results; for inspection). */
  const commandAudit = [];
  /**
   * Ordered replay tape: every step() call and every state-changing
   * command, in call order. This is what deterministic replay executes;
   * a command-only log cannot reproduce paused heartbeat steps.
   */
  const runTrace = [];
  /** Ordered observation snapshots (frozen). */
  const observationLog = [];

  // Sonar range-ring grids: precomputed deterministic cell centres per robot.
  const sonarGrids = new Map();
  for (const robot of robots) {
    const region = robot.fixture.taskRegion;
    const centres = [];
    const spanX = region.box.maxX - region.box.minX;
    const spanY = region.box.maxY - region.box.minY;
    for (let iy = 0; iy < region.cellsY; iy += 1) {
      for (let ix = 0; ix < region.cellsX; ix += 1) {
        centres.push({
          x: region.box.minX + ((ix + 0.5) * spanX) / region.cellsX,
          y: region.box.minY + ((iy + 0.5) * spanY) / region.cellsY,
        });
      }
    }
    sonarGrids.set(robot.fixture.robotId, centres);
  }

  // ------------------------------------------------------------------
  // Command handling
  // ------------------------------------------------------------------

  /**
   * Validate and apply a control command. Returns a result object; invalid
   * input yields `{ ok: false, failure: { code, message } }` rather than a
   * throw, so command streams can be replayed verbatim. Accepted commands
   * are recorded in the audit log with the step index they were applied at,
   * which is what makes replay bit-reproducible.
   *
   * @param command one of COMMAND_TYPES (see README.md for schemas)
   */
  function issueCommand(command) {
    if (command === null || typeof command !== "object" || Array.isArray(command)) {
      return failure("malformed_command", "command must be a plain object");
    }
    const { type } = command;
    if (typeof type !== "string" || !COMMAND_TYPES.includes(type)) {
      return failure("unknown_command", `unknown command type: ${JSON.stringify(type ?? null)}`);
    }
    try {
      return dispatchCommand(command, type);
    } catch (error) {
      if (error instanceof KernelInputError) {
        return failure(error.code, error.message);
      }
      throw error;
    }
  }

  function dispatchCommand(command, type) {
    validateCommandFields(command, type);
    // Idempotency check happens before state validation so a retried
    // command that is now (correctly) invalid as a re-application still
    // resolves to its original outcome exactly once.
    const keyScope = `${type}\u0000${requireIdempotencyKey(command)}`;
    if (idempotencyKeys.has(keyScope)) {
      return { ok: true, duplicate: true, original: idempotencyKeys.get(keyScope) };
    }

    switch (type) {
      case "pause":
        return applyPause(command, keyScope);
      case "resume":
        return applyResume(command, keyScope);
      case "stop":
        return applyStop(command, keyScope);
      case "injectOpticalVisibilityFault":
        return applyInjectFault(command, keyScope);
      case "clearOpticalVisibilityFault":
        return applyClearFault(command, keyScope);
      case "disconnectTelemetry":
        return applySetLink(command, keyScope, LINK_STATES.DISCONNECTED);
      case "reconnectTelemetry":
        return applySetLink(command, keyScope, LINK_STATES.CONNECTED);
      default:
        return failure("unknown_command", `unhandled command type: ${type}`);
    }
  }

  function validateCommandFields(command, type) {
    const schema = COMMAND_FIELD_SCHEMAS[type];
    const present = new Set(Object.keys(command));
    for (const field of schema.required) {
      if (!present.has(field)) {
        throw new KernelInputError("invalid_command_fields", `command ${type} is missing required field: ${field}`);
      }
    }
    for (const field of present) {
      if (!schema.required.includes(field)) {
        throw new KernelInputError(
          "invalid_command_fields",
          `command ${type} has unexpected field: ${field}; allowed fields: ${schema.required.join(", ")}`,
        );
      }
    }
  }

  function requireIdempotencyKey(command) {
    const { idempotencyKey } = command;
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > 128) {
      throw new KernelInputError(
        "invalid_idempotency_key",
        "idempotencyKey must be a non-empty string of at most 128 characters",
      );
    }
    return idempotencyKey;
  }

  function applyPause(_command, keyScope) {
    if (kernelState !== KERNEL_STATES.RUNNING) {
      return failure("invalid_transition", `pause is only valid while running (state: ${kernelState})`);
    }
    kernelState = KERNEL_STATES.PAUSED;
    return accept(_command, keyScope, { kernelState });
  }

  function applyResume(_command, keyScope) {
    if (kernelState !== KERNEL_STATES.PAUSED) {
      return failure("invalid_transition", `resume is only valid while paused (state: ${kernelState})`);
    }
    kernelState = KERNEL_STATES.RUNNING;
    return accept(_command, keyScope, { kernelState });
  }

  function applyStop(_command, keyScope) {
    if (kernelState === KERNEL_STATES.STOPPED) {
      return failure("invalid_transition", "kernel is already stopped");
    }
    kernelState = KERNEL_STATES.STOPPED;
    return accept(_command, keyScope, { kernelState });
  }

  function applyInjectFault(command, keyScope) {
    if (kernelState !== KERNEL_STATES.RUNNING) {
      return failure("invalid_transition", `fault injection is only valid while running (state: ${kernelState})`);
    }
    const robot = requireRobot(command.robotId);
    if (robot.fixture.role !== ROBOT_ROLES.ROV) {
      return failure(
        "fault_target_invalid",
        `optical visibility fault applies only to the underwater role (${ROBOT_ROLES.ROV}), got role ${robot.fixture.role}`,
      );
    }
    const severityName = command.severity;
    const severity = config.fault.severities[severityName];
    if (severity === undefined || typeof severityName !== "string") {
      return failure(
        "invalid_fault_severity",
        `severity must be one of ${Object.keys(config.fault.severities).join(", ")}, got ${JSON.stringify(severityName ?? null)}`,
      );
    }
    const { durationMs } = command;
    if (!Number.isInteger(durationMs) || durationMs < config.fault.minDurationMs || durationMs > config.fault.maxDurationMs) {
      return failure(
        "invalid_fault_duration",
        `durationMs must be an integer between ${config.fault.minDurationMs} and ${config.fault.maxDurationMs}, got ${JSON.stringify(durationMs ?? null)}`,
      );
    }
    if (robot.activeFault !== null) {
      return failure(
        "fault_already_active",
        `robot ${robot.fixture.robotId} already has an active optical visibility fault; injecting again would double-apply the degradation`,
      );
    }

    const fault = deepFreeze({
      faultId: `fault-${robot.fixture.robotId}-${commandAudit.length + 1}`,
      robotId: robot.fixture.robotId,
      kind: config.fault.kind,
      severity: severityName,
      opticalQualityFactor: severity.opticalQualityFactor,
      durationMs,
      startedAtSimMs: simulatorTimeMs,
      startedAtStep: stepCount,
      expiresAtSimMs: simulatorTimeMs + durationMs,
      clearedAtSimMs: null,
      endState: "active",
    });
    robot.activeFault = fault;
    return accept(command, keyScope, { fault });
  }

  function applyClearFault(command, keyScope) {
    if (kernelState !== KERNEL_STATES.RUNNING) {
      return failure("invalid_transition", `fault clearing is only valid while running (state: ${kernelState})`);
    }
    const robot = requireRobot(command.robotId);
    if (robot.fixture.role !== ROBOT_ROLES.ROV) {
      return failure(
        "fault_target_invalid",
        `optical visibility fault applies only to the underwater role (${ROBOT_ROLES.ROV}), got role ${robot.fixture.role}`,
      );
    }
    if (robot.activeFault === null) {
      // Clearing an already-clear state is a no-op success (idempotent).
      return accept(command, keyScope, { cleared: false, reason: "no_active_fault" });
    }
    const cleared = deepFreeze({
      ...robot.activeFault,
      clearedAtSimMs: simulatorTimeMs,
      endState: "cleared",
    });
    robot.activeFault = null;
    robot.faultHistory.push(cleared);
    return accept(command, keyScope, { cleared: true, fault: cleared });
  }

  function applySetLink(command, keyScope, targetLinkState) {
    if (kernelState === KERNEL_STATES.STOPPED) {
      return failure("invalid_transition", "telemetry link commands are not valid after stop");
    }
    const robot = requireRobot(command.robotId);
    if (robot.linkState === targetLinkState) {
      // Setting a link to its current state is a no-op success (idempotent).
      return accept(command, keyScope, { linkState: targetLinkState, changed: false });
    }
    robot.linkState = targetLinkState;
    // Note: lastFreshSampleSimMs is deliberately NOT touched here. A fresh
    // sample only exists when an observation is actually emitted for a
    // connected robot; reconnection resumes from the frozen
    // last-authoritative pose and does not retroactively claim freshness.
    return accept(command, keyScope, { linkState: targetLinkState, changed: true });
  }

  function requireRobot(robotId) {
    if (typeof robotId !== "string") {
      throw new KernelInputError("unknown_robot", `robotId must be a string, got ${JSON.stringify(robotId ?? null)}`);
    }
    const robot = robots.find((r) => r.fixture.robotId === robotId);
    if (robot === undefined) {
      throw new KernelInputError(
        "unknown_robot",
        `unknown robotId: ${JSON.stringify(robotId)} (known: ${config.robots.map((r) => r.robotId).join(", ")})`,
      );
    }
    return robot;
  }

  function accept(command, keyScope, result) {
    const record = deepFreeze({
      stepIndex: stepCount,
      simulatorTimeMs,
      sequenceBefore: sequence,
      command: deepFreeze({ ...command }),
      result: deepFreeze(result),
    });
    idempotencyKeys.set(keyScope, record);
    commandAudit.push(record);
    runTrace.push(deepFreeze({ op: "command", command: record.command }));
    return { ok: true, duplicate: false, ...result };
  }

  function failure(code, message) {
    return { ok: false, failure: { code, message } };
  }

  // ------------------------------------------------------------------
  // Time stepping
  // ------------------------------------------------------------------

  /**
   * Advance the simulation by n fixed steps of STEP_MS of simulator time.
   * Returns the LAST observation snapshot of the call.
   *
   * - While running: integrates motion (connected robots only), accumulates
   *   coverage, computes measurements, advances the simulator clock.
   * - While paused: advances NOTHING — same clock, same poses — and emits a
   *   frozen snapshot explicitly labelled "kernel-paused" / not fresh.
   * - While stopped: throws KernelStoppedError (no phantom movement).
   */
  function step(n = 1) {
    if (!Number.isInteger(n) || n < 1 || n > 100000) {
      throw new RangeError(`step count must be an integer in [1, 100000], got ${n}`);
    }
    if (kernelState === KERNEL_STATES.STOPPED) {
      throw new KernelStoppedError();
    }
    runTrace.push(deepFreeze({ op: "step", count: n }));
    let last = null;
    for (let i = 0; i < n; i += 1) {
      last = stepOnce();
    }
    return last;
  }

  function stepOnce() {
    if (kernelState === KERNEL_STATES.PAUSED) {
      // Frozen, honestly-labelled heartbeat: no clock advance, no motion,
      // no coverage growth, no measurement updates.
      return emitObservation({ paused: true });
    }
    // --- advance world state ---
    const previousSimMs = simulatorTimeMs;
    for (const robot of robots) {
      if (robot.linkState === LINK_STATES.DISCONNECTED) {
        // Telemetry authority lost: the robot's reported state freezes. We
        // neither integrate motion nor fabricate an extrapolated pose.
        continue;
      }
      integrateMotion(robot);
    }
    simulatorTimeMs = previousSimMs + config.stepMs;
    stepCount += 1;
    // Fault expiry is a pure function of simulator time: a fault affects a
    // step whose starting time is still before its expiry time.
    for (const robot of robots) {
      if (robot.activeFault !== null && previousSimMs >= robot.activeFault.expiresAtSimMs) {
        robot.faultHistory.push(deepFreeze({ ...robot.activeFault, endState: "expired" }));
        robot.activeFault = null;
      }
    }
    return emitObservation({ paused: false });
  }

  function integrateMotion(robot) {
    const dtSeconds = config.stepMs / 1000;
    const maxStepM = robot.fixture.speedMps * dtSeconds;
    const target = robot.fixture.waypoints[robot.waypointIndex];
    const { position, arrived } = stepToward(robot.pose, target, maxStepM);
    robot.pose = position;
    if (arrived) {
      // World-aligned routes (#24) are out-and-back survey paths, traversed
      // ping-pong: forward to the last waypoint, then reversed. A closed
      // loop wrap-around would teleport the vehicle across the world, which
      // the no-teleport invariant forbids.
      if (robot.fixture.routeMode === "ping-pong") {
        if (robot.waypointIndex === robot.fixture.waypoints.length - 1) {
          robot.routeDirection = -1;
        } else if (robot.waypointIndex === 0) {
          robot.routeDirection = 1;
        }
        robot.waypointIndex += robot.routeDirection;
      } else {
        robot.waypointIndex = (robot.waypointIndex + 1) % robot.fixture.waypoints.length;
      }
    }
  }

  // ------------------------------------------------------------------
  // Measurement and observation construction
  // ------------------------------------------------------------------

  function emitObservation({ paused }) {
    sequence += 1;
    const robotViews = robots.map((robot) => buildRobotView(robot, paused));
    const snapshot = deepFreeze({
      sequence,
      simulatorTimeMs,
      stepIndex: stepCount,
      kernelState: paused ? KERNEL_STATES.PAUSED : kernelState,
      appliedStepMs: paused ? 0 : config.stepMs,
      robots: robotViews,
      provenance: deepFreeze({
        sourceKind: SOURCE_KIND_SYNTHETIC_SIM,
        scenarioId: config.scenarioId,
        seed: config.seed,
        frameId: FRAME_ID,
        positionUnits: POSITION_UNITS,
        simulatorClock: "fixed-step-simulator-time",
      }),
    });
    observationLog.push(snapshot);
    return snapshot;
  }

  function buildRobotView(robot, paused) {
    const disconnected = robot.linkState === LINK_STATES.DISCONNECTED;
    const fresh = !paused && !disconnected;
    const staleness = paused ? STALENESS.KERNEL_PAUSED : disconnected ? STALENESS.LINK_DISCONNECTED : STALENESS.NONE;
    if (fresh) {
      robot.lastFreshSampleSimMs = simulatorTimeMs;
    }
    const fault = robot.activeFault;
    const faultView =
      fault === null
        ? null
        : deepFreeze({
            faultId: fault.faultId,
            kind: fault.kind,
            severity: fault.severity,
            startedAtSimMs: fault.startedAtSimMs,
            expiresAtSimMs: fault.expiresAtSimMs,
          });
    return deepFreeze({
      robotId: robot.fixture.robotId,
      role: robot.fixture.role,
      pose: deepFreeze({
        x: round6(robot.pose.x),
        y: round6(robot.pose.y),
        z: round6(robot.pose.z),
      }),
      waypointIndex: robot.waypointIndex,
      speedMps: robot.fixture.speedMps,
      linkState: robot.linkState,
      fresh,
      staleness,
      staleSinceSimMs: fresh ? null : robot.lastFreshSampleSimMs,
      activeOpticalFault: faultView,
      sensors: robot.fixture.sensors.map((sensor) => buildSensorView(robot, sensor, { paused, disconnected })),
    });
  }

  function buildSensorView(robot, sensor, { paused, disconnected }) {
    const visited = robot.coverage.get(sensor.sensorId);
    const totalCells = robot.fixture.taskRegion.cellsX * robot.fixture.taskRegion.cellsY;
    if (paused || disconnected) {
      // No new measurement exists: report coverage-so-far with no quality
      // sample at all, so a consumer cannot mistake a frozen state for a
      // fresh reading.
      return deepFreeze({
        sensorId: sensor.sensorId,
        kind: sensor.kind,
        measured: null,
        coverage: coverageView(visited, totalCells),
      });
    }
    const measuredQuality = measureQuality(robot, sensor);
    if (sensor.coverageModel === "range-ring") {
      accumulateRangeRing(robot, visited);
    } else {
      accumulateInCell(robot, visited);
    }
    const opticalFaultFactor =
      sensor.kind === SENSOR_KINDS.OPTICAL && robot.activeFault !== null ? robot.activeFault.opticalQualityFactor : null;
    return deepFreeze({
      sensorId: sensor.sensorId,
      kind: sensor.kind,
      measured: deepFreeze({
        quality01: measuredQuality,
        qualityUnits: "unitless_0_to_1_fixture_model",
        opticalVisibilityFactorApplied: opticalFaultFactor,
      }),
      coverage: coverageView(visited, totalCells),
    });
  }

  /** Deterministic per-sample quality measurement, including fault effect. */
  function measureQuality(robot, sensor) {
    const noise = robot.noiseStreams.get(sensor.sensorId);
    let quality = sensor.baselineQuality01 + noise() * sensor.qualityNoise01;
    if (sensor.kind === SENSOR_KINDS.OPTICAL && robot.activeFault !== null) {
      quality *= robot.activeFault.opticalQualityFactor;
    }
    return round6(Math.min(1, Math.max(0, quality)));
  }

  function accumulateInCell(robot, visited) {
    const region = robot.fixture.taskRegion;
    const cell = planGridIndexOf(robot.pose, region.box, region.cellsX, region.cellsY);
    if (cell >= 0) {
      visited.add(cell);
    }
  }

  function accumulateRangeRing(robot, visited) {
    const sensor = robot.fixture.sensors.find((s) => s.coverageModel === "range-ring");
    const centres = sonarGrids.get(robot.fixture.robotId);
    for (let i = 0; i < centres.length; i += 1) {
      const dx = robot.pose.x - centres[i].x;
      const dy = robot.pose.y - centres[i].y;
      if (Math.sqrt(dx * dx + dy * dy) <= sensor.rangeM) {
        visited.add(i);
      }
    }
  }

  function coverageView(visited, totalCells) {
    return deepFreeze({
      modelCellsVisited: visited.size,
      modelCellsTotal: totalCells,
      coverage01: round6(visited.size / totalCells),
    });
  }

  // ------------------------------------------------------------------
  // Read-only accessors
  // ------------------------------------------------------------------

  /** Full current state snapshot (frozen, rounded like observations). */
  function getState() {
    return deepFreeze({
      kernelState,
      stepIndex: stepCount,
      simulatorTimeMs,
      sequence,
      scenarioId: config.scenarioId,
      seed: config.seed,
      stepMs: config.stepMs,
      robots: robots.map((robot) => ({
        robotId: robot.fixture.robotId,
        role: robot.fixture.role,
        pose: {
          x: round6(robot.pose.x),
          y: round6(robot.pose.y),
          z: round6(robot.pose.z),
        },
        waypointIndex: robot.waypointIndex,
        linkState: robot.linkState,
        activeOpticalFault: robot.activeFault,
        faultHistory: [...robot.faultHistory],
      })),
    });
  }

  // Return immutable snapshots of the log arrays, never the live mutable
  // storage. Individual records are already deeply frozen when recorded.
  // A consumer must not be able to splice, append or reorder authoritative
  // observation/audit/replay history through a read-only accessor.
  function getObservationLog() {
    return Object.freeze([...observationLog]);
  }

  function getCommandAuditLog() {
    return Object.freeze([...commandAudit]);
  }

  /** The ordered step/command tape that replayScenario executes. */
  function getRunTrace() {
    return Object.freeze([...runTrace]);
  }

  return deepFreeze({
    config,
    step,
    issueCommand,
    getState,
    getObservationLog,
    getCommandAuditLog,
    getRunTrace,
  });
}

/**
 * Deterministic replay: rebuild a kernel from a recorded seed + run trace
 * (getRunTrace()) and execute every recorded step() call and accepted
 * command in call order. Produces an observation stream deep-equal to the
 * original run's, including frozen heartbeats emitted while paused
 * (tested in determinism.test.mjs).
 *
 * A command-only log is NOT sufficient for exact replay because the number
 * of step() calls made while paused — which emit real frozen snapshots —
 * is invisible to it. That is why replay consumes the operation trace.
 *
 * @param {{ seed: number, trace: Array<{op: "step", count: number} | {op: "command", command: object}> }} params
 */
export function replayScenario({ seed, trace }) {
  if (!Array.isArray(trace)) {
    throw new TypeError("trace must be an array of {op, ...} entries from getRunTrace()");
  }
  const kernel = createScenarioKernel({ seed });
  for (const entry of trace) {
    if (entry === null || typeof entry !== "object") {
      throw new TypeError("trace entries must be plain objects");
    }
    if (entry.op === "step") {
      kernel.step(entry.count);
    } else if (entry.op === "command") {
      const outcome = kernel.issueCommand(entry.command);
      if (outcome.ok !== true) {
        throw new Error(
          `replay failed to re-apply a recorded command: ${outcome.failure.code}: ${outcome.failure.message}`,
        );
      }
      if (outcome.duplicate === true) {
        throw new Error("replay hit an unexpected duplicate idempotency key in a well-formed trace");
      }
    } else {
      throw new TypeError(`unknown trace op: ${JSON.stringify(entry.op ?? null)}`);
    }
  }
  return kernel;
}

// ----------------------------------------------------------------------
// Local helpers
// ----------------------------------------------------------------------

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

/** Structural deep freeze so emitted snapshots cannot be mutated in place. */
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}
