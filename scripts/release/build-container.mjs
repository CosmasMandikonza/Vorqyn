#!/usr/bin/env node
/** Build committed source only. No registry push, deployment or login. */
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { resolve, dirname, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCredentials } from "./lib.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2),
  index = args.indexOf("--out");
if (index < 0 || !args[index + 1])
  throw new Error("--out <new directory outside checkout> is required");
const out = resolve(args[index + 1]);
const rel = relative(root, out);
if (!(rel === ".." || rel.startsWith("../")) || existsSync(out))
  throw new Error("Choose a NEW artifact directory outside the checkout");
mkdirSync(out, { recursive: true });
const run = (cmd, argv, options = {}) => {
  const r = spawnSync(cmd, argv, { cwd: root, encoding: "utf8", ...options });
  if (r.error || r.status !== 0)
    throw new Error(
      `${cmd} failed (${r.error?.code ?? r.status}); inspect the recorded command log`,
    );
  return r.stdout?.trim();
};
const sha = run("git", ["rev-parse", "HEAD"]),
  tag = `vorqyn-judge:${sha.slice(0, 12)}`;
const report = {
  schema: "vorqyn.container-build/1",
  status: "NOT RUN",
  sourceSha: sha,
  workingTreeDirty: !!run("git", ["status", "--porcelain"]),
  tag,
  publicDeployment: "BLOCKED — local image build is not public hosting",
  startedAt: new Date().toISOString(),
};
try {
  const archive = join(out, "source.tar"),
    fd = openSync(archive, "w");
  try {
    run("git", ["archive", "--format=tar", sha], {
      stdio: ["ignore", fd, "pipe"],
    });
  } finally {
    closeSync(fd);
  }
  const context = join(out, "context");
  mkdirSync(context);
  run("tar", ["-xf", archive, "-C", context]);
  const findings = inspectCredentials(context);
  if (findings.length) {
    report.credentialFindings = findings;
    throw new Error("Committed credential patterns found; values omitted");
  }
  const env = { ...process.env };
  for (const name of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
  ])
    delete env[name];
  const docker = ["--host=unix:///var/run/docker.sock"];
  report.phase = "daemon";
  run("docker", [...docker, "info", "--format", "{{.ServerVersion}}"], { env });
  report.phase = "build";
  const log = openSync(join(out, "build.txt"), "w");
  const command = [
    ...docker,
    "build",
    "--progress=plain",
    "--file",
    "scripts/release/deploy/Dockerfile",
    "--build-arg",
    `VORQYN_BUILD_SHA=${sha}`,
    "--tag",
    tag,
  ];
  if (process.env.CODEX_PROXY_CERT)
    command.push("--secret", `id=proxy_ca,src=${process.env.CODEX_PROXY_CERT}`);
  command.push(".");
  report.command = [
    "docker",
    ...command.map((value) =>
      value.startsWith("id=proxy_ca,")
        ? "id=proxy_ca,src=<session CA path>"
        : value,
    ),
  ];
  try {
    run("docker", command, {
      cwd: context,
      env,
      stdio: ["ignore", log, log],
      timeout: 900000,
    });
  } finally {
    closeSync(log);
  }
  report.imageId = run(
    "docker",
    [...docker, "image", "inspect", tag, "--format", "{{.Id}}"],
    { env },
  );
  report.revisionLabel = run(
    "docker",
    [
      ...docker,
      "image",
      "inspect",
      tag,
      "--format",
      '{{index .Config.Labels "org.opencontainers.image.revision"}}',
    ],
    { env },
  );
  if (report.revisionLabel !== sha)
    throw new Error("Image revision label mismatch");
  report.status = "PASS";
} catch (error) {
  const buildLog = existsSync(join(out, "build.txt"))
    ? readFileSync(join(out, "build.txt"), "utf8")
    : "";
  report.status =
    report.phase === "daemon" ||
    /ENOSPC|no space left on device/i.test(buildLog)
      ? "BLOCKED"
      : "FAIL";
  report.reason = error.message;
  if (/ENOSPC|no space left on device/i.test(buildLog))
    report.reason =
      "Docker build exceeded available filesystem capacity (ENOSPC); no public deployment occurred";
  process.exitCode = 2;
}
report.finishedAt = new Date().toISOString();
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
