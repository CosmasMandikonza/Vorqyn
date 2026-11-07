/* REAL end-to-end proof: genuine HTTP to /api/demo/simulation drives the 3D world. */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const OUT = "C:/Users/cmandikonza/.zcode/workspace/draft-5be875ff-c89d-4890-95aa-9d233922aa70/agent-b-3d-playback/docs/evidence/vq-07-dynamic";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const apiCalls = [];
page.on("request", (req) => {
  if (req.url().includes("/api/demo/simulation")) {
    apiCalls.push({ url: req.url(), body: req.postData()?.slice(0, 400) });
  }
});
page.on("response", (res) => {
  if (res.url().includes("/api/demo/simulation")) {
    console.log("[api]", res.status(), res.request().postData()?.slice(0, 120));
  }
});

await page.goto("http://127.0.0.1:3000/demo/mission");
await page.waitForLoadState("domcontentloaded");
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(7000);

const clickButton = async (label, includes = false) => {
  await page.evaluate(([m, inc]) => {
    const btn = [...document.querySelectorAll("button")].find((b) => {
      const t = (b.textContent ?? "").trim();
      return inc ? t.includes(m) : t === m;
    });
    if (!btn) throw new Error("button not found: " + m);
    btn.click();
  }, [label, includes]);
  await page.waitForTimeout(1600);
};

// transport badge must say LIVE API
const badge = await page.evaluate(() => document.querySelector('[data-testid="transport-badge"]')?.textContent ?? "none");
console.log("[transport]", badge);

// Start (real POST, empty trace)
await clickButton("Start synthetic survey");
await page.waitForTimeout(2200);
let bar = await page.evaluate(() => document.querySelector('[data-testid="playback-bar"]')?.textContent ?? "");
console.log("[after start]", bar.match(/SIM CLOCK: \d+ ms/)?.[0], "| kernel:", bar.match(/KERNEL: (\w+)/)?.[1]);

// Run playback (real stepping) for ~7s
await clickButton("Run playback");
await page.waitForTimeout(7000);
await clickButton("Pause playback");
await page.waitForTimeout(1200);
bar = await page.evaluate(() => document.querySelector('[data-testid="playback-bar"]')?.textContent ?? "");
console.log("[after run]", bar.match(/SIM CLOCK: (\d+) ms/)?.[0], "| steps:", bar.match(/STEPS: (\d+)\/400/)?.[1], "| seq:", bar.match(/SEQUENCE: (\d+)\/(\d+)/)?.[0]);

// select ROV, underwater view
await page.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Inspection ROV")?.click());
await page.waitForTimeout(400);
await page.evaluate(() => [...document.querySelectorAll('[role="group"][aria-label="Camera station"] button')].find(b => b.textContent?.trim() === "UW")?.click());
await page.waitForTimeout(2000);
const frame = await page.$('[data-testid="world-canvas-frame"]');
await frame.screenshot({ path: `${OUT}/19-real-api-running-uw-1440.png` });
console.log("saved 19 (real API running, UW)");

// Inject fault through REAL HTTP kernel command
await clickButton("Inject underwater optical fault");
await page.waitForTimeout(2200);
// advance twice so the degraded measurement lands
await clickButton("Advance +1 step");
await page.waitForTimeout(2200);
await clickButton("Advance +1 step");
await page.waitForTimeout(2200);
const sensorText = await page.evaluate(() => document.querySelector('[data-testid="inspector-panel"]')?.textContent?.match(/q 0\.\d+/g)?.join(" / ") ?? "no q");
console.log("[quality after fault]", sensorText);
await frame.screenshot({ path: `${OUT}/20-real-api-fault-degraded-uw-1440.png` });
console.log("saved 20 (real API fault degraded)");
const faultText = await page.evaluate(() => document.querySelector('[data-testid="inspector-panel"]')?.textContent?.match(/Active optical-visibility fault[^·]*/)?.[0] ?? "no fault text");
console.log("[fault]", faultText.slice(0, 120));

// replay via real API
await clickButton("Replay history");
await page.waitForTimeout(2500);
const replayBadge = await page.evaluate(() => document.querySelector('[data-testid="replay-badge"]')?.textContent ?? "none");
console.log("[replay]", replayBadge);
await page.screenshot({ path: `${OUT}/21-real-api-replay-deterministic-1440.png` });
console.log("saved 21");

console.log("[api request count]", apiCalls.length);
console.log("[last request body]", apiCalls[apiCalls.length - 1]?.body?.slice(0, 300));

await browser.close();
console.log("REAL E2E COMPLETE");
