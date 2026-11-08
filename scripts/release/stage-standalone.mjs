#!/usr/bin/env node
/** Stage an isolated Node payload from an actual preflight production build. */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2),
  value = (name) => args[args.indexOf(name) + 1];
if (!args.includes("--preflight") || !args.includes("--out"))
  throw new Error(
    "--preflight <report.json> --out <new directory outside checkout> required",
  );
const reportPath = resolve(value("--preflight")),
  out = resolve(value("--out"));
if (!relative(root, out).startsWith("../") || existsSync(out))
  throw new Error("Choose a new external output directory");
const raw = readFileSync(reportPath),
  source = JSON.parse(raw);
if (
  source.schema !== "vorqyn.release-preflight/1" ||
  !/^[a-f0-9]{40}$/.test(source.source?.sha) ||
  !source.checks.some((c) => c.id === "build" && c.status === "PASS")
)
  throw new Error("A real successful preflight build is required");
const web = join(dirname(reportPath), "snapshot/apps/web"),
  payload = join(out, "bundle");
if (!existsSync(join(web, ".next/standalone/apps/web/server.js")))
  throw new Error(
    "Standalone server missing; build with the approved Next standalone configuration",
  );
mkdirSync(out);
cpSync(join(web, ".next/standalone"), payload, {
  recursive: true,
  verbatimSymlinks: true,
});
cpSync(join(web, "public"), join(payload, "apps/web/public"), {
  recursive: true,
});
cpSync(join(web, ".next/static"), join(payload, "apps/web/.next/static"), {
  recursive: true,
});
let files = 0,
  symlinks = 0;
function inspect(directory, inDependencies = false) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isSymbolicLink()) {
      symlinks++;
      const target = relative(payload, realpathSync(path));
      if (target === ".." || target.startsWith("../") || target.startsWith("/"))
        throw new Error("Payload symlink escapes the isolated bundle");
    } else if (item.isDirectory())
      inspect(path, inDependencies || item.name === "node_modules");
    else {
      files++;
      if (
        !inDependencies &&
        (/^(?:\.env)(?:\.|$)/.test(item.name) ||
          /(?:wallet|keypair).*\.json$/i.test(item.name))
      )
        throw new Error(
          "Unexpected environment/wallet file in Node payload; values omitted",
        );
    }
  }
}
inspect(payload);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const report = {
  schema: "vorqyn.standalone-payload/1",
  status: "PASS",
  sourceSha: source.source.sha,
  preflightReportSha256: sha(raw),
  sourceTechnicalStatus: source.technicalStatus,
  sourceSubmissionStatus: source.submissionStatus,
  buildId: readFileSync(join(web, ".next/BUILD_ID"), "utf8").trim(),
  entry: "apps/web/server.js",
  serverSha256: sha(readFileSync(join(payload, "apps/web/server.js"))),
  files,
  symlinks,
  externalSymlinks: 0,
  payload,
  publicDeployment:
    "BLOCKED; staging a local Node bundle is not HTTPS deployment",
  createdAt: new Date().toISOString(),
};
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
