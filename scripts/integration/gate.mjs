#!/usr/bin/env node
/** Cross-system QA only. Missing authority/implementation is BLOCKED, never a skipped passing test. */
import { spawnSync } from "node:child_process";
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
if ((report.dirty || report.targetDirty) && !args.includes("--allow-dirty"))
  throw new Error(
    "Commit changes first, or explicitly use --allow-dirty for a diagnostic",
  );
mkdirSync(out);
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
  if (id === "orchestrator" && !value("--orchestration-driver")) {
    report.checks.push({
      id,
      status: "BLOCKED",
      detail:
        "Agent A must bind the real API using orchestrator-port.ts; --orchestration-driver absent. No substitute implementation supplied.",
    });
    continue;
  }
  run(id, undefined, id);
}
report.status = report.checks.some((c) => c.status === "FAIL")
  ? "FAIL"
  : report.checks.some((c) => c.status !== "PASS")
    ? "BLOCKED"
    : "PASS";
report.finishedAt = new Date().toISOString();
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
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
