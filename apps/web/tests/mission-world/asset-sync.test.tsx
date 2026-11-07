import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard against a drifted, hand-edited or stale copy of the port-world pack
 * in public/. Every runtime asset must be byte-identical to the authoritative
 * source pack that CI validates under assets/port-world (PR #25).
 */
const REPO = path.resolve(__dirname, "../../../..");
const SOURCE_MANIFEST = JSON.parse(
  readFileSync(path.resolve(REPO, "assets/port-world/manifest.json"), "utf8"),
);

const RUNTIME_FILES = [
  "port-world-high.glb",
  "port-world-low.glb",
  "drone-ref.glb",
  "rover-ref.glb",
  "rov-ref.glb",
  "world.json",
  "plan-view.svg",
] as const;

describe("public/port-world copies match the authoritative asset pack", () => {
  it.each(RUNTIME_FILES)("%s is byte-identical to the source manifest entry", (name) => {
    const sourceEntry = SOURCE_MANIFEST.files.find(
      (f: { path: string }) => f.path === `models/${name}` || f.path === name || f.path.endsWith(name),
    );
    expect(sourceEntry, `${name} missing from assets/port-world/manifest.json`).toBeTruthy();
    const copy = readFileSync(path.resolve(REPO, "apps/web/public/port-world", name));
    expect(copy.length).toBe(sourceEntry.bytes);
    const sha = createHash("sha256").update(copy).digest("hex");
    expect(sha).toBe(sourceEntry.sha256);
  });

  it("sync script exists so the procedure is repeatable", () => {
    const script = readFileSync(
      path.resolve(REPO, "apps/web/tests/mission-world/sync-port-world.mjs"),
      "utf8",
    );
    expect(script).toContain("manifest.json");
  });
});
