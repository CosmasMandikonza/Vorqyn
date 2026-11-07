/**
 * VORQYN release integration smoke — BOTH guest simulation endpoints against
 * a production Next.js build (or any reachable origin).
 *
 * Reproducible, READ-ONLY verification for Issues #9/#17: every request is a
 * guest GET/POST that the public deployment also accepts — no credentials,
 * no state mutation beyond the stateless per-request kernel replay.
 *
 * Usage (from apps/web):
 *   node tests/simulation-journal/release-smoke.mjs                 # build + next start locally
 *   node tests/simulation-journal/release-smoke.mjs --origin=https://example.org
 *                                                                   # verify a public origin (no build)
 *
 * Prints one evidence line per check with the origin and HTTP status, plus
 * a final RESULT line. Exits non-zero on any failure. No secrets, no auth,
 * no client-controlled ledger updates.
 */

import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NEXT_BIN = path.join(WEB_ROOT, "node_modules", "next", "dist", "bin", "next");
const LOCAL_PORT = process.env.SMOKE_PORT ?? "4315";

const args = process.argv.slice(2);
const originArg = args.find((a) => a.startsWith("--origin="));
const PUBLIC_ORIGIN = originArg ? originArg.split("=")[1]?.replace(/\/$/, "") : null;
const SIM = (origin) => `${origin}/api/demo/simulation`;
const OBS = (origin) => `${origin}/api/demo/observations`;

let failures = 0;
const report = (name, ok, status = "", detail = "") => {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} [${PUBLIC_ORIGIN ?? "local-production"}] ${name}${status ? ` (HTTP ${status})` : ""}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const post = (url, body, query = "") =>
  fetch(`${url}${query}`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(20000) });

const faultBody = JSON.stringify({
  schema: "vorqyn.demo-sim/request/1",
  seed: 20261107,
  operations: [
    { op: "step", count: 10 },
    { op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "rov-01", severity: "severe", durationMs: 9000, idempotencyKey: "release-smoke-fault" } },
    { op: "step", count: 3 },
  ],
});

function rovSensorsOf(simulationBody) {
  const parsed = JSON.parse(simulationBody);
  const last = parsed.snapshots?.[parsed.snapshots.length - 1];
  const rov = last?.robots?.find((r) => r.robotId === "rov-01");
  return {
    optical: rov?.sensors?.find((s) => s.sensorId === "rov-01-optical")?.measured ?? null,
    sonar: rov?.sensors?.find((s) => s.sensorId === "rov-01-sonar")?.measured ?? null,
  };
}

