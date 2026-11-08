/* 32-state camera-row audit (Issue #15 P0 correction, branch fix/lane2-camera-row-320).

   Decomposition: 4 viewports (320/390/1024/1440) x 2 themes (light/dark)
   x 4 key stations (RESET -> AIR -> UW -> FOLLOW) = 32 audited states. The
   key set covers both defect stations from the extended browser audit
   (FOLLOW overflowing to x=353.75 and RESET clipped to x=-34 after a
   station change) plus the transitions between them. The exhaustive
   six-station walk lives in apps/web/tests/browser/mission-world.spec.ts.

   Method: real Playwright input (locator clicks on the native buttons — no
   DOM-dispatch shortcuts), session started and a machine selected after
   every page load so FOLLOW's honest gate (sessionActive && selectedLive)
   is genuinely exercised, whole-row geometry asserted after EVERY station
   change: every button fully within the viewport, hit-test resolves to the
   button itself, >= 44px tall, no internal scroll, no page-level horizontal
   overflow, and exactly the intended station pressed.

   Captures the 320px light/dark evidence shots against the production build. */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
// tools -> vq-14-visual -> evidence -> docs -> repo root
const require = createRequire(join(dir, "../../../../apps/web/package.json"));
const { chromium } = require("@playwright/test");

const OUT = join(dir, "..");
const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3000";
const STATIONS = ["RESET", "AIR", "UW", "FOLLOW"];
const results = [];
let failures = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 320, height: 844 }, deviceScaleFactor: 1 });

async function openMission() {
  await page.goto(`${BASE}/demo/mission?fixture=1`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(7000); // GLB decode + world metadata (SwiftShader)
  // FOLLOW requires an active session that is actually producing
  // observations (the start response alone carries no snapshots) plus a
  // selection — honest gate, exercised through the real UI journey.
  await page.getByRole("button", { name: "Start synthetic survey" }).click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Advance +1 step" }).click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Access rover" }).click();
  await page.waitForTimeout(300);
}

async function auditRow(width, theme, station) {
  // Rects are viewport-relative: bring the station bar into view first.
  await page.evaluate(() => {
    const group = document.querySelector('[role="group"][aria-label="Camera station"]');
    group?.scrollIntoView({ block: "center", behavior: "instant" });
  });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const group = document.querySelector('[role="group"][aria-label="Camera station"]');
    if (!group) return { missing: true };
    const vw = document.documentElement.clientWidth;
    const buttons = [...group.querySelectorAll("button")].map((b) => {
      const rect = b.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        label: b.textContent?.trim(),
        left: Math.round(rect.left * 100) / 100,
        right: Math.round(rect.right * 100) / 100,
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        inViewport: rect.left >= 0 && rect.right <= vw && rect.top >= 0 && rect.bottom <= window.innerHeight,
        hitOk: hit === b || b.contains(hit),
        heightOk: rect.height >= 44,
        pressed: b.getAttribute("aria-pressed"),
        disabled: b.hasAttribute("disabled"),
      };
    });
    return {
      width: vw,
      allVisible: buttons.every((b) => b.inViewport),
      allHitOk: buttons.every((b) => b.hitOk),
      allHeightOk: buttons.every((b) => b.heightOk),
      noneDisabled: buttons.every((b) => !b.disabled),
      pressed: buttons.filter((b) => b.pressed === "true").map((b) => b.label),
      pageOverflow: document.documentElement.scrollWidth > vw + 2,
      internalScroll: group.scrollWidth > group.clientWidth + 1,
      buttons,
    };
  });
  const pass =
    !r.missing &&
    r.allVisible === true &&
    r.allHitOk === true &&
    r.allHeightOk === true &&
    r.noneDisabled === true &&
    r.pageOverflow === false &&
    r.internalScroll === false &&
    Array.isArray(r.pressed) &&
    r.pressed.length === 1 &&
    r.pressed[0] === station;
  if (!pass) failures += 1;
  results.push({ width, theme, station, pass, detail: r });
  console.log(
    `[${width} ${theme} after->${station}] ${pass ? "PASS" : "FAIL"} pressed=${JSON.stringify(r.pressed ?? null)}`,
  );
}

/* 32 states: every viewport x theme combo, RESET -> AIR -> UW -> FOLLOW */
// establish the app origin first so localStorage is accessible below
await page.goto(`${BASE}/demo/mission?fixture=1`);
await page.waitForLoadState("domcontentloaded");
for (const theme of ["light", "dark"]) {
  await page.evaluate((t) => {
    window.localStorage.setItem("theme", t);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(t);
  }, theme);
  await page.reload();
  await openMission();
  for (const station of STATIONS) {
    await page.getByRole("button", { name: station, exact: true }).click();
    await page.waitForTimeout(900);
    await auditRow(320, theme, station);
  }
  for (const width of [390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(800);
    for (const station of STATIONS) {
      await page.getByRole("button", { name: station, exact: true }).click();
      await page.waitForTimeout(900);
      await auditRow(width, theme, station);
    }
  }
  // back to 320 for the next theme's reload
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForTimeout(800);
}

/* Evidence screenshots at 320 (light + dark), RESET station, production
   build: full-viewport (320x844) AND canvas-frame crops. */
await page.reload();
await openMission();
await page.getByRole("button", { name: "RESET", exact: true }).click();
await page.waitForTimeout(900);
const frame = page.locator('[data-testid="world-canvas-frame"]');
await page.screenshot({ path: join(OUT, "camera-row-320-light-viewport.png") });
await frame.screenshot({ path: join(OUT, "camera-row-320-light-frame.png") });
await page.evaluate(() => {
  const root = document.documentElement;
  root.classList.remove("light");
  root.classList.add("dark");
});
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, "camera-row-320-dark-viewport.png") });
await frame.screenshot({ path: join(OUT, "camera-row-320-dark-frame.png") });

writeFileSync(
  join(OUT, "camera-row-audit.json"),
  JSON.stringify(
    {
      failures,
      total: results.length,
      base: BASE,
      decomposition: "4 viewports (320/390/1024/1440) x 2 themes x 4 key stations (RESET/AIR/UW/FOLLOW)",
      results: results.map(({ width, theme, station, pass, detail }) => ({
        width,
        theme,
        station,
        pass,
        pressed: detail.pressed,
        allVisible: detail.allVisible,
        allHitOk: detail.allHitOk,
        pageOverflow: detail.pageOverflow,
      })),
    },
    null,
    2,
  ),
);
console.log(`AUDIT COMPLETE: ${results.length - failures}/${results.length} rows pass`);
await browser.close();
if (failures > 0) process.exit(1);
