/**
 * Real-server proof for the frozen VQ-DEMO-SIM/1 transport (issue #32).
 *
 * Builds the actual Next.js app, serves it with `next start` on a test
 * port, and runs the mandatory correctness proofs over REAL HTTP — no
 * test harness, no mocks, the exact endpoint another agent will consume.
 *
 * Usage (from apps/web):  node tests/demo-simulation-api/real-server-check.mjs
 * Requires network-free local operation only; prints one line per proof
 * and exits non-zero on any failure.
 */

import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NEXT_BIN = path.join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next");
const PORT = process.env.DEMO_API_PORT ?? "4311";
const BASE = `http://127.0.0.1:${PORT}/api/demo/simulation`;

let failures = 0;

function report(name, ok, detail = "") {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function post(bodyText) {
  return fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bodyText,
    signal: AbortSignal.timeout(15000),
  });
}

async function main() {
  console.log("Building the real Next.js app (next build)...");
  const build = spawnSync(process.execPath, [NEXT_BIN, "build"], { cwd: WEB_ROOT, encoding: "utf8" });
  if (build.status !== 0) {
    console.log(build.stdout?.slice(-2000));
    console.log(build.stderr?.slice(-2000));
    report("next build", false);
    process.exit(1);
  }
  report("next build", true);

  console.log(`Starting next start on port ${PORT}...`);
  const server = spawn(process.execPath, [NEXT_BIN, "start", "--port", PORT], { cwd: WEB_ROOT, stdio: "ignore" });
  server.on("exit", (code) => {
    if (code !== null && code !== 0 && failures === 0) {
      report("next start kept running", false, `server exited early with code ${code}`);
    }
  });

  try {
    // Wait for readiness.
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const probe = await post(JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [] }));
        ready = probe.status === 200;
      } catch {
        /* server not up yet */
      }
    }
    if (!ready) {
      report("server readiness", false, "endpoint never returned 200");
      process.exit(1);
    }
    report("server readiness", true, `POST ${BASE}`);

    // --- Proof 1/7 basics: empty trace (start/reset) over real HTTP. ---
    const empty = await (await post(JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [] }))).json();
    report(
      "empty trace returns a fresh valid scenario",
      empty.schema === "vorqyn.demo-sim/response/1" &&
        empty.scenarioId === "PORT-001" &&
        empty.sourceKind === "SYNTHETIC_SIM" &&
        empty.frameId === "ENU_PORT-001_LOCAL" &&
        empty.positionUnits === "m" &&
        empty.stepMs === 500 &&
        Array.isArray(empty.snapshots) && empty.snapshots.length === 0 &&
        empty.state.kernelState === "running" &&
        empty.state.simulatorTimeMs === 0,
    );

    // --- Ten real steps. ---
    const ten = await (await post(JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [{ op: "step", count: 10 }] }))).json();
    const rovSnapshot = ten.snapshots?.[9]?.robots?.find((r) => r.robotId === "rov-01");
    report(
      "ten-step trace returns ordered real snapshots",
      ten.snapshots?.length === 10 &&
        ten.snapshots[0].sequence === 1 &&
        ten.snapshots[9].simulatorTimeMs === 5000 &&
        typeof rovSnapshot?.pose?.x === "number",
      `rov pose @t=5000ms: [${rovSnapshot?.pose?.x}, ${rovSnapshot?.pose?.y}, ${rovSnapshot?.pose?.z}]`,
    );

    // --- Proof 2: genuine measured optical degradation. ---
    const faultTrace = JSON.stringify({
      schema: "vorqyn.demo-sim/request/1",
      seed: 20261107,
      operations: [
        { op: "step", count: 10 },
        { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 9000, idempotencyKey: "http-fault-1" } },
        { op: "step", count: 3 },
      ],
    });
    const faulted = await (await post(faultTrace)).json();
    const opticalQualities = [];
    const sonarQualities = [];
    for (const snapshot of faulted.snapshots ?? []) {
      const rov = snapshot.robots.find((r) => r.robotId === "rov-01");
      const optical = rov.sensors.find((s) => s.sensorId === "rov-01-optical");
      const sonar = rov.sensors.find((s) => s.sensorId === "rov-01-sonar");
      if (optical.measured) opticalQualities.push(optical.measured.quality01);
      if (sonar.measured) sonarQualities.push(sonar.measured.quality01);
    }
    const clean = opticalQualities.slice(0, 10);
    const degraded = opticalQualities.slice(10);
    report(
      "fault genuinely degrades measured optical quality (0.71-band -> <0.09), sonar independent",
      clean.length === 10 && clean.every((q) => q > 0.69) && degraded.length === 3 && degraded.every((q) => q < 0.09) && sonarQualities.every((q) => q > 0.6),
      `clean min ${Math.min(...clean)}, degraded max ${Math.max(...degraded)}, sonar mean ${(sonarQualities.reduce((a, b) => a + b, 0) / sonarQualities.length).toFixed(4)}`,
    );

    // --- Proof 1: determinism over real HTTP. ---
    const again = await post(faultTrace);
    const againText = JSON.stringify(await again.json());
    report("identical input gives byte-identical HTTP response", againText === JSON.stringify(faulted));

    // --- Proof 3: duplicate idempotency key. ---
    const duplicated = await (
      await post(
        JSON.stringify({
          schema: "vorqyn.demo-sim/request/1",
          operations: [
            { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 9000, idempotencyKey: "http-dup" } },
            { op: "step", count: 1 },
            { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 9000, idempotencyKey: "http-dup" } },
            { op: "step", count: 1 },
          ],
        }),
      )
    ).json();
    report(
      "duplicate idempotency key does not apply a second fault",
      duplicated.commandResults?.[1]?.duplicate === true && duplicated.commandResults?.length === 2,
    );

    // --- Proof 4: pause/disconnect honesty. ---
    const lifecycle = await (
      await post(
        JSON.stringify({
          schema: "vorqyn.demo-sim/request/1",
          operations: [
            { op: "step", count: 2 },
            { op: "command", command: { type: "pause", idempotencyKey: "http-pause" } },
            { op: "step", count: 1 },
            { op: "command", command: { type: "resume", idempotencyKey: "http-resume" } },
            { op: "command", command: { type: "disconnectTelemetry", robotId: "rov-01", idempotencyKey: "http-disc" } },
            { op: "step", count: 1 },
          ],
        }),
      )
    ).json();
    const paused = lifecycle.snapshots[2];
    const disconnected = lifecycle.snapshots[3];
    const rovPaused = paused.robots.find((r) => r.robotId === "rov-01");
    const rovDisc = disconnected.robots.find((r) => r.robotId === "rov-01");
    report(
      "pause/disconnect produce no fabricated fresh readings",
      paused.kernelState === "paused" && paused.simulatorTimeMs === 1000 &&
        rovPaused.sensors.every((s) => s.measured === null) &&
        rovDisc.linkState === "disconnected" && rovDisc.staleness === "link-disconnected" &&
        rovDisc.sensors.every((s) => s.measured === null),
    );

    // --- Proof 5/transport negatives over HTTP. ---
    const rejected = await post(
      JSON.stringify({
        schema: "vorqyn.demo-sim/request/1",
        operations: [{ op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "drone-01", severity: "severe", durationMs: 9000, idempotencyKey: "http-bad" } }],
      }),
    );
    const rejectedBody = await rejected.json();
    report(
      "kernel-rejected command is a typed 422 with safe message",
      rejected.status === 422 &&
        rejectedBody.schema === "vorqyn.demo-sim/error/1" &&
        rejectedBody.error.code === "fault_target_invalid" &&
        !/stack|at\s+/i.test(JSON.stringify(rejectedBody)),
    );
    const malformed = await post("{this is not json");
    const malformedBody = await malformed.json();
    report("malformed JSON is a typed 400", malformed.status === 400 && malformedBody.error.code === "invalid_json");
    const oversize = await post(JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [], pad: "x".repeat(17 * 1024) }));
    const oversizeBody = await oversize.json();
    report("oversized body is a typed 413", oversize.status === 413 && oversizeBody.error.code === "payload_too_large");
    const wrongMethod = await fetch(BASE, { method: "GET", signal: AbortSignal.timeout(15000) });
    const wrongMethodBody = await wrongMethod.json();
    report("GET is a typed 405", wrongMethod.status === 405 && wrongMethodBody.error.code === "method_not_allowed");
    const noStore = (await post(JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [] }))).headers.get("cache-control");
    report("responses are Cache-Control: no-store", noStore === "no-store");

    // --- Proof 6: guest isolation over parallel HTTP. ---
    const [guestA, guestB] = await Promise.all([
      post(
        JSON.stringify({
          schema: "vorqyn.demo-sim/request/1",
          seed: 111,
          operations: [
            { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 60000, idempotencyKey: "iso" } },
            { op: "step", count: 3 },
          ],
        }),
      ),
      post(JSON.stringify({ schema: "vorqyn.demo-sim/request/1", seed: 222, operations: [{ op: "step", count: 3 }] })),
    ]);
    const bodyA = await guestA.json();
    const bodyB = await guestB.json();
    const rovA = bodyA.snapshots[2].robots.find((r) => r.robotId === "rov-01");
    const rovB = bodyB.snapshots[2].robots.find((r) => r.robotId === "rov-01");
    const opticalA = rovA.sensors.find((s) => s.sensorId === "rov-01-optical").measured.quality01;
    const opticalB = rovB.sensors.find((s) => s.sensorId === "rov-01-optical").measured.quality01;
    report(
      "parallel guest requests do not affect one another",
      bodyA.seed === 111 && bodyB.seed === 222 && opticalA < 0.09 && opticalB > 0.69,
      `A=${opticalA} (faulted), B=${opticalB} (clean)`,
    );
  } finally {
    server.kill("SIGTERM");
    // Give the process a moment to exit, then hard-kill if needed.
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (server.exitCode === null) server.kill("SIGKILL");
  }

  console.log(failures === 0 ? "\nRESULT: all real-server proofs passed" : `\nRESULT: ${failures} proof(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("[FAIL] real-server check crashed:", error?.message ?? error);
  process.exit(1);
});