async function main() {
  const utc = new Date().toISOString();
  console.log(`VORQYN release smoke @ ${utc} — origin: ${PUBLIC_ORIGIN ?? "local production build"}`);

  let server = null;
  let origin = PUBLIC_ORIGIN;

  if (!origin) {
    console.log("Building the production Next.js app (next build)...");
    const build = spawnSync(process.execPath, [NEXT_BIN, "build"], { cwd: WEB_ROOT, encoding: "utf8" });
    if (build.status !== 0) {
      console.log((build.stdout ?? "").slice(-1200));
      console.log((build.stderr ?? "").slice(-1200));
      report("production build", false);
      process.exit(1);
    }
    report("production build (next build)", true);
    server = spawn(process.execPath, [NEXT_BIN, "start", "--port", LOCAL_PORT], { cwd: WEB_ROOT, stdio: "ignore" });
    origin = `http://127.0.0.1:${LOCAL_PORT}`;
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        ready = (await post(SIM(origin), JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [] }))).status === 200;
      } catch {
        /* warming up */
      }
    }
    if (!ready) {
      report("server readiness", false);
      process.exit(1);
    }
    report("production server readiness (next start)", true, "", origin);
  }

  try {
    // --- /api/demo/simulation ---
    const empty = await post(SIM(origin), JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [] }));
    const emptyBody = await empty.json();
    report(
      "simulation: empty trace starts a fresh valid scenario",
      empty.status === 200 &&
        emptyBody.schema === "vorqyn.demo-sim/response/1" &&
        emptyBody.scenarioId === "PORT-001" &&
        emptyBody.sourceKind === "SYNTHETIC_SIM" &&
        emptyBody.frameId === "ENU_PORT-001_LOCAL" &&
        emptyBody.stepMs === 500 &&
        emptyBody.state?.simulatorTimeMs === 0,
      empty.status,
    );

    const faulted = await post(SIM(origin), faultBody);
    const faultedText = await faulted.text();
    const faultedBody = JSON.parse(faultedText);
    const { optical, sonar } = rovSensorsOf(faultedText);
    report(
      "simulation: 13-step fault run returns real kernel snapshots",
      faulted.status === 200 && faultedBody.snapshots?.length === 13 && faultedBody.state?.simulatorTimeMs === 6500,
      faulted.status,
      `last snapshot t=${faultedBody.state?.simulatorTimeMs}ms`,
    );
    report(
      "simulation: optical fault degrades measured quality; sonar independent",
      optical && optical.quality01 < 0.09 && optical.opticalVisibilityFactorApplied === 0.12 && sonar && sonar.quality01 > 0.6 && sonar.quality01 < 0.66,
      faulted.status,
      `optical ${optical?.quality01}, sonar ${sonar?.quality01}`,
    );
    report(
      "simulation: provenance is SYNTHETIC_SIM / ENU_PORT-001_LOCAL / metres on every snapshot",
      (faultedBody.snapshots ?? []).every(
        (s) => s.provenance?.sourceKind === "SYNTHETIC_SIM" && s.provenance?.frameId === "ENU_PORT-001_LOCAL" && s.provenance?.positionUnits === "m",
      ),
      faulted.status,
    );

    const repeat = await (await post(SIM(origin), faultBody)).text();
    report("simulation: deterministic replay — same request byte-identical", repeat === faultedText, faulted.status);

    const cleanSeed = JSON.stringify({ schema: "vorqyn.demo-sim/request/1", seed: 222, operations: [{ op: "step", count: 3 }] });
    const clean = await (await post(SIM(origin), cleanSeed)).json();
    const cleanRov = clean.snapshots?.[2]?.robots?.find((r) => r.robotId === "rov-01");
    const cleanOptical = cleanRov?.sensors?.find((s) => s.sensorId === "rov-01-optical")?.measured?.quality01;
    report(
      "simulation: separate guest streams isolated (seed 222 unaffected by the fault)",
      typeof cleanOptical === "number" && cleanOptical > 0.69,
      "",
      `clean optical ${cleanOptical}`,
    );

    const badTarget = await post(SIM(origin), JSON.stringify({
      schema: "vorqyn.demo-sim/request/1",
      operations: [{ op: "command", command: { type: "injectOpticalVisibilityFault", robotId: "drone-01", severity: "severe", durationMs: 9000, idempotencyKey: "smoke-bad" } }],
    }));
    const badTargetBody = await badTarget.json();
    report(
      "simulation: kernel-rejected fault target is a typed 422",
      badTarget.status === 422 && badTargetBody.error?.code === "fault_target_invalid",
      badTarget.status,
    );
    const malformed = await post(SIM(origin), "{not json");
    const malformedBody = await malformed.json();
    report("simulation: malformed JSON is a typed 400", malformed.status === 400 && malformedBody.error?.code === "invalid_json", malformed.status);
    const oversize = await post(SIM(origin), JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [], pad: "x".repeat(17 * 1024) }));
    const oversizeBody = await oversize.json();
    report("simulation: oversized body is a typed 413 (16KiB budget)", oversize.status === 413 && oversizeBody.error?.code === "payload_too_large", oversize.status);
    const wrongMethod = await fetch(SIM(origin), { method: "GET", signal: AbortSignal.timeout(15000) });
    const wrongMethodBody = await wrongMethod.json();
    report("simulation: GET is a typed 405", wrongMethod.status === 405 && wrongMethodBody.error?.code === "method_not_allowed", wrongMethod.status);

    // --- /api/demo/observations ---
    const trace = await post(OBS(origin), faultBody);
    const traceText = await trace.text();
    const traceBody = JSON.parse(traceText);
    const rovRecord = traceBody.trace?.records?.[10]?.robots?.find((r) => r.robotId === "rov-01");
    const traceOptical = rovRecord?.sensors?.find((s) => s.sensorId === "rov-01-optical")?.measured?.quality01;
    const traceSonar = rovRecord?.sensors?.find((s) => s.sensorId === "rov-01-sonar")?.measured?.quality01;
    report(
      "observations: trace derives the journal with provenance, cursor budget and clock domains",
      trace.status === 200 &&
        traceBody.schema === "vorqyn.guest-trace/response/1" &&
        traceBody.frameId === "ENU_PORT-001_LOCAL" &&
        traceBody.journal?.recordsAccepted === 13 &&
        traceBody.clockDomains?.chain === null &&
        traceBody.derivation?.includes("stateless"),
      trace.status,
      `records ${traceBody.journal?.recordsAccepted}, gaps ${traceBody.journal?.sequenceGaps?.length}, rejected ${traceBody.journal?.rejectedAppends?.length}`,
    );
    report(
      "observations: faulted record shows degraded optical with independently readable sonar",
      traceOptical !== undefined && traceOptical < 0.09 && traceSonar !== undefined && traceSonar > 0.6,
      trace.status,
      `optical ${traceOptical}, sonar ${traceSonar}`,
    );

    const pagedResponse = await post(OBS(origin), faultBody, "?afterSequence=10&limit=2");
    const paged = await pagedResponse.json();
    const pagedRecords = paged.trace?.records ?? [];
    report(
      "observations: cursor paging is deterministic",
      pagedResponse.status === 200 &&
        pagedRecords.length === 2 &&
        pagedRecords[0]?.sequence === 11 &&
        paged.paging?.nextAfterSequence === 12 &&
        paged.paging?.hasMore === true,
      pagedResponse.status,
      `returned sequences ${pagedRecords.map((r) => r.sequence)}`,
    );

    const traceRepeat = await (await post(OBS(origin), faultBody, "?afterSequence=10&limit=2")).text();
    report("observations: same request + cursor byte-identical", traceRepeat === JSON.stringify(paged), trace.status);

    const badCursorResponse = await fetch(`${OBS(origin)}?afterSequence=bogus`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: faultBody,
      signal: AbortSignal.timeout(15000),
    });
    const badCursorBody = await badCursorResponse.json();
    report("observations: corrupt cursor is a typed 400", badCursorResponse.status === 400 && badCursorBody.error?.code === "cursor_invalid", badCursorResponse.status);

    const traceOversize = await post(OBS(origin), JSON.stringify({ schema: "vorqyn.demo-sim/request/1", operations: [], pad: "x".repeat(17 * 1024) }));
    report("observations: oversized body is a typed 413", traceOversize.status === 413, traceOversize.status);

    // --- authority boundary scan over both endpoints ---
    const authorityScan = [faultedText, traceText].map((t) =>
      !/funded|funding|verified|paid|escrow|payout|wallet|transaction|signature|chainTime|verdict|missionEvent|launched|recovery|session/i.test(t),
    );
    report(
      "authority boundary: no funding/verifier/chain/lifecycle claims on either endpoint",
      authorityScan.every(Boolean),
      "",
    );

    const noStore = (await post(SIM(origin), faultBody)).headers.get("cache-control");
    report("both endpoints respond Cache-Control: no-store", noStore === "no-store", "");
  } finally {
    if (server !== null) {
      server.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      if (server.exitCode === null) server.kill("SIGKILL");
    }
  }

  console.log(failures === 0 ? "\nRESULT: release smoke passed — all checks green" : `\nRESULT: ${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("[FAIL] release smoke crashed:", error?.message ?? error);
  process.exit(1);
});
