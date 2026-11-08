/** Full-row regression: unfocused camera controls must stay reachable after every station change. No owner component edits. */
import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const out = resolve(
  process.env.RELEASE_ARTIFACT_DIR ?? "../../../release-browser-results",
);
const states = ["clean-uw", "follow", "inspect", "fault-uw"] as const;
async function operation(page: Page, name: string) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/demo/simulation") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name, exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const body = await result.json();
  expect(body.sourceKind).toBe("SYNTHETIC_SIM");
  return body;
}
for (const theme of ["light", "dark"])
  for (const width of [320, 390, 1024, 1440]) {
    const viewport = { width, height: width < 400 ? 844 : 900 };
    test.describe(`cross-system camera ${theme} ${width}`, () => {
      test.use({
        viewport,
        deviceScaleFactor: 1,
        hasTouch: width < 400,
        isMobile: width < 400,
        reducedMotion: "reduce",
      });
      test("entire row remains visible after four real station/fault states", async ({
        page,
      }) => {
        await page.addInitScript(
          (value) => localStorage.setItem("theme", value),
          theme,
        );
        await page.goto("/");
        await page
          .getByRole("main")
          .getByRole("link", { name: /Explore Demo/ })
          .first()
          .click();
        await page
          .getByRole("link", { name: "Explore the 3D world preview" })
          .click();
        const frame = page.getByTestId("world-canvas-frame");
        await expect(frame.locator("canvas")).toBeVisible();
        await expect(page.getByTestId("loading-veil")).toHaveCount(0);
        await operation(page, "Start synthetic survey");
        await operation(page, "Advance +1 step");
        await page
          .locator('[data-testid="inspector-panel"]:visible')
          .first()
          .getByRole("button", { name: "Inspection ROV", exact: true })
          .click();
        const group = page.getByRole("group", {
          name: "Camera station",
          exact: true,
        });
        for (const state of states) {
          const station =
            state === "follow"
              ? "FOLLOW"
              : state === "inspect"
                ? "INSPECT"
                : "UW";
          const control = group.getByRole("button", {
            name: station,
            exact: true,
          });
          if (width < 400) await control.tap();
          else await control.click();
          if (state === "fault-uw") {
            await operation(page, "Inject underwater optical fault");
            await operation(page, "Advance +1 step");
          }
          await frame.evaluate((el) =>
            el.scrollIntoView({ block: "center", behavior: "instant" }),
          );
          await page.waitForTimeout(600);
          await page.evaluate(() => document.fonts.ready);
          const measured = await page.evaluate(() => {
            const camera = document.querySelector(
              '[role="group"][aria-label="Camera station"]',
            )!;
            const canvas = document.querySelector(
              '[data-testid="world-canvas-frame"]',
            )!;
            return {
              viewport: {
                width: innerWidth,
                height: innerHeight,
                dpr: devicePixelRatio,
              },
              documentWidth: document.documentElement.scrollWidth,
              group: camera.getBoundingClientRect().toJSON(),
              groupScrollLeft: camera.scrollLeft,
              frame: canvas.getBoundingClientRect().toJSON(),
              controls: [...camera.querySelectorAll("button")].map(
                (button) => ({
                  name: button.textContent?.trim(),
                  rect: button.getBoundingClientRect().toJSON(),
                }),
              ),
            };
          });
          expect(measured.viewport).toEqual({ ...viewport, dpr: 1 });
          await expect(page.locator("html")).toHaveClass(new RegExp(theme));
          const name = `full-row-${state}-${theme}-${width}x${viewport.height}`;
          const directory = resolve(out, "integration-camera");
          mkdirSync(directory, { recursive: true });
          const screenshotOptions = {
            fullPage: false,
            animations: "disabled" as const,
            scale: "device" as const,
          };
          const png = await page.screenshot({
            ...screenshotOptions,
            path: resolve(directory, `${name}.png`),
          });
          const dimensions = {
            width: png.readUInt32BE(16),
            height: png.readUInt32BE(20),
          };
          expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
          expect(dimensions).toEqual(viewport);
          const run = JSON.parse(
            readFileSync(resolve(out, "capture-run.json"), "utf8"),
          );
          writeFileSync(
            resolve(directory, `${name}.json`),
            JSON.stringify(
              {
                sourceSha: run.sourceSha,
                runId: run.id,
                source:
                  "real production Chromium, actual API, no route fixtures",
                theme,
                url: page.url(),
                hasTouch: width < 400,
                reducedMotion: "reduce",
                screenshotOptions,
                png: dimensions,
                sha256: createHash("sha256").update(png).digest("hex"),
                ...measured,
              },
              null,
              2,
            ) + "\n",
          );
          expect
            .soft(measured.documentWidth, `${name}: document overflow`)
            .toBeLessThanOrEqual(width);
          expect(measured.controls).toHaveLength(6);
          for (const button of measured.controls) {
            expect
              .soft(button.rect.left, `${name}: ${button.name} left edge`)
              .toBeGreaterThanOrEqual(Math.max(0, measured.frame.left));
            expect
              .soft(button.rect.right, `${name}: ${button.name} right edge`)
              .toBeLessThanOrEqual(Math.min(width, measured.frame.right));
            expect
              .soft(button.rect.height, `${name}: ${button.name} hit height`)
              .toBeGreaterThanOrEqual(44);
            expect
              .soft(button.rect.width, `${name}: ${button.name} hit width`)
              .toBeGreaterThanOrEqual(24);
          }
        }
        // Keyboard activation still has to work even when geometry assertions failed.
        for (const name of [
          "RESET",
          "AIR",
          "LAND",
          "UW",
          "INSPECT",
          "FOLLOW",
        ]) {
          const button = group.getByRole("button", { name, exact: true });
          await button.focus();
          await page.keyboard.press("Enter");
          await expect(button).toHaveAttribute("aria-pressed", "true");
        }
      });
    });
  }
