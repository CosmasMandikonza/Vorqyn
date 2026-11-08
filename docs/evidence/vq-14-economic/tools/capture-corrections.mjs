/* PR #53 review-correction evidence captures (2026-11-08).

   Production build (`pnpm build` + `next start` on 127.0.0.1:3000), real
   Playwright input only. Themes are set through the REAL next-themes
   storage key ("vorqyn-theme") followed by a reload, and the effective
   theme is asserted on <html> before any capture — no class-toggle-only
   fakes. PNG IHDR dimensions are verified in-run against the table in
   ../corrections/README.md.

   Captures:
   1. disabled-FOLLOW light/dark (fresh page, gate closed, dimmed control)
   2. selected-station light/dark (AIR pressed: filled brand pill)
   3. fixture walkthrough handoff panel at 1440 (honest stage badges)
   4. measured fault journey (inspector optical drop + timeline)      */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
// tools -> vq-14-economic -> evidence -> docs -> repo root
const require = createRequire(join(dir, "../../../../apps/web/package.json"));
const { chromium } = require("@playwright/test");

const OUT = join(dir, "..", "corrections");
const BASE = process.env.AUDIT_BASE ?? "http://127.0.0.1:3000";
const captures = [];
let failures = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 320, height: 844 }, deviceScaleFactor: 1 });

async function openMission() {
  await page.goto(`${BASE}/demo/mission?fixture=1`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(7000); // GLB decode + world metadata (SwiftShader)
}

/** Theme via the REAL provider key + reload; assert the effective theme. */
async function setTheme(theme) {
  await page.evaluate((t) => window.localStorage.setItem("vorqyn-theme", t), theme);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(7000);
  const applied = await page.evaluate((t) => document.documentElement.classList.contains(t), theme);
  if (!applied) throw new Error(`effective theme "${theme}" not applied on <html>`);
}

async function shoot(name, locator, expectW, expectH) {
  const path = join(OUT, `${name}.png`);
  await locator.screenshot({ path });
  const buf = readFileSync(path);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const ok = expectW === undefined || (w === expectW && h === expectH);
  if (!ok) failures += 1;
  captures.push({ name, width: w, height: h, ihdrOk: ok });
  console.log(`[${name}] ${w}x${h} ${ok ? "OK" : "IHDR MISMATCH"}`);
}

const group = page.locator('[role="group"][aria-label="Camera station"]');
const frame = page.locator('[data-testid="world-canvas-frame"]');

// establish the app origin first so localStorage is accessible below
await openMission();

/* 1. Disabled FOLLOW, gate closed (fresh page, no session) — light + dark.
      The station group renders 256px wide at the 320 viewport (inside the
      280px frame gutter) and ~103px tall with the two-row grid. */
for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await shoot(`camera-320-${theme}-follow-disabled`, group, 256, 103);
}
const disabledProbe = await page.evaluate(() => {
  const b = [...document.querySelectorAll('[role="group"][aria-label="Camera station"] button')].find(
    (x) => x.textContent?.trim() === "FOLLOW",
  );
  return { disabled: b?.hasAttribute("disabled"), opacity: getComputedStyle(b).opacity };
});
console.log("[probe] FOLLOW disabled:", JSON.stringify(disabledProbe));
if (!disabledProbe.disabled || Number(disabledProbe.opacity) >= 1) failures += 1;

/* 2. Selected station (AIR pressed: filled pill) — light + dark, with a
      live session so FOLLOW is enabled (gate open journey) */
for (const theme of ["light", "dark"]) {
  await setTheme(theme);
  await page.getByRole("button", { name: "Start synthetic survey" }).click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Advance +1 step" }).click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Access rover" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "AIR", exact: true }).click();
  await page.waitForTimeout(600);
  const probe = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[role="group"][aria-label="Camera station"] button')];
    const pressed = buttons.find((b) => b.getAttribute("aria-pressed") === "true");
    const follow = buttons.find((b) => b.textContent?.trim() === "FOLLOW");
    return {
      pressedBg: pressed ? getComputedStyle(pressed).backgroundColor : null,
      unpressedBg: buttons.filter((b) => b !== pressed).map((b) => getComputedStyle(b).backgroundColor),
      followDisabled: follow?.hasAttribute("disabled"),
    };
  });
  console.log(`[${theme}] probe:`, JSON.stringify(probe));
  if (!probe.pressedBg || probe.pressedBg === "rgba(0, 0, 0, 0)") failures += 1;
  if (probe.followDisabled) failures += 1;
  await shoot(`camera-320-${theme}-air-selected`, group);
  await shoot(`camera-320-${theme}-viewport`, page, 320, 844);
}

/* 3. Fixture walkthrough handoff panel at 1440 — honest stage badges */
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "Load recorded fixture walkthrough" }).click();
await page.waitForTimeout(3000);
const panel = page.locator('[data-testid="handoff-panel"]');
const panelOk = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="handoff-panel"]');
  if (!el) return null;
  const text = el.textContent;
  return {
    hasConfirmed: text.includes("CONFIRMED"),
    hasFixtureBadge: Boolean(document.querySelector('[data-testid="handoff-source-badge"]')?.textContent.includes("FIXTURE")),
    noInitiatedClaim: !text.includes("payout initiated"),
    payoutSig: text.includes("VQsigPayoutSeaTx"),
  };
});
console.log("[probe] walkthrough panel:", JSON.stringify(panelOk));
if (!panelOk?.hasConfirmed || !panelOk?.hasFixtureBadge || !panelOk?.noInitiatedClaim || !panelOk?.payoutSig) failures += 1;
await shoot("handoff-fixture-walkthrough-1440", panel);

/* 4. Measured fault journey — kernel fault, measured optical drop, timeline.
      The severe-fault badge reads on the ROV sensor panel: select it. */
await page.getByRole("button", { name: "Inspection ROV" }).click();
await page.getByRole("button", { name: "Inject underwater optical fault" }).click();
await page.waitForTimeout(1800);
await page.getByRole("button", { name: "Advance +1 step" }).click();
await page.waitForTimeout(2000);
const faultOk = await page.evaluate(() => {
  const overlay = document.querySelector('[data-testid="inspector-overlay"]');
  const timelineText = document.body.textContent ?? "";
  return {
    faultBadge: Boolean(overlay && /Active optical-visibility fault: severe/.test(overlay.textContent ?? "")),
    timelineShown: timelineText.includes("fault injected"),
  };
});
console.log("[probe] fault journey:", JSON.stringify(faultOk));
if (!faultOk?.faultBadge || !faultOk?.timelineShown) failures += 1;
await shoot("measured-fault-1440", frame);

writeFileSync(
  join(OUT, "capture-manifest.json"),
  JSON.stringify({ failures, total: captures.length, base: BASE, captures }, null, 2),
);
console.log(`CAPTURES COMPLETE: ${captures.length - failures}/${captures.length} ok`);
await browser.close();
if (failures > 0) process.exit(1);
