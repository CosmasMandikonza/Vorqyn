import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const out = resolve(
  process.env.RELEASE_ARTIFACT_DIR ?? "../../../release-browser-results",
  "screenshots",
);
async function capture(
  page: Page,
  name: string,
  width: number,
  height: number,
) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    })),
  ).toEqual({ width, height, dpr: 1 });
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('button, [role="group"]')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent?.trim().slice(0, 100),
          left: r.left,
          right: r.right,
        };
      })
      .filter((r) => r.right > innerWidth + 1 || r.left < -1),
  }));
  mkdirSync(out, { recursive: true });
  const png = await page.screenshot({
    path: resolve(out, `${name}.png`),
    fullPage: false,
    animations: "disabled",
  });
  const metadata = {
    runId: JSON.parse(readFileSync(resolve(out, "../capture-run.json"), "utf8"))
      .id,
    layout,
    name,
    viewport: { width, height },
    deviceScaleFactor: 1,
    fullPage: false,
    png: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
    sha256: createHash("sha256").update(png).digest("hex"),
    url: page.url(),
    theme: await page.locator("html").getAttribute("class"),
    capturedAt: new Date().toISOString(),
  };
  expect(metadata.png).toEqual({ width, height });
  writeFileSync(
    resolve(out, `${name}.json`),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  expect
    .soft(
      layout.document,
      `${name}: horizontal overflow; see captured layout metadata`,
    )
    .toBeLessThanOrEqual(width);
}
for (const theme of ["light", "dark"])
  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 844 },
  ])
    test(`genuine captures ${theme} ${width}x${height}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await page.setViewportSize({ width, height });
      await page.addInitScript(
        (value) => localStorage.setItem("vorqyn-theme", value),
        theme,
      );
      for (const [route, label] of [
        ["/", "landing"],
        ["/demo", "guest"],
        ["/workspace/create", "local-drafts"],
      ]) {
        await page.goto(route!);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await capture(
          page,
          `${label}-${theme}-${width}x${height}`,
          width,
          height,
        );
      }
      await page.goto("/demo/mission");
      await expect(
        page.getByRole("button", { name: "Use 2D map", exact: true }),
      ).toBeVisible();
      const frame = page.getByTestId("world-canvas-frame");
      await expect(frame.locator("canvas")).toBeVisible();
      await expect(page.getByTestId("loading-veil")).toHaveCount(0);
      for (const mode of ["RESET", "UW", "INSPECT"]) {
        await page.getByRole("button", { name: mode, exact: true }).click();
        await expect(
          page.getByRole("button", { name: mode, exact: true }),
        ).toHaveAttribute("aria-pressed", "true");
        await frame.evaluate((el) =>
          el.scrollIntoView({ block: "center", behavior: "instant" }),
        );
        await page.waitForTimeout(600);
        await capture(
          page,
          `viewer-${mode.toLowerCase()}-${theme}-${width}x${height}`,
          width,
          height,
        );
        if (width < 1024) {
          const bar = await page
            .getByRole("group", { name: "Camera station" })
            .boundingBox();
          const inspector = await page
            .locator('[data-testid="inspector-panel"]:visible')
            .first()
            .boundingBox();
          expect(bar).not.toBeNull();
          expect(inspector).not.toBeNull();
          expect(bar!.y + bar!.height).toBeLessThanOrEqual(inspector!.y);
        }
      }
      if (width < 1024) {
        await page
          .locator('[data-testid="inspector-panel"]:visible')
          .first()
          .evaluate((el) =>
            el.scrollIntoView({ block: "start", behavior: "instant" }),
          );
        await capture(
          page,
          `mobile-inspector-${theme}-${width}x${height}`,
          width,
          height,
        );
      }
      await page
        .getByRole("button", { name: "Use 2D map", exact: true })
        .click();
      await expect(page.getByTestId("fallback-2d")).toBeVisible();
      await page
        .getByTestId("fallback-2d")
        .evaluate((el) =>
          el.scrollIntoView({ block: "start", behavior: "instant" }),
        );
      await capture(
        page,
        `fallback-${theme}-${width}x${height}`,
        width,
        height,
      );
      expect(errors).toEqual([]);
    });
