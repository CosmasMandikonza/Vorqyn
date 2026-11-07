// Run from repository root with the reviewed production app already on port 3110.
// This intentionally has NO theme init script: reload must use actual storage.
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
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const results = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://127.0.0.1:3110/");
    for (const theme of ["dark", "light"]) {
      let controls = page.locator("header");
      if (width < 1024) {
        await page.getByRole("button", { name: "Open navigation" }).click();
        controls = page.getByRole("dialog", { name: "Navigate VORQYN" });
      }
      await controls
        .getByRole("button", {
          name: theme === "dark" ? "Dark" : "Light",
          exact: true,
        })
        .click();
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("vorqyn-theme")))
        .toBe(theme);
      await page.reload();
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await page.goto("http://127.0.0.1:3110/workspace");
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      results.push({
        width,
        theme,
        afterReloadAndRoute: "PASS",
        stored: await page.evaluate(() => localStorage.getItem("vorqyn-theme")),
      });
    }
  }
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        sourceSha,
        source: "real Chromium; no theme init script or mocked storage",
        results,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
