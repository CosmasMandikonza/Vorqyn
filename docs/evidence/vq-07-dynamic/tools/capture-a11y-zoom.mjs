/* Keyboard traversal + 200% zoom proxy checks for the mission page. */
import { chromium } from "@playwright/test";
const OUT = "C:/Users/cmandikonza/.zcode/workspace/draft-5be875ff-c89d-4890-95aa-9d233922aa70/agent-b-3d-playback/docs/evidence/vq-07-dynamic";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:3000/demo/mission?fixture=1");
await page.waitForLoadState("domcontentloaded");
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(6000);

// keyboard: walk focus through the operator controls
const focusOrder = [];
for (let i = 0; i < 14; i += 1) {
  await page.keyboard.press("Tab");
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    return `${el?.tagName}:${(el?.textContent ?? "").trim().slice(0, 32) || el?.getAttribute("aria-label") || ""}`;
  });
  focusOrder.push(info);
}
console.log("[focus order]", JSON.stringify(focusOrder, null, 0));
await page.evaluate(() => document.querySelector('[data-testid="playback-bar"]')?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/22-keyboard-focus-1440.png` });

// 200% zoom proxy: CSS zoom x2 on the page root
await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
await page.waitForTimeout(800);
const overflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
}));
console.log("[200pct]", JSON.stringify(overflow));
await page.evaluate(() => { document.documentElement.scrollLeft = 0; });
await page.screenshot({ path: `${OUT}/23-zoom-200pct-light-1440.png` });
await page.evaluate(() => { document.documentElement.style.zoom = ""; });

await browser.close();
console.log("A11Y CHECKS COMPLETE");
