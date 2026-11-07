/**
 * VQ-DEMO-SIM/1 transport tests (issue #32) — run through the REAL Next.js
 * route handler (`app/api/demo/simulation/route.ts`) executing the REAL
 * aligned kernel (`services/simulation/core/**`). No mocks anywhere.
 *
 * Mandatory proofs:
 *   1. Identical input gives identical results.
 *   2. Genuine optical-quality degradation after the fault (measured, not a label).
 *   3. Duplicate idempotency keys do not apply a second fault.
 *   4. Pause and disconnect do not produce fabricated fresh readings.
 *   5. Bad commands are rejected without corrupting the replay trace.
 *   6. Separate guest requests cannot affect one another.
 *   (Proof 7 — the endpoint works from a real built Next.js server — is
 *   exercised by tests/demo-simulation-api/real-server-check.mjs against
 *   `next build && next start` and is recorded in the PR evidence.)
 *
 * Run: pnpm --filter @vorqyn/web test   (or: npx vitest run from apps/web)
 */

import { describe, expect, it } from "vitest";
import { POST, GET } from "@/app/api/demo/simulation/route";
import { DEFAULT_DEMO_SEED, ERROR_SCHEMA, LIMITS, REQUEST_SCHEMA, RESPONSE_SCHEMA } from "@/lib/demo-simulation/contract";

const ROUTE = "http://localhost/api/demo/simulation";

function post(body: string): Promise<Response> {
  return POST(new Request(ROUTE, { method: "POST", body }));
}

function json(body: unknown): string {
  return JSON.stringify(body);
}

async function expectError(response: Response, status: number, code: string): Promise<Record<string, unknown>> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const payload = (await response.json()) as Record<string, unknown>;
  expect(payload.schema).toBe(ERROR_SCHEMA);
  const error = payload.error as Record<string, unknown>;
  expect(typeof error.code).toBe("string");
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe("string");
  // No stack traces or internals in error bodies.
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toMatch(/at\s+\S+\(|node_modules|stack/i);
  return payload;
}

/** The issue's canonical severe-fault trace, used by several proofs. */
function faultTrace(): unknown {
  return {
    schema: REQUEST_SCHEMA,
    seed: DEFAULT_DEMO_SEED,
    operations: [
      { op: "step", count: 10 },
      {
        op: "command",
        command: {
          type: "injectOpticalVisibilityFault",
          robotId: "rov-01",
          severity: "severe",
          durationMs: 9000,
          idempotencyKey: "guest-optical-1",
        },
      },
      { op: "step", count: 3 },
    ],
  };
}

