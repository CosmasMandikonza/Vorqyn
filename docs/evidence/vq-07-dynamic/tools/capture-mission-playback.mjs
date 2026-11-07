/* Scratch capture script (outside repo): drives the production build with a
   real Playwright Chromium and captures the DEMO-02 evidence set.
   Run: node ../scratch/capture-mission-playback.mjs   (server already on :3000) */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const OUT = "C:/Users/cmandikonza/.zcode/workspace/draft-5be875ff-c89d-4890-95aa-9d233922aa70/agent-b-3d-playback/docs/evidence/vq-07-dynamic";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console.error]", msg.text().slice(0, 160));
});

async function clickButton(label, exact = true) {
  await page.evaluate(([m, ex]) => {
    const target = [...document.querySelectorAll("button")].find((b) => {
      const t = (b.textContent ?? "").trim();
      return ex ? t === m : t.includes(m);
    });
    if (!target) throw new Error("button not found: " + m);
    target.click();
  }, [label, exact]);
  await page.waitForTimeout(1400);
}
async function station(name) {
  await page.evaluate((m) => {
    [...document.querySelectorAll('[role="group"][aria-label="Camera station"] button')]
      .find((b) => b.textContent?.trim() === m)?.click();
  }, name);
  await page.waitForTimeout(1800);
}
async function frameShot(name) {
  await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="world-canvas-frame"]');
    if (frame) {
      const top = frame.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - 130));
    }
    document.documentElement.scrollLeft = 0;
  });
  await page.waitForTimeout(500);
  const frame = await page.$('[data-testid="world-canvas-frame"]');
  await frame.screenshot({ path: `${OUT}/${name}` });
  console.log("saved", name);
}
async function fullShot(name) {
  await page.screenshot({ path: `${OUT}/${name}` });
  console.log("saved", name);
}
async function setTheme(theme) {
  await page.evaluate((t) => {
    window.localStorage.setItem("theme", t);
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(t);
    root.style.colorScheme = t;
  }, theme);
  await page.waitForTimeout(400);
}

/* ---- journey: light theme, 1440x900 ---- */
await page.goto("http://127.0.0.1:3000/demo/mission?fixture=1");
await page.waitForLoadState("domcontentloaded");
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(6000); // GLB decode
await setTheme("light");

await clickButton("Start synthetic survey");
await page.waitForTimeout(1500);
await clickButton("Run playback");
await page.waitForTimeout(5500);
await clickButton("Pause playback");
await page.waitForTimeout(800);
await frameShot("01-running-light-1440.png");

await station("AIR");
await frameShot("02-air-light-1440.png");
await station("LAND");
await frameShot("03-land-light-1440.png");

// select ROV, underwater station — readability + live pose evidence
await clickButton("Inspection ROV");
await station("UW");
await frameShot("04-underwater-rov-live-light-1440.png");

// INSPECT on obstruction_primary
await station("INSPECT");
await frameShot("05-inspect-obstruction-light-1440.png");
// cycle target to crane
await clickButton("(cycle)", false);
await frameShot("06-inspect-crane-light-1440.png");

// FOLLOW (live pose tracking)
await clickButton("FOLLOW", true);
await page.waitForTimeout(3000);
await frameShot("07-follow-live-light-1440.png");

// fault flow: inject, advance 3, read degraded optical quality
await clickButton("Inject underwater optical fault");
await page.waitForTimeout(1800);
await clickButton("Advance +1 step");
await page.waitForTimeout(2200);
await clickButton("Advance +1 step");
await page.waitForTimeout(2200);
await station("UW");
await frameShot("08-fault-degraded-uw-light-1440.png");
await fullShot("09-fault-inspector-light-1440.png");

// replay determinism badge
await clickButton("Replay history");
await page.waitForTimeout(2200);
await fullShot("10-replay-deterministic-light-1440.png");

/* ---- dark theme ---- */
await setTheme("dark");
await station("RESET");
await frameShot("11-reset-dark-1440.png");
await station("UW");
await frameShot("12-underwater-dark-1440.png");
await station("INSPECT");
await frameShot("13-inspect-dark-1440.png");

/* ---- mobile 390 ---- */
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto("http://127.0.0.1:3000/demo/mission?fixture=1");
await mobile.waitForLoadState("domcontentloaded");
await mobile.waitForSelector("canvas", { timeout: 30000 });
await mobile.waitForTimeout(6000);
await setTheme("light");
await mobile.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Start synthetic survey")?.click();
});
await mobile.waitForTimeout(1800);
await mobile.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Advance +1 step")?.click();
});
await mobile.waitForTimeout(2000);
await fullShot("14-mobile-390-light.png");
await mobile.evaluate(() => {
  const el = document.querySelector('[data-testid="playback-bar"]');
  el?.scrollIntoView({ block: "center" });
});
await mobile.waitForTimeout(400);
await fullShot("15-mobile-controls-390-light.png");

/* ---- mobile 320 ---- */
await mobile.setViewportSize({ width: 320, height: 700 });
await mobile.waitForTimeout(1200);
await fullShot("16-mobile-320-light.png");
await mobile.close();

/* ---- 2D fallback with live robot text (WebGL disabled via launch flag page) ---- */
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx2.addInitScript(() => {
  // Force the WebGL probe to fail: strip getContext from HTMLCanvasElement.
  HTMLCanvasElement.prototype.getContext = () => null;
});
const page2 = await ctx2.newPage();
await page2.goto("http://127.0.0.1:3000/demo/mission?fixture=1");
await page2.waitForLoadState("domcontentloaded");
await page2.waitForTimeout(4000);
await page2.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Start synthetic survey")?.click();
});
await page2.waitForTimeout(2000);
await fullShot("17-fallback-2d-robots-light-1440.png");
await ctx2.close();

/* ---- real endpoint (no fixture): integration-pending proof ---- */
const page3 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page3.goto("http://127.0.0.1:3000/demo/mission");
await page3.waitForLoadState("domcontentloaded");
await page3.waitForSelector("canvas", { timeout: 30000 });
await page3.waitForTimeout(6000);
await clickButton("Start synthetic survey");
await page3.waitForTimeout(2500);
await fullShot("18-real-api-pending-1440.png");
const banner = await page3.evaluate(() =>
  document.querySelector('[role="alert"]')?.textContent?.slice(0, 160) ?? "none",
);
console.log("[real-api banner]", banner);
await page3.close();

await browser.close();
console.log("CAPTURE SET COMPLETE");
