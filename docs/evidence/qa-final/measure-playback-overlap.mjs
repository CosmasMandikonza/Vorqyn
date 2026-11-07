// Run from repo root against the reviewed production app on port 3110.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
const require = createRequire(resolve("apps/web/package.json"));
const { chromium, expect } = require("@playwright/test");
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 900 },
    reducedMotion: "reduce",
  });
  await page.goto("http://127.0.0.1:3110/demo/mission");
  await expect(page.getByTestId("loading-veil")).toHaveCount(0);
  for (const name of ["Start synthetic survey", "Advance +1 step"]) {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/demo/simulation") &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name, exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Advance +1 step", exact: true }),
    ).toBeEnabled();
  }
  const replay = page.getByRole("button", {
    name: "Replay history",
    exact: true,
  });
  await expect(replay).toBeEnabled();
  await replay.scrollIntoViewIfNeeded();
  const geometry = await replay.evaluate((button) => {
    const rect = button.getBoundingClientRect(),
      overlay = document.querySelector('[data-testid="inspector-overlay"]');
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const hit = document.elementFromPoint(center.x, center.y);
    return {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      scroll: { x: scrollX, y: scrollY },
      replay: rect.toJSON(),
      overlay: overlay?.getBoundingClientRect().toJSON(),
      center,
      hit: {
        tag: hit?.tagName,
        text: hit?.textContent?.slice(0, 100),
        insideInspector: !!hit?.closest('[data-testid="inspector-overlay"]'),
      },
      pointerBlocked: !!hit && !button.contains(hit),
    };
  });
  expect(geometry.pointerBlocked).toBe(true);
  expect(geometry.hit.insideInspector).toBe(true);
  console.log(
    JSON.stringify(
      {
        status: "FAIL",
        finding: "Replay history pointer center intercepted by inspector",
        sourceSha,
        url: page.url(),
        source:
          "real Chromium; actual API; after Start and one step; no forced click",
        ...geometry,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
