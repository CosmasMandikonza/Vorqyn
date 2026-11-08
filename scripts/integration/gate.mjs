#!/usr/bin/env node
/** Cross-system QA only. Missing authority/implementation is BLOCKED, never a skipped passing test. */
import { spawnSync } from "node:child_process";
import { inspectToolingRun } from "./tooling-results.mjs";
import { inspectDriverSource } from "./driver-provenance.mjs";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!value("--out")) throw new Error("--out <new external directory> required");
const out = resolve(value("--out"));
if (!relative(root, out).startsWith("../") || existsSync(out))
  throw new Error("Choose a new output directory outside checkout");
const git = (cwd, ...argv) => {
  const result = spawnSync("git", argv, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error("Cannot establish source provenance");
  return result.stdout.trim();
};
const target = resolve(value("--target-root") ?? root);
const component = value("--component");
if (
  component &&
  !["chain-client", "recovery", "handoff", "orchestrator"].includes(component)
)
  throw new Error("Unknown component");
const report = {
  schema: "vorqyn.cross-system-gate/1",
  startedAt: new Date().toISOString(),
  sourceSha: git(root, "rev-parse", "HEAD"),
  dirty: !!git(root, "status", "--porcelain"),
  targetRoot: target,
  targetSha: git(target, "rev-parse", "HEAD"),
  targetDirty: !!git(target, "status", "--porcelain"),
  scope:
    target === root
      ? "Current checkout; existing boundaries and pending connection acceptance"
      : "READ-ONLY CANDIDATE DIAGNOSTIC; not merged-main evidence",
  checks: [],
  publicChainReceipts:
    "NOT RUN — no chain calls, signatures or wallet authority in this QA runner",
};
report.orchestrationDriver = inspectDriverSource(
  value("--orchestration-driver"),
  [
    { root, sha: report.sourceSha },
    { root: target, sha: report.targetSha },
  ],
);
if ((report.dirty || report.targetDirty) && !args.includes("--allow-dirty"))
  throw new Error(
    "Commit changes first, or explicitly use --allow-dirty for a diagnostic",
  );
mkdirSync(out);
const installLog = openSync(join(out, "frozen-install.txt"), "w");
let install;
try {
  install = spawnSync("pnpm", ["install", "--frozen-lockfile"], {
    cwd: root,
    stdio: ["ignore", installLog, installLog],
    timeout: 300000,
  });
} finally {
  closeSync(installLog);
}
report.checks.push({
  id: "frozen-install",
  status: install.status === 0 ? "PASS" : "FAIL",
  exitCode: install.status,
  command: ["pnpm", "install", "--frozen-lockfile"],
  log: "frozen-install.txt",
  error: install.error?.message,
});
if (install.status !== 0) {
  for (const id of [
    "qa-tooling",
    "existing-boundaries",
    "source-backed-verifier-metrics",
    "source-to-capture-clock-mapping",
    "chain-client",
    "recovery",
    "handoff",
    "orchestrator",
  ])
    report.checks.push({
      id,
      status: "NOT RUN",
      detail:
        "Frozen dependency installation failed; existing node_modules cannot certify this target",
    });
  finish();
  process.exit(process.exitCode);
}
function run(id, test, selected) {
  const command = [
    "--filter",
    "@vorqyn/web",
    "exec",
    "vitest",
    "run",
    ...(selected
      ? ["--config", "../../scripts/integration/vitest.config.mts"]
      : [test]),
    "--reporter=json",
    `--outputFile=${join(out, `${id}.json`)}`,
  ];
  const fd = openSync(join(out, `${id}.txt`), "w");
  let result;
  try {
    result = spawnSync("pnpm", command, {
      cwd: root,
      stdio: ["ignore", fd, fd],
      timeout: 300000,
      env: {
        ...process.env,
        INTEGRATION_ARTIFACT_DIR: out,
        INTEGRATION_COMPONENT: selected ?? "",
        INTEGRATION_TARGET_ROOT: target,
        INTEGRATION_ORCHESTRATION_DRIVER: value("--orchestration-driver")
          ? resolve(value("--orchestration-driver"))
          : "",
      },
    });
  } finally {
    closeSync(fd);
  }
  let stats;
  try {
    const r = JSON.parse(readFileSync(join(out, `${id}.json`)));
    stats = {
      total: r.numTotalTests,
      passed: r.numPassedTests,
      failed: r.numFailedTests,
      pending: r.numPendingTests,
      todo: r.numTodoTests,
    };
  } catch {
    /* A missing machine report is a failure, not evidence of an empty pass. */
  }
  const pass =
    result.status === 0 &&
    stats?.total > 0 &&
    stats.failed === 0 &&
    stats.pending === 0 &&
    stats.todo === 0;
  report.checks.push({
    id,
    status: pass ? "PASS" : "FAIL",
    exitCode: result.status,
    command: ["pnpm", ...command],
    log: `${id}.txt`,
    report: `${id}.json`,
    stats,
    error: result.error?.message,
  });
}
// The same tool regressions are independently runnable with Node only while
// installation is blocked. Full-gate execution still requires the frozen install.
const toolingCommand = ["--test", "scripts/integration/tooling.test.mjs"];
const toolingFd = openSync(join(out, "qa-tooling.txt"), "w");
let toolingResult;
try {
  toolingResult = spawnSync(process.execPath, toolingCommand, {
    cwd: root,
    stdio: ["ignore", toolingFd, toolingFd],
    timeout: 300000,
  });
} finally {
  closeSync(toolingFd);
}
const toolingOutput = readFileSync(join(out, "qa-tooling.txt"), "utf8");
const { stats: toolingStats, passed: toolingPassed } = inspectToolingRun(
  toolingResult.status,
  toolingOutput,
);
report.checks.push({
  id: "qa-tooling",
  status: toolingPassed ? "PASS" : "FAIL",
  command: [process.execPath, ...toolingCommand],
  exitCode: toolingResult.status,
  log: "qa-tooling.txt",
  stats: toolingStats,
  scope:
    "QA-tool negative fixtures and historical evidence validation only; not product/chain acceptance",
});
run("existing-boundaries", "tests/cross-system/boundaries.test.tsx");
const findingsFile = join(out, "boundary-findings.json");
if (existsSync(findingsFile)) {
  const findings = JSON.parse(readFileSync(findingsFile));
  report.checks.push({
    id: "source-backed-verifier-metrics",
    status: findings.metricCompatibility,
    detail: findings.explanation,
  });
  report.checks.push({
    id: "source-to-capture-clock-mapping",
    status: findings.clockMapping,
    detail: `Simulator-relative sources ${findings.sampleSourceTimesMs.join(",")} vs epoch capture ${findings.capturedAtMs}; no clock rebasing invented`,
  });
} else
  report.checks.push({
    id: "boundary-findings",
    status: "FAIL",
    detail: "Test-derived findings missing",
  });
const modules = {
  "chain-client": "packages/chain-client/src/lifecycle.ts",
  recovery: "services/mission/recovery/src/index.ts",
  handoff: "apps/web/components/mission-world/economic-handoff/boundary.ts",
  orchestrator: "services/mission/orchestration",
};
for (const [id, path] of Object.entries(modules)) {
  if (component && id !== component) {
    report.checks.push({
      id,
      status: "NOT RUN",
      detail:
        "Excluded by explicit single-component diagnostic; cannot certify full integration",
    });
    continue;
  }
  if (!existsSync(join(target, path))) {
    report.checks.push({
      id,
      status: "BLOCKED",
      detail: `${path} absent at target SHA; connection assertions not run`,
    });
    continue;
  }
  if (id === "orchestrator" && report.orchestrationDriver.status !== "PASS") {
    report.checks.push({
      id,
      status: "BLOCKED",
      detail: report.orchestrationDriver.reason,
      driverProvenance: report.orchestrationDriver,
    });
    continue;
  }
  run(id, undefined, id);
}
finish();

function finish() {
  report.status = report.checks.some((c) => c.status === "FAIL")
    ? "FAIL"
    : report.checks.some((c) => c.status !== "PASS")
      ? "BLOCKED"
      : "PASS";
  report.finishedAt = new Date().toISOString();
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        status: report.status,
        sourceSha: report.sourceSha,
        targetSha: report.targetSha,
        checks: report.checks.map(({ id, status, stats }) => ({
          id,
          status,
          stats,
        })),
      },
      null,
      2,
    ),
  );
  process.exitCode =
    report.status === "PASS" ? 0 : report.status === "FAIL" ? 1 : 2;
}
