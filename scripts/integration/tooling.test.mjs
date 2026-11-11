/** Dependency-free QA-tool regressions. Fixtures never certify application or chain behavior. */
import test from "node:test";
import { inspectToolingRun } from "./tooling-results.mjs";
import { inspectDriverSource } from "./driver-provenance.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const original = join(root, "docs/evidence/integration16/browser");
const target = "full-row-clean-uw-light-320x844";
const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
function run(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [join(root, script), ...args], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 30000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}
function captureFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "vorqyn-capture-tool-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  cpSync(
    join(original, "capture-run.json"),
    join(directory, "capture-run.json"),
  );
  cpSync(
    join(original, "integration-camera"),
    join(directory, "integration-camera"),
    { recursive: true },
  );
  return directory;
}
function validate(directory) {
  const result = run("scripts/integration/validate-camera-evidence.mjs", [
    "--dir",
    directory,
  ]);
  return {
    result,
    report: JSON.parse(
      readFileSync(join(directory, "camera-validation.json"), "utf8"),
    ),
  };
}
function metadata(directory, change) {
  const file = join(directory, "integration-camera", `${target}.json`);
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  change(parsed);
  writeFileSync(file, JSON.stringify(parsed));
}

test("QA runner: failed frozen installation cannot invoke any dependent product check", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "vorqyn-runner-tool-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin"),
    calls = join(directory, "calls.jsonl"),
    out = join(directory, "out");
  mkdirSync(bin);
  const fake = join(bin, "pnpm");
  writeFileSync(
    fake,
    `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.QA_TOOL_CALLS, JSON.stringify(process.argv.slice(2))+'\\n');\nconsole.error('QA FAILURE FIXTURE ONLY: package installation deliberately refused; no product tests executed');\nprocess.exit(1);\n`,
  );
  chmodSync(fake, 0o755);
  const { status } = run(
    "scripts/integration/gate.mjs",
    ["--out", out, "--allow-dirty"],
    {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      QA_TOOL_CALLS: calls,
    },
  );
  assert.equal(status, 1);
  assert.deepEqual(
    readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse),
    [["install", "--frozen-lockfile"]],
  );
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  assert.equal(report.status, "FAIL");
  assert.equal(report.checks[0].id, "frozen-install");
  assert.equal(report.checks[0].status, "FAIL");
  assert.ok(report.checks.slice(1).length >= 7);
  assert.ok(
    report.checks.some((c) => c.id === "qa-tooling" && c.status === "NOT RUN"),
  );
  assert.ok(report.checks.slice(1).every((c) => c.status === "NOT RUN"));
  assert.equal(existsSync(join(out, "existing-boundaries.json")), false);
});

test("historical capture audit: valid PNG integrity cannot erase eight known geometry failures", (t) => {
  const directory = captureFixture(t);
  const before = digest(join(original, "integration-camera", `${target}.png`));
  const { result, report } = validate(directory);
  assert.equal(result.status, 1);
  assert.equal(report.integrity, "PASS");
  assert.equal(report.layout, "FAIL");
  assert.equal(report.checks.length, 32);
  assert.equal(report.layoutPassed, 24);
  assert.equal(report.layoutFailed, 8);
  assert.equal(
    digest(join(original, "integration-camera", `${target}.png`)),
    before,
  );
});

test("capture audit rejects a desktop PNG substituted as 320px mobile evidence", (t) => {
  const directory = captureFixture(t);
  cpSync(
    join(directory, "integration-camera/full-row-clean-uw-light-1440x900.png"),
    join(directory, "integration-camera", `${target}.png`),
  );
  // Even a matching replacement hash cannot turn a 1440px PNG into mobile evidence.
  metadata(directory, (data) => {
    data.sha256 = digest(
      join(directory, "integration-camera", `${target}.png`),
    );
  });
  const { result, report } = validate(directory);
  assert.equal(result.status, 1);
  assert.equal(report.integrity, "FAIL");
  assert.equal(report.layout, "NOT RUN");
  assert.equal(report.checks.find((c) => c.name === target).integrity, "FAIL");
});

