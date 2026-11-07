import { chromium } from "@playwright/test";
const OUT = "C:/Users/cmandikonza/.zcode/workspace/draft-5be875ff-c89d-4890-95aa-9d233922aa70/agent-b-3d-playback/docs/evidence/vq-07-dynamic";
const browser = await chromium.launch();
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto("http://127.0.0.1:3000/demo/mission?fixture=1");
await mobile.waitForLoadState("domcontentloaded");
await mobile.waitForSelector("canvas", { timeout: 30000 });
await mobile.waitForTimeout(6000);
await mobile.evaluate(() => {
  window.localStorage.setItem("theme", "light");
  document.documentElement.classList.remove("dark");
  document.documentElement.classList.add("light");
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Start synthetic survey")?.click();
});
await mobile.waitForTimeout(2000);
await mobile.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Advance +1 step")?.click();
});
await mobile.waitForTimeout(2200);
await mobile.screenshot({ path: `${OUT}/14-mobile-390-light.png` });
console.log("saved 14 (390)");
await mobile.evaluate(() => {
  document.querySelector('[data-testid="playback-bar"]')?.scrollIntoView({ block: "center" });
});
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: `${OUT}/15-mobile-controls-390-light.png` });
console.log("saved 15");
await mobile.setViewportSize({ width: 320, height: 700 });
await mobile.waitForTimeout(1200);
await mobile.screenshot({ path: `${OUT}/16-mobile-320-light.png` });
console.log("saved 16 (320)");
await mobile.close();
await browser.close();
console.log("MOBILE SET COMPLETE");
