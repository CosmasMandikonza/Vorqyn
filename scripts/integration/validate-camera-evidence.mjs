#!/usr/bin/env node
/** Independently validate the new 32-state full-row captures; integrity and layout are separate results. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pngSize, sha256 } from "../release/lib.mjs";
const args = process.argv.slice(2),
  index = args.indexOf("--dir");
if (index < 0 || !args[index + 1])
  throw new Error("--dir <browser artifact directory> required");
const root = resolve(args[index + 1]);
const run = JSON.parse(readFileSync(join(root, "capture-run.json"), "utf8"));
const checks = [];
for (const theme of ["light", "dark"])
  for (const width of [320, 390, 1024, 1440])
    for (const state of ["clean-uw", "follow", "inspect", "fault-uw"]) {
      const height = width < 400 ? 844 : 900;
      const name = `full-row-${state}-${theme}-${width}x${height}`;
      try {
        const meta = JSON.parse(
          readFileSync(
            join(root, "integration-camera", `${name}.json`),
            "utf8",
          ),
        );
        const png = join(root, "integration-camera", `${name}.png`),
          size = pngSize(png);
        const names = meta.controls.map((c) => c.name).sort();
        if (
          !/^[a-f0-9]{40}$/.test(meta.sourceSha) ||
          meta.sourceSha !== run.sourceSha ||
          meta.runId !== run.id ||
          meta.theme !== theme ||
          meta.viewport.width !== width ||
          meta.viewport.height !== height ||
          meta.viewport.dpr !== 1 ||
          meta.png.width !== width ||
          meta.png.height !== height ||
          size.width !== width ||
          size.height !== height ||
          sha256(png) !== meta.sha256 ||
          meta.hasTouch !== width < 400 ||
          meta.screenshotOptions.fullPage !== false ||
          meta.screenshotOptions.scale !== "device" ||
          meta.screenshotOptions.animations !== "disabled" ||
          JSON.stringify(names) !==
            JSON.stringify(["AIR", "FOLLOW", "INSPECT", "LAND", "RESET", "UW"])
        )
          throw new Error(
            "Source/run/theme/viewport/touch/PNG/hash/options/control inventory mismatch",
          );
        const left = Math.max(0, meta.frame.left),
          right = Math.min(width, meta.frame.right);
        if (
          ![
            left,
            right,
            meta.documentWidth,
            ...meta.controls.flatMap((c) => [
              c.rect.left,
              c.rect.right,
              c.rect.width,
              c.rect.height,
            ]),
          ].every(Number.isFinite)
        )
          throw new Error("Missing finite DOM geometry");
        const offenders = meta.controls.filter(
          (c) =>
            c.rect.left < left ||
            c.rect.right > right ||
            c.rect.height < 44 ||
            c.rect.width < 24,
        );
        checks.push({
          name,
          integrity: "PASS",
          layout:
            offenders.length || meta.documentWidth > width ? "FAIL" : "PASS",
          documentWidth: meta.documentWidth,
          frameBounds: { left, right },
          offenders,
          sha256: meta.sha256,
        });
      } catch (error) {
        checks.push({
          name,
          integrity: "FAIL",
          layout: "NOT RUN",
          reason: error.message,
        });
      }
    }
const integrity = checks.every((c) => c.integrity === "PASS") ? "PASS" : "FAIL";
const layout =
  integrity === "PASS"
    ? checks.every((c) => c.layout === "PASS")
      ? "PASS"
      : "FAIL"
    : "NOT RUN";
const report = {
  schema: "vorqyn.integration-camera-validation/1",
  sourceSha: run.sourceSha,
  runId: run.id,
  status: integrity === "PASS" && layout === "PASS" ? "PASS" : "FAIL",
  integrity,
  layout,
  expected: 32,
  layoutPassed: checks.filter((c) => c.layout === "PASS").length,
  layoutFailed: checks.filter((c) => c.layout === "FAIL").length,
  checks,
};
writeFileSync(
  join(root, "camera-validation.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    status: report.status,
    integrity,
    layout,
    expected: report.expected,
    layoutPassed: report.layoutPassed,
    layoutFailed: report.layoutFailed,
  }),
);
process.exitCode = report.status === "PASS" ? 0 : 1;
