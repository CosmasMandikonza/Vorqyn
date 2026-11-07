#!/usr/bin/env node
/**
 * Syncs the merged PORT-001 asset pack into apps/web/public/port-world/.
 *
 * Source of truth: /assets/port-world (owned by Issue #19 / PR #22 — FORBIDDEN
 * to edit from the viewer workstream). This script only READS the source pack,
 * copies runtime files, and verifies every copy's sha256 against the source
 * manifest.json before reporting success.
 *
 * Run from apps/web/:  node tests/mission-world/sync-port-world.mjs
 * The companion vitest suite (asset-sync.test.tsx) re-verifies the copies on
 * every test run, so a drifted or hand-edited copy fails CI.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../..");
const REPO = path.resolve(WEB, "../..");
const SRC = path.join(REPO, "assets", "port-world");
const DEST = path.join(WEB, "public", "port-world");

const COPIES = [
  "models/port-world-high.glb",
  "models/port-world-low.glb",
  "models/drone-ref.glb",
  "models/rover-ref.glb",
  "models/rov-ref.glb",
  "world.json",
  "previews/plan-view.svg",
];

const manifest = JSON.parse(readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

mkdirSync(DEST, { recursive: true });
let failures = 0;
for (const rel of COPIES) {
  const src = path.join(SRC, rel);
  const dest = path.join(DEST, rel.split("/").pop());
  const entry = manifest.files.find((f) => f.path === rel);
  if (!entry) {
    console.error(`[sync] FAIL ${rel}: not listed in source manifest.json`);
    failures += 1;
    continue;
  }
  const srcHash = sha256(src);
  if (srcHash !== entry.sha256) {
    console.error(`[sync] FAIL ${rel}: SOURCE does not match its own manifest (regenerate the asset pack)`);
    failures += 1;
    continue;
  }
  copyFileSync(src, dest);
  const destHash = sha256(dest);
  if (destHash !== srcHash) {
    console.error(`[sync] FAIL ${rel}: copy hash mismatch`);
    failures += 1;
    continue;
  }
  console.log(`[sync] ok ${rel.split("/").pop()} (${entry.bytes} bytes, sha256 verified)`);
}
if (failures > 0) {
  console.error(`[sync] ${failures} failure(s) — public copies are NOT trustworthy`);
  process.exit(1);
}
console.log("[sync] all public port-world copies verified against assets/port-world/manifest.json");
