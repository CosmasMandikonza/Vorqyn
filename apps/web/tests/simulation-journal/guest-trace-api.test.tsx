/**
 * VQ-GUEST-TRACE/1 tests (issue #9 guest slice) — POST /api/demo/observations
 * through the REAL route handler, reusing the REAL DEMO-SIM/1 validation and
 * kernel execution plus the merged source-aware journal. No mocks.
 *
 * Definition-of-done coverage:
 * - actual POST vs pure kernel source snapshots: identical observations and provenance
 * - two seeds/sessions isolated
 * - same request (and cursor) returns byte-identical trace
 * - corrupt cursors, malformed payloads, oversized bodies reject with typed errors
 * - paused emits no fresh sample; link-down emits a frozen-pose marker
 * - optical fault degrades actual optical while sonar remains independently readable
 * - simulator / fixture-receipt / chain clocks never conflated (chain is null)
 * - no chain-event or lifecycle privilege anywhere in the payload
 * - 16KiB request limit enforced; responses bounded and deterministic
 */

import { strict as assert } from "node:assert";
import { describe, expect, it } from "vitest";
import { POST, GET } from "@/app/api/demo/observations/route";
import { createScenarioKernel } from "../../../../services/simulation/demo/kernel-adapter.mjs";
import type { DemoSnapshot } from "../../../../services/simulation/demo/kernel-adapter.d.mts";
import { DEFAULT_DEMO_SEED, LIMITS, REQUEST_SCHEMA } from "@/lib/demo-simulation/contract";
import { TRACE_ERROR_SCHEMA, TRACE_RESPONSE_SCHEMA, guestMissionIdForSeed } from "@/lib/simulation-journal/trace-contract";

const ROUTE = "http://localhost/api/demo/observations";

function post(body: string, query = ""): Promise<Response> {
  return POST(new Request(`${ROUTE}${query}`, { method: "POST", body }));
}

function json(body: unknown): string {
  return JSON.stringify(body);
}

const FAULT_TRACE = () => ({
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
        idempotencyKey: "guest-trace-fault",
      },
    },
    { op: "step", count: 3 },
  ],
});

async function expectError(response: Response, status: number, code: string): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const payload = (await response.json()) as Record<string, unknown>;
  expect(payload.schema).toBe(TRACE_ERROR_SCHEMA);
  const error = payload.error as Record<string, unknown>;
  expect(error.code).toBe(code);
  expect(typeof error.message).toBe("string");
  expect(JSON.stringify(payload)).not.toMatch(/at\s+\S+\(|node_modules|stack/i);
}