describe("VQ-DEMO-SIM/1 POST /api/demo/simulation — happy path", () => {
  it("returns a valid fresh scenario for an empty trace (start/reset)", async () => {
    const response = await post(json({ schema: REQUEST_SCHEMA, seed: DEFAULT_DEMO_SEED, operations: [] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.schema).toBe(RESPONSE_SCHEMA);
    expect(body.scenarioId).toBe("PORT-001");
    expect(body.seed).toBe(DEFAULT_DEMO_SEED);
    expect(body.sourceKind).toBe("SYNTHETIC_SIM");
    expect(body.frameId).toBe("ENU_PORT-001_LOCAL");
    expect(body.positionUnits).toBe("m");
    expect(body.stepMs).toBe(500);
    expect(body.operations).toEqual([]);
    expect(body.snapshots).toEqual([]); // no observation exists before the first step

    const state = body.state as Record<string, unknown>;
    expect(state.kernelState).toBe("running");
    expect(state.simulatorTimeMs).toBe(0);
    const robots = state.robots as Array<Record<string, unknown>>;
    expect(robots.map((r) => r.robotId)).toEqual(["drone-01", "rover-01", "rov-01"]);
    // World-aligned starting poses (issue #24): each vehicle at its world anchor.
    expect(robots.find((r) => r.robotId === "rover-01")?.pose).toEqual({ x: -160, y: 160, z: 4.05 });
    expect(robots.find((r) => r.robotId === "rov-01")?.pose).toEqual({ x: 60, y: -10, z: -2.5 });
    expect(robots.find((r) => r.robotId === "drone-01")?.pose).toEqual({ x: -40, y: 80, z: 55 });
  });

  it("replays ten real kernel steps with strictly ordered snapshots and physical ENU poses", async () => {
    const response = await post(json({ schema: REQUEST_SCHEMA, operations: [{ op: "step", count: 10 }] }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    const snapshots = body.snapshots as Array<Record<string, unknown>>;
    expect(snapshots).toHaveLength(10);
    let previousSequence = 0;
    let previousTime = 0;
    for (const [index, snapshot] of snapshots.entries()) {
      expect(snapshot.sequence).toBe(index + 1);
      expect(snapshot.sequence).toBeGreaterThan(previousSequence);
      expect(snapshot.simulatorTimeMs).toBe((index + 1) * 500);
      expect(snapshot.simulatorTimeMs).toBeGreaterThan(previousTime);
      expect(snapshot.kernelState).toBe("running");
      const provenance = snapshot.provenance as Record<string, unknown>;
      expect(provenance.sourceKind).toBe("SYNTHETIC_SIM");
      expect(provenance.frameId).toBe("ENU_PORT-001_LOCAL");
      previousSequence = snapshot.sequence as number;
      previousTime = snapshot.simulatorTimeMs as number;
    }
    // Movement actually happened on the world routes, at deck height.
    // Kernel nuance: the rover's pose starts AT waypoint 0 (its home), so
    // step 1 is a zero-distance arrival that flips the target to waypoint 1;
    // nine movement steps × 1.25 m = 11.25 m east from the home anchor.
    const lastRover = (snapshots[9] as Record<string, unknown>).robots as Array<Record<string, unknown>>;
    const rover = lastRover.find((r) => r.robotId === "rover-01") as Record<string, unknown>;
    expect(rover.pose).toEqual({ x: -148.75, y: 160, z: 4.05 });
    const state = body.state as Record<string, unknown>;
    expect(state.simulatorTimeMs).toBe(5000);
  });

  it("proof 1: identical input gives identical results", async () => {
    const bodyText = json(faultTrace());
    const first = await post(bodyText);
    const second = await post(bodyText);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstText = JSON.stringify(await first.json());
    const secondText = JSON.stringify(await second.json());
    expect(secondText).toBe(firstText);
  });

  it("proof 2: the fault genuinely degrades measured optical quality; sonar is independent", async () => {
    const response = await post(json(faultTrace()));
    const body = (await response.json()) as Record<string, unknown>;
    const snapshots = body.snapshots as Array<Record<string, unknown>>;

    const optical: number[] = [];
    const sonar: number[] = [];
    const factors: Array<number | null> = [];
    for (const snapshot of snapshots) {
      const rov = (snapshot.robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rov-01") as Record<string, unknown>;
      const sensors = rov.sensors as Array<Record<string, unknown>>;
      const opticalSensor = sensors.find((s) => s.sensorId === "rov-01-optical") as Record<string, unknown>;
      const sonarSensor = sensors.find((s) => s.sensorId === "rov-01-sonar") as Record<string, unknown>;
      if (opticalSensor.measured !== null) {
        const measured = opticalSensor.measured as Record<string, unknown>;
        optical.push(measured.quality01 as number);
        factors.push(measured.opticalVisibilityFactorApplied as number | null);
      }
      const sonarMeasured = (sonarSensor.measured as Record<string, unknown> | null);
      if (sonarMeasured !== null) sonar.push(sonarMeasured.quality01 as number);
    }
    // 10 clean samples, then the fault applies for every subsequent sample.
    expect(optical).toHaveLength(13);
    expect(factors.slice(0, 10)).toEqual(Array(10).fill(null));
    expect(factors.slice(10)).toEqual(Array(3).fill(0.12));
    // Clean samples hug the 0.71 fixture baseline; faulted samples collapse
    // below 0.09 — a MEASURED change far beyond the ±0.02 noise band.
    for (const q of optical.slice(0, 10)) expect(q).toBeGreaterThan(0.69);
    for (const q of optical.slice(10)) expect(q).toBeLessThan(0.09);
    // Sonar is unaffected: steady around its own 0.63 fixture.
    for (const q of sonar) expect(q).toBeGreaterThan(0.6);
    expect(sonar).toHaveLength(13);
    // The transport did NOT add any verdict: degraded samples carry no acceptance field.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/"accepted"|"verdict"|"evidenceStatus"|"recommendation"/);
  });

  it("proof 3: duplicate idempotency key does not apply a second fault", async () => {
    const response = await post(
      json({
        schema: REQUEST_SCHEMA,
        operations: [
          { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 9000, idempotencyKey: "dup-1" } },
          { op: "step", count: 1 },
          { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 9000, idempotencyKey: "dup-1" } },
          { op: "step", count: 1 },
        ],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const commandResults = body.commandResults as Array<Record<string, unknown>>;
    expect(commandResults).toHaveLength(2);
    expect(commandResults[0]).toEqual({ operationIndex: 0, ok: true, duplicate: false, failure: null });
    expect(commandResults[1]).toEqual({ operationIndex: 2, ok: true, duplicate: true, failure: null });
    // Exactly one fault window: quality degrades once, from the first step,
    // with no second application after the duplicate.
    const snapshots = body.snapshots as Array<Record<string, unknown>>;
    expect(snapshots).toHaveLength(2);
    for (const snapshot of snapshots) {
      const rov = (snapshot.robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rov-01") as Record<string, unknown>;
      const optical = (rov.sensors as Array<Record<string, unknown>>).find((s) => s.sensorId === "rov-01-optical") as Record<string, unknown>;
      const measured = optical.measured as Record<string, unknown>;
      expect(measured.opticalVisibilityFactorApplied).toBe(0.12);
      expect(measured.quality01 as number).toBeLessThan(0.09);
    }
  });
});

describe("lifecycle honesty", () => {
  it("proof 4: paused and disconnected states produce no fabricated fresh readings", async () => {
    const response = await post(
      json({
        schema: REQUEST_SCHEMA,
        operations: [
          { op: "step", count: 2 },
          { op: "command", command: { type: "pause", idempotencyKey: "pause-1" } },
          { op: "step", count: 2 },
          { op: "command", command: { type: "resume", idempotencyKey: "resume-1" } },
          { op: "command", command: { type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "disc-1" } },
          { op: "step", count: 2 },
        ],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const snapshots = body.snapshots as Array<Record<string, unknown>>;
    expect(snapshots).toHaveLength(6);

    // Paused heartbeats (3, 4): clock frozen, sensors carry no measurement.
    for (const index of [2, 3]) {
      const snapshot = snapshots[index] as Record<string, unknown>;
      expect(snapshot.kernelState).toBe("paused");
      expect(snapshot.simulatorTimeMs).toBe(1000); // frozen
      const rov = (snapshot.robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rov-01") as Record<string, unknown>;
      expect(rov.staleness).toBe("kernel-paused");
      for (const sensor of rov.sensors as Array<Record<string, unknown>>) {
        expect(sensor.measured).toBeNull();
      }
    }
    // Disconnected heartbeats (5, 6): link-down labels, stale, measured null.
    for (const index of [4, 5]) {
      const snapshot = snapshots[index] as Record<string, unknown>;
      const rov = (snapshot.robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rov-01") as Record<string, unknown>;
      expect(rov.linkState).toBe("disconnected");
      expect(rov.fresh).toBe(false);
      expect(rov.staleness).toBe("link-disconnected");
      expect(rov.staleSinceSimMs).toBe(1000); // last fresh sample before disconnect (snapshot 2, t=1000ms)
      for (const sensor of rov.sensors as Array<Record<string, unknown>>) {
        expect(sensor.measured).toBeNull();
      }
      // Other robots remain connected and fresh.
      const rover = (snapshot.robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rover-01") as Record<string, unknown>;
      expect(rover.fresh).toBe(true);
      expect(rover.staleness).toBe("none");
    }
  });
});

describe("validation and kernel rejections", () => {
  it("proof 5: bad commands are rejected (422) and never enter a replayable trace", async () => {
    // A structurally valid command the KERNEL rejects: fault on the drone.
    const response = await post(
      json({
        schema: REQUEST_SCHEMA,
        operations: [
          { op: "step", count: 2 },
          { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "drone-01", severity: "severe", durationMs: 9000, idempotencyKey: "bad-target" } },
        ],
      }),
    );
    await expectError(response, 422, "fault_target_invalid");

    // A fresh request with a clean trace still replays identically: nothing
    // about the rejected operation leaked into kernel/transport state.
    const after = await post(json({ schema: REQUEST_SCHEMA, operations: [{ op: "step", count: 2 }] }));
    expect(after.status).toBe(200);
    const body = (await after.json()) as Record<string, unknown>;
    expect((body.snapshots as unknown[]).length).toBe(2);
    expect(body.commandResults).toEqual([]);
  });

  it("invalid transitions, stopped scenarios and unknown robots are typed 422s", async () => {
    const resumeWhileRunning = await post(json({ schema: REQUEST_SCHEMA, operations: [{ op: "command", command: { type: "resume", idempotencyKey: "r1" } }] }));
    await expectError(resumeWhileRunning, 422, "invalid_transition");

    const unknownRobot = await post(
      json({ schema: REQUEST_SCHEMA, operations: [{ op: "command", command: { type: "disconnectTelemetry", robotId: "nope-01", idempotencyKey: "r2" } }] }),
    );
    await expectError(unknownRobot, 422, "unknown_robot");

    const stopThenStep = await post(
      json({
        schema: REQUEST_SCHEMA,
        operations: [
          { op: "command", command: { type: "stop", idempotencyKey: "s1" } },
          { op: "step", count: 1 },
        ],
      }),
    );
    await expectError(stopThenStep, 422, "kernel_stopped");

    const stopThenPause = await post(
      json({
        schema: REQUEST_SCHEMA,
        operations: [
          { op: "command", command: { type: "stop", idempotencyKey: "s2" } },
          { op: "command", command: { type: "pause", idempotencyKey: "s3" } },
        ],
      }),
    );
    await expectError(stopThenPause, 422, "invalid_transition");

    const badSeverity = await post(
      json({ schema: REQUEST_SCHEMA, operations: [{ op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "apocalyptic", durationMs: 9000, idempotencyKey: "s4" } }] }),
    );
    await expectError(badSeverity, 422, "invalid_fault_severity");

    const badDuration = await post(
      json({ schema: REQUEST_SCHEMA, operations: [{ op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 999999, idempotencyKey: "s5" } }] }),
    );
    await expectError(badDuration, 422, "invalid_fault_duration");

    const badFields = await post(
      json({ schema: REQUEST_SCHEMA, operations: [{ op: "command", command: { type: "pause", idempotencyKey: "s6", sourceKind: "GENUINE_SITL" } }] }),
    );
    await expectError(badFields, 422, "invalid_command_fields");
  });

  it("malformed payloads, unknown fields, forged provenance and bad ops are typed 400s", async () => {
    await expectError(await post("{not json"), 400, "invalid_json");
    await expectError(await post(json({ schema: "vorqyn.demo-sim/request/2", operations: [] })), 400, "schema_unsupported");
    await expectError(await post(json({ operations: [] })), 400, "schema_unsupported");
    await expectError(await post(json({ schema: REQUEST_SCHEMA })), 400, "invalid_request");
    await expectError(await post(json({ schema: REQUEST_SCHEMA, operations: "nope" })), 400, "invalid_request");
    // Forged provenance on the request root: unknown field.
    await expectError(await post(json({ schema: REQUEST_SCHEMA, operations: [], sourceKind: "LIVE_SITL" })), 400, "unknown_field");
    await expectError(await post(json({ schema: REQUEST_SCHEMA, operations: [], seed: 1.5 })), 400, "invalid_seed");
    await expectError(await post(json({ schema: REQUEST_SCHEMA, operations: [], seed: -1 })), 400, "invalid_seed");
    await expectError(await post(json({ schema: REQUEST_SCHEMA, operations: [{ op: "teleport", count: 1 }] })), 400, "unknown_operation");
    await expectError(await post(json({ schema: REQUEST_SCHEMA, operations: [{ op: "step", count: 0 }] })), 400, "invalid_step_count");
    await expectError(await post(json({ schema: REQUEST_SCHEMA, operations: [{ op: "step", count: 13 }] })), 400, "invalid_step_count");
    await expectError(await post(json({ schema: REQUEST_SCHEMA, operations: [{ op: "step", count: 2, robotId: "rov-01" }] })), 400, "unknown_field");
    await expectError(
      await post(json({ schema: REQUEST_SCHEMA, operations: [{ op: "command", command: { type: "selfDestruct", idempotencyKey: "x" } }] })),
      400,
      "unknown_command_type",
    );
  });

  it("enforces the issue's operation, step and total-step limits", async () => {
    const tooManyOps = { schema: REQUEST_SCHEMA, operations: Array.from({ length: LIMITS.maxOperations + 1 }, () => ({ op: "step", count: 1 })) };
    await expectError(await post(json(tooManyOps)), 400, "too_many_operations");

    const tooManyTotalSteps = {
      schema: REQUEST_SCHEMA,
      operations: Array.from({ length: 34 }, () => ({ op: "step", count: 12 })), // 408 > 400
    };
    await expectError(await post(json(tooManyTotalSteps)), 400, "too_many_total_steps");

    // Exactly at BOTH limits (100 operations, 400 total steps) is accepted.
    const atLimits = {
      schema: REQUEST_SCHEMA,
      operations: Array.from({ length: LIMITS.maxOperations }, () => ({ op: "step", count: 4 })), // 100 ops, 400 steps
    };
    const atLimitResponse = await post(json(atLimits));
    expect(atLimitResponse.status).toBe(200);
    const atLimitBody = (await atLimitResponse.json()) as Record<string, unknown>;
    expect((atLimitBody.snapshots as unknown[]).length).toBe(LIMITS.maxTotalSteps);
    expect(((atLimitBody.state as Record<string, unknown>).simulatorTimeMs)).toBe(LIMITS.maxTotalSteps * 500);
  });

  it("oversized bodies are 413 before parsing", async () => {
    const bigPadding = "x".repeat(LIMITS.maxBodyBytes + 1024);
    const response = await post(json({ schema: REQUEST_SCHEMA, operations: [], padding: bigPadding }));
    await expectError(response, 413, "payload_too_large");
  });

  it("non-POST methods answer with the typed error schema", async () => {
    const getResponse = await GET();
    expect(getResponse.status).toBe(405);
    const payload = (await getResponse.json()) as Record<string, unknown>;
    expect(payload.schema).toBe(ERROR_SCHEMA);
  });
});

describe("statelessness and isolation", () => {
  it("proof 6: separate guest requests cannot affect one another", async () => {
    const guestA = post(
      json({
        schema: REQUEST_SCHEMA,
        seed: 111,
        operations: [
          { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 60000, idempotencyKey: "shared-key" } },
          { op: "step", count: 3 },
        ],
      }),
    );
    // Guest B uses the SAME idempotency key and seed range but a different
    // seed and no fault: an isolated, clean run.
    const guestB = post(
      json({
        schema: REQUEST_SCHEMA,
        seed: 222,
        operations: [{ op: "step", count: 3 }],
      }),
    );
    const [responseA, responseB] = await Promise.all([guestA, guestB]);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    const bodyA = (await responseA.json()) as Record<string, unknown>;
    const bodyB = (await responseB.json()) as Record<string, unknown>;

    expect(bodyA.seed).toBe(111);
    expect(bodyB.seed).toBe(222);
    // A is faulted, B is clean — no bleed in either direction.
    const rovA = ((bodyA.snapshots as Array<Record<string, unknown>>)[2].robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rov-01") as Record<string, unknown>;
    const opticalA = (rovA.sensors as Array<Record<string, unknown>>).find((s) => s.sensorId === "rov-01-optical") as Record<string, unknown>;
    expect((opticalA.measured as Record<string, unknown>).quality01).toBeLessThan(0.09);
    const rovB = ((bodyB.snapshots as Array<Record<string, unknown>>)[2].robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rov-01") as Record<string, unknown>;
    const opticalB = (rovB.sensors as Array<Record<string, unknown>>).find((s) => s.sensorId === "rov-01-optical") as Record<string, unknown>;
    expect((opticalB.measured as Record<string, unknown>).quality01).toBeGreaterThan(0.69);

    // Re-running each guest's exact request reproduces its own result — no
    // cross-request memory of the idempotency key or the fault.
    const replayA = await post(
      json({
        schema: REQUEST_SCHEMA,
        seed: 111,
        operations: [
          { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 60000, idempotencyKey: "shared-key" } },
          { op: "step", count: 3 },
        ],
      }),
    );
    const replayB = await post(json({ schema: REQUEST_SCHEMA, seed: 222, operations: [{ op: "step", count: 3 }] }));
    expect(JSON.stringify(await replayA.json())).toBe(JSON.stringify(bodyA));
    expect(JSON.stringify(await replayB.json())).toBe(JSON.stringify(bodyB));
  });

  it("the transport synthesizes no forbidden concepts anywhere in the payload", async () => {
    const response = await post(json(faultTrace()));
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toMatch(/chain|transaction|signature|solana|wallet|payout|escrow|missionEvent|session|token|Date\.now|occurredAt|confirmedAt/i);
  });
});
