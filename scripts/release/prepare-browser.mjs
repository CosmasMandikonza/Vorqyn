import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
export default function prepare() {
  if (process.env.RELEASE_STAGE === "integration") return;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const out =
    process.env.RELEASE_ARTIFACT_DIR ??
    resolve(root, "../release-browser-results");
  if (
    existsSync(join(out, "screenshots")) ||
    existsSync(join(out, "capture-run.json"))
  )
    throw new Error(
      "Choose a fresh RELEASE_ARTIFACT_DIR; stale captures must never certify a new run",
    );
  mkdirSync(out, { recursive: true });
  const git = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  writeFileSync(
    join(out, "capture-run.json"),
    JSON.stringify(
      {
        id: randomUUID(),
        startedAt: new Date().toISOString(),
        sourceSha:
          process.env.RELEASE_SOURCE_SHA ??
          (git.status === 0 ? git.stdout.trim() : null),
      },
      null,
      2,
    ) + "\n",
  );
}
