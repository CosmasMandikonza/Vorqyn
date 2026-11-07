/* VQ-14 evidence capture v2 — corrected per CTO review P1-B.
   Captures FULL-VIEWPORT shots at the actual requested viewports (no frame
   clipping), validates every PNG's IHDR against the expected viewport
   dimensions, rejects mismatches (exit 1), and writes a manifest with
   source SHA, capture timestamp, image SHA-256 and actual dimensions.

   Run: node capture-r2.mjs <sourceHeadSha>   (production build on :3000) */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve @playwright/test from apps/web (pnpm workspace layout), following
// the same pattern as scripts/release/playwright.config.mjs.
const HERE = dirname(fileURLToPath(import.meta.url)); // docs/evidence/vq-14-visual-r2/tools
const WEB = resolve(HERE, "../../../../apps/web"); // apps/web
const REPO = resolve(WEB, "../..");
const requireFromWeb = createRequire(join(WEB, "package.json"));
const { chromium } = requireFromWeb("@playwright/test");

const OUT = join(REPO, "docs/evidence/vq-14-visual-r2");
const HEAD = process.argv[2] ?? "unknown";
mkdirSync(OUT, { recursive: true });

function pngDimensions(file) {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(12) !== 0x49484452) throw new Error("not a PNG IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const capturedAt = new Date().toISOString();
const manifest = [];

const browser = await chromium.launch();

/* ---------- desktop 1440x900 (full viewport, fullPage false) ---------- */
{
  const expected = { width: 1440, height: 900 };
  const page = await browser.newPage({ viewport: expected, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:3000/demo/mission?fixture=1");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(7000);
  await page.evaluate(() => {
    window.localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Start synthetic survey")?.click();
  });
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Run playback")?.click();
  });
  await page.waitForTimeout(4500);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Pause playback")?.click();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/r2-desktop-running-light.png`, fullPage: false });
  // fault journey
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Inject underwater optical fault")?.click();
  });
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Advance +1 step")?.click();
  });
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Inspection ROV"))?.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="group"][aria-label="Camera station"] button')].find((b) => b.textContent?.trim() === "UW")?.click();
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/r2-desktop-fault-uw-light.png`, fullPage: false });
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="group"][aria-label="Camera station"] button')].find((b) => b.textContent?.trim() === "INSPECT")?.click();
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/r2-desktop-inspect-light.png`, fullPage: false });
  // dark theme
  await page.evaluate(() => {
    window.localStorage.setItem("theme", "dark");
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="group"][aria-label="Camera station"] button')].find((b) => b.textContent?.trim() === "RESET")?.click();
  });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/r2-desktop-reset-dark.png`, fullPage: false });
  await page.close();
}

/* ---------- mobile 390x844 and 320x844 ---------- */
for (const [w, h, tag] of [[390, 844, "390"], [320, 844, "320"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:3000/demo/mission?fixture=1");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    window.localStorage.setItem("theme", "light");
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Start synthetic survey")?.click();
  });
  await page.waitForTimeout(1800);
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
  );
  await page.screenshot({ path: `${OUT}/r2-mobile-${tag}-light.png`, fullPage: false });
  const overflowNote = pageOverflow ? "PAGE HORIZONTALLY OVERFLOWS" : "no page-level horizontal overflow";
  console.log(`[mobile ${tag}] ${overflowNote}`);
  await page.close();
}

/* ---------- IHDR validation against expected viewport ---------- */
const expectedMap = {
  "r2-desktop-running-light.png": { width: 1440, height: 900 },
  "r2-desktop-fault-uw-light.png": { width: 1440, height: 900 },
  "r2-desktop-inspect-light.png": { width: 1440, height: 900 },
  "r2-desktop-reset-dark.png": { width: 1440, height: 900 },
  "r2-mobile-390-light.png": { width: 390, height: 844 },
  "r2-mobile-320-light.png": { width: 320, height: 844 },
};

let failures = 0;
for (const [name, expected] of Object.entries(expectedMap)) {
  const path = `${OUT}/${name}`;
  const data = readFileSync(path);
  const dims = pngDimensions(path);
  const ok = dims.width === expected.width && dims.height === expected.height;
  if (!ok) failures += 1;
  manifest.push({
    file: name,
    expected: `${expected.width}x${expected.height}`,
    actual: `${dims.width}x${dims.height}`,
    ok,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
  console.log(`${ok ? "OK " : "BAD"} ${name} ${dims.width}x${dims.height} (expected ${expected.width}x${expected.height})`);
}

const manifestDoc = {
  schema: "vorqyn.vq14-captures/2",
  sourceHeadSha: HEAD,
  capturedAtUtc: capturedAt,
  captureTool: "docs/evidence/vq-14-visual-r2/tools/capture-r2.mjs",
  browser: "Playwright Chromium (deviceScaleFactor 1, fullPage false)",
  validation: "IHDR dimensions must equal the requested viewport; mismatches fail the run (exit 1)",
  note: "Supersedes vq-14-visual/capture-manifest.json whose entries 05/06/07/10 recorded 1344x559 canvas-frame crops under 1440x900 labels with ok:true — corrected here by strict IHDR validation.",
  captures: manifest,
};
writeFileSync(`${OUT}/capture-manifest.json`, JSON.stringify(manifestDoc, null, 2) + "\n");

await browser.close();
if (failures > 0) {
  console.error(`CAPTURE VALIDATION FAILED: ${failures} dimension mismatch(es)`);
  process.exit(1);
}
console.log("ALL CAPTURES VALIDATED");
