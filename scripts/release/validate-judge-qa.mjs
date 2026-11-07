#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pngSize, sha256 } from "./lib.mjs";

const index = process.argv.indexOf("--dir");
if (index < 0 || !process.argv[index + 1])
  throw new Error("--dir <judge QA artifact directory> is required");
const root = resolve(process.argv[index + 1]);
const run = JSON.parse(readFileSync(join(root, "capture-run.json"), "utf8"));
const expected = [];
for (const theme of ["light", "dark"]) {
  expected.push({
    label: "css-root-zoom-200",
    theme,
    width: 1440,
    height: 900,
    dpr: 1,
    rootZoom: "2",
  });
  for (const [width, height] of [
    [1440, 900],
    [1024, 900],
    [390, 844],
    [320, 844],
  ]) {
    for (const route of ["home", "demo", "mission", "workspace", "draft"])
      expected.push({
        label: `shell-${route}`,
        theme,
        width,
        height,
        dpr: 1,
        rootZoom: "1",
      });
    if (width < 1024)
      expected.push({
        label: "mobile-menu",
        theme,
        width,
        height,
        dpr: 1,
        rootZoom: "1",
      });
    for (const state of [
      "clean-uw",
      "follow",
      "inspect",
      "fault-uw",
      "fault-inspector",
      "replay",
      "fallback",
    ])
      expected.push({
        label: `journey-${state}`,
        theme,
        width,
        height,
        dpr: 1,
        rootZoom: "1",
      });
    if ([1440, 390].includes(width))
      expected.push({
        label: "no-webgl",
        theme,
        width,
        height,
        dpr: 1,
        rootZoom: "1",
      });
  }
  for (const windowWidth of [1440, 2048])
    for (const route of ["home", "demo", "mission", "workspace", "draft"])
      expected.push({
        label: `native-200-${windowWidth}-${route}`,
        theme,
        width: windowWidth / 2,
        dpr: 2,
        rootZoom: "1",
      });
}
const directory = join(root, "screenshots");
const metas = readdirSync(directory)
  .filter((p) => p.endsWith(".json") && p !== "validation.json")
  .map((file) => JSON.parse(readFileSync(join(directory, file), "utf8")));
const results = expected.map((item) => {
  const matches = metas.filter(
    (meta) =>
      meta.name.startsWith(`${item.label}-${item.theme}-`) &&
      meta.viewport.width === item.width &&
      meta.viewport.dpr === item.dpr,
  );
  try {
    if (matches.length !== 1)
      throw new Error(`Expected one capture; found ${matches.length}`);
    const meta = matches[0],
      { width, height, dpr, rootZoom } = meta.viewport;
    const file = join(directory, `${meta.name}.png`),
      png = pngSize(file);
    const timestamp = Date.parse(meta.capturedAt),
      start = Date.parse(run.startedAt);
    if (
      !/^[a-f0-9]{40}$/.test(run.sourceSha) ||
      meta.commitSha !== run.sourceSha ||
      meta.runId !== run.id
    )
      throw new Error("Commit/run provenance mismatch");
    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(start) ||
      timestamp < start ||
      timestamp > Date.now() + 5000
    )
      throw new Error("Invalid/stale capture timestamp");
    if (
      !Number.isInteger(height) ||
      height <= 0 ||
      height !== (item.height ?? height) ||
      rootZoom !== item.rootZoom ||
      meta.theme !== item.theme
    )
      throw new Error("Viewport/zoom/theme mismatch");
    const native = dpr === 2;
    const pixels = native
      ? {
          width: Math.round(meta.viewport.visualViewport.width * dpr),
          height: Math.round(meta.viewport.visualViewport.height * dpr),
        }
      : { width, height };
    if (
      native &&
      (meta.viewport.visualViewport.width !== width ||
        Math.floor(meta.viewport.visualViewport.height) !== height ||
        meta.viewport.visualViewport.scale !== 1)
    )
      throw new Error("Native visual/layout viewport mismatch");
    if (
      meta.name !==
      `${item.label}-${item.theme}-${pixels.width}x${pixels.height}${native ? `-css${width}x${height}` : ""}-dpr${dpr}`
    )
      throw new Error("Filename does not match actual PNG and viewport");
    if (
      png.width !== pixels.width ||
      png.height !== pixels.height ||
      meta.png.width !== png.width ||
      meta.png.height !== png.height
    )
      throw new Error("Actual PNG IHDR/viewport/DPR mismatch");
    const options = meta.screenshotOptions;
    const correctOptions = native
      ? options.method === "Page.captureScreenshot" &&
        options.format === "png" &&
        options.fromSurface === true &&
        options.captureBeyondViewport === false &&
        options.clip === null
      : options.method === "Playwright page.screenshot" &&
        options.fullPage === false &&
        options.scale === "device" &&
        options.animations === "disabled";
    if (!correctOptions || meta.sha256 !== sha256(file))
      throw new Error("Screenshot options/integrity mismatch");
    if (
      !meta.source.startsWith("real Chromium;") ||
      !meta.url.startsWith("http://127.0.0.1:3110/") ||
      new URL(meta.url).search
    )
      throw new Error("Unexpected source or fixture query");
    return {
      label: item.label,
      theme: item.theme,
      width,
      height,
      status: "PASS",
      png,
      documentWidth: meta.layout.documentWidth,
    };
  } catch (error) {
    return { ...item, status: "FAIL", reason: error.message };
  }
});
if (
  metas.length !== expected.length ||
  readdirSync(directory).filter((p) => p.endsWith(".png")).length !==
    expected.length
)
  results.push({
    status: "FAIL",
    reason: "Unexpected/missing PNG or sidecar count",
  });
const report = {
  schema: "vorqyn.judge-qa-captures/1",
  sourceSha: run.sourceSha,
  status: results.some((r) => r.status === "FAIL") ? "FAIL" : "PASS",
  expected: expected.length,
  results,
  visualQuality:
    "NOT RUN by validator; inspect images separately. Layout failures remain in Playwright results.",
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
