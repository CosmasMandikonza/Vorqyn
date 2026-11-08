#!/usr/bin/env node
/** Audit the measured camera rows after station changes, not only focused buttons. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pngSize, sha256 } from "./lib.mjs";
const args = process.argv.slice(2);
const index = args.indexOf("--dir");
if (index < 0 || !args[index + 1]) throw new Error("--dir <judge QA directory> required");
const root = resolve(args[index + 1]);
const checks = [];
for (const theme of ["light", "dark"])
  for (const width of [1440, 1024, 390, 320])
    for (const state of ["clean-uw", "follow", "inspect", "fault-uw"]) {
      const name = `journey-${state}-${theme}-${width}x${width < 400 ? 844 : 900}-dpr1`;
      try {
        const meta = JSON.parse(readFileSync(join(root, "screenshots", `${name}.json`)));
        const png = join(root, "screenshots", `${name}.png`);
        const size = pngSize(png);
        if (sha256(png) !== meta.sha256 || size.width !== width || size.height !== meta.viewport.height)
          throw new Error("PNG hash/dimensions disagree with measured sidecar");
        const offenders = meta.layout.offenders.filter((item) =>
          item.tag === "BUTTON" && ["RESET", "AIR", "LAND", "UW", "INSPECT", "FOLLOW"].includes(item.text) &&
          (item.rect.left < 0 || item.rect.right > width));
        checks.push({ name, status: offenders.length ? "FAIL" : "PASS", sourceSha: meta.commitSha, viewport: meta.viewport, offenders });
      } catch (error) {
        checks.push({ name, status: "FAIL", reason: error.message });
      }
    }
const failed = checks.filter((item) => item.status === "FAIL").length;
const report = {
  schema: "vorqyn.camera-capture-audit/1", status: failed ? "FAIL" : "PASS",
  scope: "Existing genuine screenshots and measured DOM sidecars; no new browser execution. Checks viewport bounds, not full accessibility or within-container clipping.",
  expected: 32, passed: checks.length - failed, failed, checks,
};
writeFileSync(join(root, "camera-capture-audit.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: report.status, expected: report.expected, passed: report.passed, failed }));
process.exitCode = failed ? 1 : 0;
