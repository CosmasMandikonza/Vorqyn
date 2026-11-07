// Resolve @playwright/test from apps/web (pnpm workspace) — see capture-r2.mjs.
// From this tools/ dir the repository root is FOUR levels up, so the correct
// specifier is "../../../../apps/web/package.json".
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const requireFromWeb = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), "../../../../apps/web/package.json"),
);
const { chromium } = requireFromWeb("@playwright/test");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
await page.goto("http://127.0.0.1:3000/demo/mission?fixture=1");
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(7000);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Start synthetic survey")?.click();
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Run playback")?.click();
});
await page.waitForTimeout(5000);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Pause playback")?.click();
});
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Inject underwater optical fault")?.click();
});
await page.waitForTimeout(1800);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Advance +1 step")?.click();
});
await page.waitForTimeout(1800);
await page.evaluate(() => {
  const replay = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Replay history");
  replay?.scrollIntoView({ block: "center" });
});
await page.waitForTimeout(600);
const rects = await page.evaluate(() => {
  const replay = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Replay history");
  const rp = replay?.getBoundingClientRect();
  const overlay = document.querySelector('[data-testid="inspector-overlay"]');
  const ov = overlay?.getBoundingClientRect();
  const hit = replay ? document.elementFromPoint(rp.left + rp.width / 2, rp.top + rp.height / 2) : null;
  return {
    scrollY: Math.round(window.scrollY),
    replay: rp ? { l: Math.round(rp.left), t: Math.round(rp.top), r: Math.round(rp.right), b: Math.round(rp.bottom) } : null,
    overlay: ov ? { l: Math.round(ov.left), t: Math.round(ov.top), r: Math.round(ov.right), b: Math.round(ov.bottom) } : null,
    hitElement: hit ? hit.tagName + "." + String(hit.className).slice(0, 50) + " :: " + (hit.textContent ?? "").slice(0, 30) : "none",
    innerWidth: window.innerWidth,
    wrapW: Math.round((document.querySelector("main.wrap") ?? document.body).getBoundingClientRect().width),
  };
});
console.log(JSON.stringify(rects, null, 1));
await browser.close();