for (const [field, value] of [
  ["runId", "QA-FORGED-RUN"],
  ["sourceSha", "0".repeat(40)],
]) {
  test(`capture audit rejects forged ${field} independently`, (t) => {
    const directory = captureFixture(t);
    metadata(directory, (data) => {
      data[field] = value;
    });
    const { report } = validate(directory);
    assert.equal(report.integrity, "FAIL");
    assert.equal(
      report.checks.find((c) => c.name === target).integrity,
      "FAIL",
    );
  });
}

test("capture audit rejects false viewport metadata despite a plausible filename", (t) => {
  const directory = captureFixture(t);
  metadata(directory, (data) => {
    data.viewport.width = 390;
  });
  const { report } = validate(directory);
  assert.equal(report.integrity, "FAIL");
  assert.equal(report.checks.find((c) => c.name === target).integrity, "FAIL");
});

test("capture audit refuses an incomplete 31-image inventory", (t) => {
  const directory = captureFixture(t);
  unlinkSync(join(directory, "integration-camera", `${target}.png`));
  const { report } = validate(directory);
  assert.equal(report.status, "FAIL");
  assert.equal(report.integrity, "FAIL");
  assert.equal(report.checks.length, 32);
  assert.equal(report.checks.find((c) => c.name === target).integrity, "FAIL");
});

const completeTap =
  "# tests 7\n# pass 7\n# fail 0\n# skipped 0\n# todo 0\n# cancelled 0\n";
test("tool TAP parser accepts a complete nonempty zero-skip run", () => {
  const actual = inspectToolingRun(0, completeTap);
  assert.equal(actual.passed, true);
  assert.deepEqual(actual.stats, {
    total: 7,
    passed: 7,
    failed: 0,
    skipped: 0,
    todo: 0,
    cancelled: 0,
  });
});
test("tool TAP parser refuses zero, missing, skipped, todo, cancelled or nonzero-exit proof", () => {
  for (const [status, output] of [
    [0, ""],
    [
      0,
      completeTap
        .replace("# tests 7", "# tests 0")
        .replace("# pass 7", "# pass 0"),
    ],
    [0, completeTap.replace("# skipped 0", "# skipped 1")],
    [0, completeTap.replace("# todo 0", "# todo 1")],
    [0, completeTap.replace("# cancelled 0", "# cancelled 1")],
    [0, completeTap.replace("# fail 0", "# fail 1")],
    [1, completeTap],
  ])
    assert.equal(
      inspectToolingRun(status, output).passed,
      false,
      `${status}: ${output}`,
    );
});

function provenanceFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "vorqyn-driver-source-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=QA Fixture",
        "-c",
        "user.email=qa-fixture@example.invalid",
        ...args,
      ],
      { cwd: directory, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  const path = join(directory, "driver-marker.mjs");
  // Metadata-only fixture, never a product adapter and never executed.
  writeFileSync(path, "export const QA_METADATA_FIXTURE_ONLY = true;\n");
  git("add", "driver-marker.mjs");
  git("commit", "-qm", "QA metadata fixture only");
  return { path, root: directory, sha: git("rev-parse", "HEAD") };
}
test("driver fingerprint records exact committed bytes without claiming authority", (t) => {
  const fixture = provenanceFixture(t);
  const result = inspectDriverSource(fixture.path, [fixture]);
  assert.equal(result.status, "PASS");
  assert.equal(result.sourceSha, fixture.sha);
  assert.equal(result.sha256, digest(fixture.path));
  assert.match(result.scope, /no authority/);
});
test("modified or untracked driver bytes cannot borrow the recorded commit SHA", (t) => {
  const fixture = provenanceFixture(t);
  writeFileSync(fixture.path, "// QA tampering fixture, not executed\n");
  assert.equal(inspectDriverSource(fixture.path, [fixture]).status, "BLOCKED");
  const untracked = join(fixture.root, "untracked-marker.mjs");
  writeFileSync(untracked, "// QA untracked fixture, not executed\n");
  assert.equal(inspectDriverSource(untracked, [fixture]).status, "BLOCKED");
});
test("absent driver remains blocked rather than replaced by a fixture", () => {
  assert.equal(inspectDriverSource(undefined, []).status, "BLOCKED");
});