describe("guest trace — parity with the pure kernel", () => {
  it("actual POST yields observations identical to the pure kernel source snapshots", async () => {
    const body = json(FAULT_TRACE());
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const trace = (await response.json()) as Record<string, unknown>;

    expect(trace.schema).toBe(TRACE_RESPONSE_SCHEMA);
    expect(trace.scenarioId).toBe("PORT-001");
    expect(trace.seed).toBe(DEFAULT_DEMO_SEED);
    expect(trace.missionId).toBe(guestMissionIdForSeed(DEFAULT_DEMO_SEED));
    expect(trace.sourceKind).toBe("SYNTHETIC_SIM");
    expect(trace.frameId).toBe("ENU_PORT-001_LOCAL");
    expect(trace.positionUnits).toBe("m");
    expect(trace.stepMs).toBe(500);

    // Parity against the pure kernel, run independently with the same inputs.
    const faultCommand = {
      type: "injectOpticalVisibilityFault",
      robotId: "rov-01",
      severity: "severe",
      durationMs: 9000,
      idempotencyKey: "guest-trace-fault",
    };
    const kernel = createScenarioKernel({ seed: DEFAULT_DEMO_SEED });
    kernel.step(10);
    kernel.issueCommand(faultCommand);
    kernel.step(3);
    const sourceSnapshots = [...kernel.getObservationLog()] as DemoSnapshot[];

    const traceView = trace.trace as Record<string, unknown>;
    const journalView = trace.journal as Record<string, unknown>;
    const records = traceView.records as Array<Record<string, unknown>>;
    expect(journalView.recordsAccepted).toBe(sourceSnapshots.length);
    expect(records).toHaveLength(sourceSnapshots.length);
    for (const [index, record] of records.entries()) {
      const source = sourceSnapshots[index] as DemoSnapshot;
      expect(record.sequence).toBe(source.sequence);
      expect(record.simulatorTimeMs).toBe(source.simulatorTimeMs);
      expect(record.kernelState).toBe(source.kernelState);
      const robots = record.robots as Array<Record<string, unknown>>;
      expect(robots).toHaveLength(source.robots.length);
      for (const [robotIndex, robot] of robots.entries()) {
        const sourceRobot = source.robots[robotIndex] as DemoSnapshot["robots"][number] | undefined;
        assert(sourceRobot !== undefined);
        expect(robot.robotId).toBe(sourceRobot.robotId);
        expect(robot.pose).toEqual(sourceRobot.pose);
        expect(robot.fresh).toBe(sourceRobot.fresh);
        expect(robot.staleness).toBe(sourceRobot.staleness);
        expect(robot.linkState).toBe(sourceRobot.linkState);
        const sensors = robot.sensors as Array<Record<string, unknown>>;
        expect(sensors).toHaveLength(sourceRobot.sensors.length);
        for (const [sensorIndex, sensor] of sensors.entries()) {
          const sourceSensor = sourceRobot.sensors[sensorIndex];
          assert(sourceSensor !== undefined);
          expect(sensor.sensorId).toBe(sourceSensor.sensorId);
          expect(sensor.measured).toEqual(
            sourceSensor.measured === null
              ? null
              : {
                  quality01: sourceSensor.measured.quality01,
                  opticalVisibilityFactorApplied: sourceSensor.measured.opticalVisibilityFactorApplied,
                },
          );
          expect(sensor.coverage).toEqual(sourceSensor.coverage);
        }
      }
    }
  });

  it("optical fault degrades the real measured value while sonar stays independently readable", async () => {
    const response = await post(json(FAULT_TRACE()));
    const trace = (await response.json()) as Record<string, unknown>;
    const records = (trace.trace as Record<string, unknown>).records as Array<Record<string, unknown>>;
    const faultedRecord = records[10] as Record<string, unknown>;
    const rov = (faultedRecord.robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rov-01") as Record<string, unknown>;
    const optical = (rov.sensors as Array<Record<string, unknown>>).find((s) => s.sensorId === "rov-01-optical") as Record<string, unknown>;
    const sonar = (rov.sensors as Array<Record<string, unknown>>).find((s) => s.sensorId === "rov-01-sonar") as Record<string, unknown>;
    expect((optical.measured as Record<string, unknown>).quality01).toBeLessThan(0.09);
    expect((optical.measured as Record<string, unknown>).opticalVisibilityFactorApplied).toBe(0.12);
    expect((sonar.measured as Record<string, unknown>).quality01).toBeGreaterThan(0.6);
    expect((sonar.measured as Record<string, unknown>).quality01).toBeLessThan(0.66);
    const fault = rov.activeOpticalFault as Record<string, unknown>;
    expect(fault.severity).toBe("severe");
    // Telemetry derived through the merged bridge is contract-valid.
    expect(faultedRecord.telemetryEmitted).toBe(3);
  });

  it("clock domains are explicit and never conflated; chain is null", async () => {
    const response = await post(json(FAULT_TRACE()));
    const trace = (await response.json()) as Record<string, unknown>;
    const clockDomains = trace.clockDomains as Record<string, unknown>;
    expect(clockDomains.receipt).toMatch(/fixture-epoch-base/);
    expect(clockDomains.receipt).toMatch(/not UTC/);
    expect(clockDomains.chain).toBeNull();
    const records = (trace.trace as Record<string, unknown>).records as Array<Record<string, unknown>>;
    const first = records[0] as Record<string, unknown>;
    expect(first.receiptClock).toMatch(/not UTC/);
    expect(first.receiptAtMs).not.toBe(first.simulatorTimeMs); // distinct domains
    // The receipt clock advances by append ordinal, not by simulator steps.
    const second = records[1] as Record<string, unknown>;
    expect((second.receiptAtMs as number) - (first.receiptAtMs as number)).toBe(1);
    expect((second.simulatorTimeMs as number) - (first.simulatorTimeMs as number)).toBe(500);
    // Derivation is honestly labelled stateless.
    expect(trace.derivation).toMatch(/stateless/);
  });
});

describe("guest trace — determinism, paging and isolation", () => {
  it("the same request returns a byte-identical trace (stateless determinism)", async () => {
    const body = json(FAULT_TRACE());
    const first = await (await post(body)).text();
    const second = await (await post(body)).text();
    expect(second).toBe(first);
  });

  it("the same request + same cursor returns a byte-identical trace", async () => {
    const body = json(FAULT_TRACE());
    const first = await (await post(body, "?afterSequence=5&limit=3")).text();
    const second = await (await post(body, "?afterSequence=5&limit=3")).text();
    expect(second).toBe(first);
  });

  it("paging cursor returns only newer records with nextAfterSequence", async () => {
    const body = json({ schema: REQUEST_SCHEMA, operations: [{ op: "step", count: 6 }] });
    const all = (await (await post(body)).json()) as Record<string, unknown>;
    const total = (all.trace as Record<string, unknown>).totalSnapshots;

    const paged = (await (await post(body, "?afterSequence=2&limit=2")).json()) as Record<string, unknown>;
    const trace = paged.trace as Record<string, unknown>;
    const records = trace.records as Array<Record<string, unknown>>;
    expect(records).toHaveLength(2);
    expect(records[0]?.sequence).toBe(3);
    expect(records[1]?.sequence).toBe(4);
    expect(trace.returnedFromSequence).toBe(3);
    expect(trace.returnedToSequence).toBe(4);
    expect(trace.totalSnapshots).toBe(total);
    const paging = paged.paging as Record<string, unknown>;
    expect(paging.nextAfterSequence).toBe(4);
    expect(paging.hasMore).toBe(true);

    // Draining the cursor reaches the end.
    const drain = (await (await post(body, "?afterSequence=4")).json()) as Record<string, unknown>;
    const drainPaging = drain.paging as Record<string, unknown>;
    expect(drainPaging.hasMore).toBe(false);
    expect(drainPaging.nextAfterSequence).toBeNull();
  });

  it("corrupt cursors are typed 400s", async () => {
    const body = json({ schema: REQUEST_SCHEMA, operations: [{ op: "step", count: 1 }] });
    await expectError(await post(body, "?afterSequence=abc"), 400, "cursor_invalid");
    await expectError(await post(body, "?afterSequence=-1"), 400, "cursor_invalid");
    await expectError(await post(body, "?afterSequence=999999999"), 400, "cursor_invalid");
    await expectError(await post(body, "?limit=0"), 400, "cursor_invalid");
    await expectError(await post(body, "?limit=401"), 400, "cursor_invalid");
    await expectError(await post(body, "?limit=four"), 400, "cursor_invalid");
  });

  it("two seeds/sessions are isolated: different streams, fault only where injected", async () => {
    const guestA = post(
      json({
        schema: REQUEST_SCHEMA,
        seed: 111,
        operations: [
          { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 60000, idempotencyKey: "trace-iso" } },
          { op: "step", count: 3 },
        ],
      }),
    );
    const guestB = post(json({ schema: REQUEST_SCHEMA, seed: 222, operations: [{ op: "step", count: 3 }] }));
    const [responseA, responseB] = await Promise.all([guestA, guestB]);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    const traceA = (await responseA.json()) as Record<string, unknown>;
    const traceB = (await responseB.json()) as Record<string, unknown>;
    expect(traceA.missionId).toBe("guest-port-111");
    expect(traceB.missionId).toBe("guest-port-222");
    expect(traceA.seed).toBe(111);
    expect(traceB.seed).toBe(222);
    const recordA = ((traceA.trace as Record<string, unknown>).records as Array<Record<string, unknown>>)[2] as Record<string, unknown>;
    const recordB = ((traceB.trace as Record<string, unknown>).records as Array<Record<string, unknown>>)[2] as Record<string, unknown>;
    const rovA = (recordA.robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rov-01") as Record<string, unknown>;
    const rovB = (recordB.robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rov-01") as Record<string, unknown>;
    const opticalA = (rovA.sensors as Array<Record<string, unknown>>).find((s) => s.sensorId === "rov-01-optical") as Record<string, unknown>;
    const opticalB = (rovB.sensors as Array<Record<string, unknown>>).find((s) => s.sensorId === "rov-01-optical") as Record<string, unknown>;
    expect((opticalA.measured as Record<string, unknown>).quality01).toBeLessThan(0.09);
    expect((opticalB.measured as Record<string, unknown>).quality01).toBeGreaterThan(0.69);
  });
});

describe("guest trace — lifecycle honesty", () => {
  it("paused snapshots emit no fresh sample; link-down emits a frozen-pose marker", async () => {
    const response = await post(
      json({
        schema: REQUEST_SCHEMA,
        operations: [
          { op: "step", count: 2 },
          { op: "command", command: { type: "pause", idempotencyKey: "trace-pause" } },
          { op: "step", count: 1 },
          { op: "command", command: { type: "resume", idempotencyKey: "trace-resume" } },
          { op: "command", command: { type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "trace-disc" } },
          { op: "step", count: 1 },
        ],
      }),
    );
    expect(response.status).toBe(200);
    const trace = (await response.json()) as Record<string, unknown>;
    const records = (trace.trace as Record<string, unknown>).records as Array<Record<string, unknown>>;

    // Paused heartbeat: no fresh sample claimed anywhere.
    const pausedRecord = records[2] as Record<string, unknown>;
    expect(pausedRecord.kernelState).toBe("paused");
    expect(pausedRecord.telemetryEmitted).toBe(0);
    const pausedSkipped = pausedRecord.telemetrySkipped as Array<Record<string, unknown>>;
    expect(pausedSkipped).toHaveLength(3);
    expect(pausedSkipped.every((s) => s.reason === "kernel paused: no fresh measurement exists at this snapshot")).toBe(true);
    expect((pausedRecord.simulatorTimeMs as number) === 1000).toBe(true);

    // Link-down: frozen pose marker for the ROV, others fresh.
    const discRecord = records[3] as Record<string, unknown>;
    const rov = (discRecord.robots as Array<Record<string, unknown>>).find((r) => r.robotId === "rov-01") as Record<string, unknown>;
    expect(rov.fresh).toBe(false);
    expect(rov.staleness).toBe("link-disconnected");
    for (const sensor of rov.sensors as Array<Record<string, unknown>>) {
      expect(sensor.measured).toBeNull();
    }
    expect(discRecord.telemetryEmitted).toBe(3); // link-down marker samples exist (not fresh readings)
  });

  it("the trace claims no chain-event or lifecycle privilege", async () => {
    const response = await post(json(FAULT_TRACE()));
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toMatch(/funded|funding|verified|paid|escrow|payout|wallet|transaction|signature|chainTime|verdict|missionEvent|mission\.|launched|recovery|session/i);
  });
});

describe("guest trace — budgets and failures", () => {
  it("an empty trace is a valid fresh scenario", async () => {
    const response = await post(json({ schema: REQUEST_SCHEMA, operations: [] }));
    expect(response.status).toBe(200);
    const trace = (await response.json()) as Record<string, unknown>;
    expect((trace.trace as Record<string, unknown>).totalSnapshots).toBe(0);
    expect((trace.journal as Record<string, unknown>).recordsAccepted).toBe(0);
    expect(trace.derivation).toMatch(/stateless/);
  });

  it("kernel-rejected operations are typed 422s and nothing is committed", async () => {
    const response = await post(
      json({
        schema: REQUEST_SCHEMA,
        operations: [
          { op: "step", count: 1 },
          { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "drone-01", severity: "severe", durationMs: 9000, idempotencyKey: "trace-bad" } },
        ],
      }),
    );
    await expectError(response, 422, "fault_target_invalid");
    // The stream is unaffected: a clean trace replays identically afterwards.
    const after = await post(json({ schema: REQUEST_SCHEMA, operations: [{ op: "step", count: 1 }] }));
    expect(after.status).toBe(200);
  });

  it("malformed payloads reject with typed 400s", async () => {
    await expectError(await post("{not json"), 400, "invalid_json");
    await expectError(await post(json({ schema: "vorqyn.demo-sim/request/9", operations: [] })), 400, "schema_unsupported");
    await expectError(await post(json({ schema: REQUEST_SCHEMA, operations: [], sourceKind: "LIVE_SITL" })), 400, "unknown_field");
    await expectError(await post(json({ schema: REQUEST_SCHEMA, operations: [{ op: "step", count: 999 }] })), 400, "invalid_step_count");
  });

  it("oversized bodies are 413 (declared header and actual bytes)", async () => {
    const declared = POST(
      new Request(ROUTE, {
        method: "POST",
        headers: { "content-length": String(LIMITS.maxBodyBytes + 1) },
        body: json({ schema: REQUEST_SCHEMA, operations: [] }),
      }),
    );
    await expectError(await declared, 413, "payload_too_large");
    const actual = post(json({ schema: REQUEST_SCHEMA, operations: [], pad: "x".repeat(LIMITS.maxBodyBytes + 512) }));
    await expectError(await actual, 413, "payload_too_large");
  });

  it("stops an undeclared oversized stream at the byte limit without buffering to EOF", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // No Content-Length and deliberately NO close(): request.text()
        // would wait for the entire unbounded stream. Bounded reads must
        // reject and cancel as soon as this first chunk exceeds the cap.
        controller.enqueue(new Uint8Array(LIMITS.maxBodyBytes + 1));
      },
      cancel() {
        canceled = true;
      },
    });
    const response = await POST(new Request(ROUTE, {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));
    await expectError(response, 413, "payload_too_large");
    expect(canceled).toBe(true);
  });

  it("accepts a valid bounded request split across stream chunks", async () => {
    const body = new TextEncoder().encode(json({ schema: REQUEST_SCHEMA, operations: [] }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body.slice(0, 6));
        controller.enqueue(body.slice(6));
        controller.close();
      },
    });
    const response = await POST(new Request(ROUTE, {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(response.status).toBe(200);
    expect((await response.json()).schema).toBe(TRACE_RESPONSE_SCHEMA);
  });

  it("non-POST methods answer with the typed error schema", async () => {
    const getResponse = await GET();
    expect(getResponse.status).toBe(405);
    const payload = (await getResponse.json()) as Record<string, unknown>;
    expect(payload.schema).toBe(TRACE_ERROR_SCHEMA);
  });
});
