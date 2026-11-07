import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:3000/demo/mission?fixture=1");
await page.waitForLoadState("domcontentloaded");
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(5000);
await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
await page.waitForTimeout(600);
const offenders = await page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > cw + 2 || r.left < -2)) {
      bad.push(`${el.tagName}.${(el.className && typeof el.className === "string" ? el.className : "").slice(0, 60)} right=${Math.round(r.right)} left=${Math.round(r.left)} w=${Math.round(r.width)}`);
    }
  }
  return bad.slice(0, 20);
});
console.log(JSON.stringify(offenders, null, 1));
await browser.close();
