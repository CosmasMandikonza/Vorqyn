#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pngSize, sha256 } from "./lib.mjs";
const index = process.argv.indexOf("--dir");
if (index < 0) throw new Error("--dir <capture directory> is required");
const root = resolve(process.argv[index + 1]);
const run = JSON.parse(readFileSync(join(root, "../capture-run.json"), "utf8"));
const results = [];
for (const theme of ["light", "dark"])
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 844],
  ])
    for (const view of [
      "landing",
      "guest",
      "local-drafts",
      "viewer-reset",
      "viewer-uw",
      "viewer-inspect",
      "fallback",
      ...(width < 1024 ? ["mobile-inspector"] : []),
    ]) {
      const name = `${view}-${theme}-${width}x${height}`,
        png = join(root, `${name}.png`),
        json = join(root, `${name}.json`);
      try {
        if (!existsSync(png) || !existsSync(json))
          throw new Error("capture or measured browser sidecar missing");
        const actual = pngSize(png),
          meta = JSON.parse(readFileSync(json, "utf8"));
        if (
          actual.width !== width ||
          actual.height !== height ||
          meta.viewport.width !== width ||
          meta.viewport.height !== height ||
          meta.deviceScaleFactor !== 1 ||
          meta.fullPage !== false ||
          meta.runId !== run.id ||
          Date.parse(meta.capturedAt) < Date.parse(run.startedAt) ||
          meta.sha256 !== sha256(png)
        )
          throw new Error(
            "PNG dimensions, real viewport, DPR, crop flag or integrity hash mismatch",
          );
        results.push({ name, status: "PASS", ...actual });
      } catch (error) {
        results.push({ name, status: "FAIL", reason: error.message });
      }
    }
const report = {
  schema: "vorqyn.capture-validation/1",
  status: results.some((r) => r.status === "FAIL") ? "FAIL" : "PASS",
  expected: 46,
  results,
  visualReadability:
    "NOT RUN — dimension/hash validation cannot certify scene composition; inspect images and record observations",
};
writeFileSync(
  join(root, "validation.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      status: report.status,
      expected: report.expected,
      passed: results.filter((r) => r.status === "PASS").length,
      failed: results.filter((r) => r.status === "FAIL"),
    },
    null,
    2,
  ),
);
process.exitCode = report.status === "PASS" ? 0 : 1;
