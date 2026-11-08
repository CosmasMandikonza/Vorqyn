/**
 * Real-server proof for VQ-GUEST-TRACE/1 (POST /api/demo/observations).
 * Builds the actual Next.js app, serves it with `next start`, and runs the
 * slice's correctness proofs over real HTTP. Prints one line per proof and
 * exits non-zero on any failure.
 *
 * Usage (from apps/web):  node tests/simulation-journal/observations-server-check.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NEXT_BIN = path.join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next");
const PORT = process.env.TRACE_API_PORT ?? "4313";
const BASE = `http://127.0.0.1:${PORT}/api/demo/observations`;

let failures = 0;
const report = (name, ok, detail = "") => {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const post = (body, query = "") =>
  fetch(`${BASE}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(15000),
  });

async function main() {
  console.log("Building the real Next.js app (next build)...");
  const build = spawnSync(process.execPath, [NEXT_BIN, "build"], { cwd: WEB_ROOT, encoding: "utf8" });
  if (build.status !== 0) {
    console.log((build.stdout ?? "").slice(-1500));
    console.log((build.stderr ?? "").slice(-1500));
    report("next build", false);
    process.exit(1);
  }
  report("next build", true);

  const server = spawn(process.execPath, [NEXT_BIN, "start", "--port", PORT], { cwd: WEB_ROOT, stdio: "ignore" });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        ready = (await post(JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [] }))).status === 200;
      } catch {
        /* not up yet */
      }
    }
    if (!ready) {
      report("server readiness", false);
      process.exit(1);
    }
    report("server readiness", true, `POST ${BASE}`);

    const faultBody = JSON.stringify({
      schema: "vorqyn.demo-sim/request/1",
      seed: 20261107,
      operations: [
        { op: "step", count: 10 },
        { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 9000, idempotencyKey: "trace-http-fault" } },
        { op: "step", count: 3 },
      ],
    });
    const faulted = await (await post(faultBody)).json();
    const rov = faulted.trace?.records?.[10]?.robots?.find((r) => r.robotId === "rov-01");
    const optical = rov?.sensors?.find((s) => s.sensorId === "rov-01-optical");
    const sonar = rov?.sensors?.find((s) => s.sensorId === "rov-01-sonar");
    report(
      "trace carries real degraded optical + independent sonar + provenance",
      faulted.schema === "vorqyn.guest-trace/response/1" &&
        faulted.frameId === "ENU_PORT-001_LOCAL" &&
        faulted.missionId === "guest-port-20261107" &&
        optical?.measured?.quality01 < 0.09 &&
        optical?.measured?.opticalVisibilityFactorApplied === 0.12 &&
        sonar?.measured?.quality01 > 0.6 &&
        sonar?.measured?.quality01 < 0.66,
      `optical ${optical?.measured?.quality01}, sonar ${sonar?.measured?.quality01}`,
    );

    const receiptRecord = faulted.trace?.records?.[0];
    report(
      "clock domains labelled and distinct (receipt fixture vs simulator)",
      receiptRecord.receiptClock.includes("not UTC") &&
        receiptRecord.receiptAtMs !== receiptRecord.simulatorTimeMs &&
        faulted.clockDomains?.chain === null,
    );

    const again = await (await post(faultBody)).text();
    report("same request byte-identical over HTTP", again === JSON.stringify(faulted));

    const paged = await (await post(faultBody, "?afterSequence=10&limit=2")).json();
    const pagedRecords = paged.trace?.records ?? [];
    report(
      "cursor paging is deterministic",
      pagedRecords.length === 2 &&
        pagedRecords[0].sequence === 11 &&
        paged.trace.returnedFromSequence === 11 &&
        paged.paging.nextAfterSequence === 12 &&
        paged.paging.hasMore === true,
    );

    const badCursor = await post(faultBody, "?afterSequence=bogus");
    const badCursorBody = await badCursor.json();
    report("corrupt cursor is a typed 400", badCursor.status === 400 && badCursorBody.error.code === "cursor_invalid");

    const oversize = await post(JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [], pad: "x".repeat(17 * 1024) }));
    const oversizeBody = await oversize.json();
    report("oversized body is a typed 413", oversize.status === 413 && oversizeBody.error.code === "payload_too_large");

    const badTarget = await post(
      JSON.stringify({
        schema: "vorqyn.demo-sim/request/1",
        operations: [{ op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "drone-01", severity: "severe", durationMs: 9000, idempotencyKey: "trace-http-bad" } }],
      }),
    );
    const badTargetBody = await badTarget.json();
    report("kernel-rejected command is a typed 422", badTarget.status === 422 && badTargetBody.error.code === "fault_target_invalid");

    const serialized = JSON.stringify(faulted);
    report(
      "no chain/lifecycle privilege in the payload",
      !/funded|funding|verified|paid|escrow|payout|wallet|transaction|signature|chainTime|verdict|missionEvent|launched|session/i.test(serialized),
    );
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (server.exitCode === null) server.kill("SIGKILL");
  }

  console.log(failures === 0 ? "\nRESULT: all real-server proofs passed" : `\nRESULT: ${failures} proof(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("[FAIL] real-server check crashed:", error?.message ?? error);
  process.exit(1);
});
