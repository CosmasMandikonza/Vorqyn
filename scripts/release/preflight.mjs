#!/usr/bin/env node
/** Tests committed HEAD in a disposable snapshot. Never removes the working checkout's node_modules. */
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate, inspectCredentials, safePublicUrl } from "./lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "node scripts/release/preflight.mjs --out <empty artifact directory> [--technical-only] [--require-submission]",
  );
  process.exit(0);
}
const outIndex = args.indexOf("--out");
if (outIndex < 0 || !args[outIndex + 1])
  throw new Error(
    "--out is required; use a new directory outside the repository",
  );
const out = resolve(args[outIndex + 1]);
if (!isAbsolute(out) || !relative(root, out).startsWith(".."))
  throw new Error("Artifact output must be outside this repository");
if (existsSync(out))
  throw new Error(
    "Choose a new output directory; existing evidence is never overwritten",
  );
mkdirSync(join(out, "commands"), { recursive: true });
const snapshot = join(out, "snapshot");
mkdirSync(snapshot);
const checks = [],
  capabilities = [];
process.env.RELEASE_ARTIFACT_DIR = out;
const report = {
  schema: "vorqyn.release-preflight/1",
  startedAt: new Date().toISOString(),
  source: {},
  checks,
  capabilities,
  technicalStatus: "BLOCKED",
  submissionStatus: "BLOCKED",
  artifacts: out,
};
const record = (id, status, detail, extra = {}) => {
  const check = { id, status, detail, ...extra };
  checks.push(check);
  console.log(`${status.padEnd(7)} ${id}: ${detail}`);
  return check;
};
function command(id, executable, argv, cwd = snapshot) {
  const log = join(out, "commands", `${id}.txt`),
    fd = openSync(log, "w");
  const started = Date.now();
  const result = spawnSync(executable, argv, {
    cwd,
    env: process.env,
    stdio: ["ignore", fd, fd],
    timeout: 600000,
  });
  closeSync(fd);
  const status =
    result.error?.code === "ENOENT"
      ? "BLOCKED"
      : result.status === 0
        ? "PASS"
        : "FAIL";
  return record(
    id,
    status,
    result.error
      ? `command failed (${result.error.code ?? "error"})`
      : status === "PASS"
        ? "exit 0"
        : `exit ${result.status ?? "signal"}`,
    {
      command: [executable, ...argv],
      log: relative(out, log),
      durationMs: Date.now() - started,
    },
  );
}
function capture(executable, argv) {
  const r = spawnSync(executable, argv, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  return r.status === 0 ? r.stdout.trim() : null;
}
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
try {
  const sha = capture("git", ["rev-parse", "HEAD"]);
  if (!sha) throw new Error("A git checkout is required");
  report.source = {
    sha,
    workingTreeDirty: !!capture("git", ["status", "--porcelain"]),
    testedTree:
      "committed HEAD only; uncommitted edits and ignored environment files are excluded",
  };
  const nodePin = readFileSync(join(root, ".nvmrc"), "utf8")
    .trim()
    .replace(/^v/, "");
  const pnpmPin = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).packageManager.split("@")[1];
  record(
    "node-version",
    process.versions.node === nodePin ? "PASS" : "BLOCKED",
    `observed ${process.versions.node}; required ${nodePin}`,
  );
  const observed = capture(pnpm, ["--version"]);
  record(
    "pnpm-version",
    observed === pnpmPin ? "PASS" : "BLOCKED",
    `observed ${observed ?? "unavailable"}; required ${pnpmPin}`,
  );
  const archive = join(out, "source.tar"),
    fd = openSync(archive, "w");
  const archived = spawnSync("git", ["archive", "--format=tar", sha], {
    cwd: root,
    stdio: ["ignore", fd, "pipe"],
  });
  closeSync(fd);
  if (archived.status !== 0)
    throw new Error("Could not archive committed source");
  const unpacked = spawnSync("tar", ["-xf", archive, "-C", snapshot], {
    encoding: "utf8",
  });
  if (unpacked.status !== 0)
    throw new Error(
      "Could not unpack archive; Git and tar are required (WSL2 recommended on Windows)",
    );
  record(
    "fresh-snapshot",
    existsSync(join(snapshot, "node_modules")) ? "FAIL" : "PASS",
    "isolated committed-source snapshot, no pre-existing node_modules",
  );
  const findings = inspectCredentials(snapshot, Object.keys(process.env));
  record(
    "credential-hygiene",
    findings.length ? "FAIL" : "PASS",
    findings.length
      ? `${findings.length} credential-pattern findings; values omitted`
      : "no supported credential patterns found; heuristic scan, not a security guarantee",
    { findings },
  );
  if (!checks.some((c) => ["BLOCKED", "FAIL"].includes(c.status))) {
    const install = command("install", pnpm, ["install", "--frozen-lockfile"]);
    if (install.status === "PASS")
      for (const [id, argv] of [
        ["lint", ["lint"]],
        ["typecheck", ["typecheck"]],
        ["unit", ["test"]],
        ["build", ["build"]],
      ])
        command(id, pnpm, argv);
    else
      for (const id of ["lint", "typecheck", "unit", "build"])
        record(id, "NOT RUN", "dependency installation did not pass");
    command("simulation-core", process.execPath, [
      "--test",
      ...capturePaths("services/simulation/core"),
    ]);
    command("world-coordinates", process.execPath, [
      "--test",
      ...capturePaths("services/simulation/integration"),
    ]);
    command("world-assets", process.execPath, [
      "assets/port-world/tools/validate.mjs",
      "--selfcheck",
    ]);
    if (existsSync(join(snapshot, "scripts/release/lib.test.mjs")))
      command("release-tools", process.execPath, [
        "--test",
        ...capturePaths("scripts/release"),
      ]);
    else
      record(
        "release-tools",
        "NOT RUN",
        "release tools are not committed in the archived source yet",
      );
    const built = checks.find((c) => c.id === "build")?.status === "PASS";
    if (args.includes("--technical-only"))
      record(
        "browser",
        "NOT RUN",
        "--technical-only requested; no browser result is implied",
      );
    else if (
      built &&
      existsSync(join(snapshot, "scripts/release/playwright.config.mjs"))
    ) {
      command("browser", pnpm, [
        "--filter",
        "@vorqyn/web",
        "exec",
        "playwright",
        "test",
        "--config",
        "../../../scripts/release/playwright.config.mjs",
        "--project",
        "judge",
        "--project",
        "capture",
      ]);
      // Pending integrations are real assertions. Their absence is BLOCKED, not a skipped/passing test.
      process.env.RELEASE_STAGE = "integration";
      const integration = command("integration-browser", pnpm, [
        "--filter",
        "@vorqyn/web",
        "exec",
        "playwright",
        "test",
        "--config",
        "../../../scripts/release/playwright.config.mjs",
        "--project",
        "integration",
      ]);
      const summaryPath = join(out, "integration-playwright.json");
      if (existsSync(summaryPath)) {
        const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
        const results = [];
        function walk(s) {
          for (const spec of s.specs ?? [])
            for (const t of spec.tests ?? [])
              for (const r of t.results ?? []) results.push(r);
          for (const child of s.suites ?? []) walk(child);
        }
        walk(summary);
        if (
          results.some((r) => r.status === "failed") &&
          results.every(
            (r) =>
              r.status === "passed" ||
              r.errors?.some((e) => /BLOCKED:/.test(e.message ?? "")),
          )
        ) {
          integration.status = "BLOCKED";
          integration.detail =
            "upcoming integration absent; see actual failed assertions, not a pass";
        }
      }
    } else
      record(
        "browser",
        "NOT RUN",
        "production build or release browser configuration unavailable",
      );
  } else
    for (const id of [
      "install",
      "lint",
      "typecheck",
      "unit",
      "build",
      "simulation-core",
      "world-coordinates",
      "world-assets",
      "release-tools",
      "browser",
    ])
      record(
        id,
        "NOT RUN",
        "a pinned-runtime, snapshot or credential prerequisite did not pass",
      );
  delete process.env.RELEASE_STAGE;
  const metadataPath = join(snapshot, "docs/release/submission-status.json");
  const metadata = existsSync(metadataPath)
    ? JSON.parse(readFileSync(metadataPath, "utf8"))
    : {};
  const deployment =
    process.env.RELEASE_PUBLIC_DEMO_URL ?? metadata.deploymentUrl;
  for (const [id, ready, detail] of [
    [
      "public-demo-url",
      safePublicUrl(deployment),
      "no verified public deployment URL; local server is not deployment proof",
    ],
    [
      "public-video",
      safePublicUrl(metadata.videoUrl),
      "no produced, inspected and public demo video supplied",
    ],
    [
      "submission-receipt",
      false,
      "human must sign in, submit and retain the actual portal receipt",
    ],
    [
      "solana-proof",
      false,
      "no verified deployed devnet escrow/reassignment/payout evidence supplied; use contingency script",
    ],
  ])
    capabilities.push({
      id,
      status: ready ? "NOT RUN" : "BLOCKED",
      detail: ready
        ? "URL is syntactically public; external reachability/content and human proof still require verification"
        : detail,
    });
} catch (error) {
  record(
    "preflight-runtime",
    "FAIL",
    error instanceof Error ? error.message : "unexpected preflight error",
  );
}
report.technicalStatus = aggregate(checks);
report.submissionStatus = aggregate(capabilities);
report.finishedAt = new Date().toISOString();
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(
  `Local checks: ${report.technicalStatus}; submission readiness: ${report.submissionStatus}. Report: ${join(out, "report.json")}`,
);
process.exitCode = checks.some((c) => c.status === "FAIL")
  ? 1
  : report.technicalStatus !== "PASS" ||
      (args.includes("--require-submission") &&
        report.submissionStatus !== "PASS")
    ? 2
    : 0;
function capturePaths(directory) {
  const path = join(snapshot, directory);
  const paths = existsSync(path)
    ? readdirSync(path)
        .filter((p) => p.endsWith(".test.mjs"))
        .map((p) => join(directory, p))
    : [];
  if (!paths.length)
    throw new Error(`No tests found for ${directory}; refusing a false pass`);
  return paths;
}
