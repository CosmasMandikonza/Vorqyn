/** Fingerprint an explicitly supplied QA driver. Provenance is not authentication or workflow proof. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const hash = (data) => createHash("sha256").update(data).digest("hex");
export function inspectDriverSource(path, sources) {
  if (!path)
    return {
      status: "BLOCKED",
      reason:
        "No owner-reviewed orchestration driver supplied; no substitute is created",
    };
  const absolute = resolve(path);
  if (!existsSync(absolute) || !statSync(absolute).isFile())
    return {
      status: "BLOCKED",
      path: absolute,
      reason: "Supplied driver file unavailable",
    };
  const bytes = readFileSync(absolute),
    sha256 = hash(bytes);
  for (const source of sources) {
    const gitPath = relative(source.root, absolute);
    if (!gitPath || gitPath === ".." || gitPath.startsWith("../")) continue;
    const committed = spawnSync("git", ["show", `${source.sha}:${gitPath}`], {
      cwd: source.root,
    });
    if (committed.status === 0 && hash(committed.stdout) === sha256)
      return {
        status: "PASS",
        scope:
          "Committed driver-byte provenance only; no authority or workflow attestation",
        path: absolute,
        sha256,
        gitRoot: source.root,
        gitPath,
        sourceSha: source.sha,
      };
  }
  return {
    status: "BLOCKED",
    path: absolute,
    sha256,
    reason:
      "Driver bytes are not attributable to either recorded harness or target commit; commit/review the real binding before execution",
  };
}
