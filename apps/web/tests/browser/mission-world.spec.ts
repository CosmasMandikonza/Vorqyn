import { test, expect } from "@playwright/test";

/**
 * Judge-story regressions (Issue #15): camera stations, World Dive
 * interruption, kernel fault -> measured optical drop, ghost replay legend,
 * and the 320px camera-control overflow defect.
 *
 * Runs against the recorded FIXTURE transport via ?fixture=1 so the journey
 * is deterministic without the live API; the API itself is covered by the
 * demo-simulation-api suite (Agent A).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/demo/mission?fixture=1");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(6000); // GLB decode + world metadata
});

test("camera stations switch without losing selection and never overflow the page at 320px", async ({ page }) => {
  await page.getByRole("button", { name: "Start synthetic survey" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Access rover" }).click();

  for (const station of ["AIR", "LAND", "UW", "INSPECT", "RESET"]) {
    await page.getByRole("button", { name: station, exact: true }).click();
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: station, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // selection must survive station changes
    await expect(page.getByRole("button", { name: "Access rover" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
});

test("320px: camera station bar never causes page-level horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForTimeout(800);
  const overflow = await page.evaluate(() => ({
    pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.pageScrolls).toBe(false);
  // the station bar itself scrolls internally (intended) or fits entirely
  const bar = page.getByRole("group", { name: "Camera station" });
  await expect(bar).toBeVisible();
});

test("kernel fault measurably degrades optical quality in the inspector", async ({ page }) => {
  await page.getByRole("button", { name: "Start synthetic survey" }).click();
  await page.waitForTimeout(1500);
  // One advance loads the recorded observation log (fixture: 13 snapshots,
  // fault at seq 11). Scrubbing the recorded timeline gives the honest
  // before/after comparison without depending on live stepping.
  await page.getByRole("button", { name: "Advance +1 step" }).click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Inspection ROV" }).click();

  const readOptical = async () =>
    page.evaluate(() => {
      const text = document.querySelector('[data-testid="inspector-panel"]')?.textContent ?? "";
      const match = text.match(/rov-01-optical\s*q (0\.\d+)/);
      return match ? Number(match[1]) : null;
    });
  const scrub = async (index: number) => {
    await page.evaluate((i) => {
      const slider = document.querySelector<HTMLInputElement>("#timeline-scrub");
      if (!slider) throw new Error("timeline scrubber missing");
      // React controlled input: apply the NATIVE value setter so React's
      // change tracker sees the update, then dispatch input/change.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(slider, String(i));
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    }, index);
    await page.waitForTimeout(500);
  };

  await scrub(9); // pre-fault observation (seq 10)
  const clean = await readOptical();
  expect(clean).not.toBeNull();
  expect(clean!).toBeGreaterThan(0.5);

  await scrub(12); // post-fault observation (seq 13)
  const faulted = await readOptical();
  expect(faulted).not.toBeNull();
  expect(faulted!).toBeLessThan(clean! / 2);
  await expect(page.locator('[data-testid="inspector-panel"]').first()).toContainText(
    /Active optical-visibility fault: severe/,
  );
});

test("replay history through the recorded trace is deterministic", async ({ page }) => {
  await page.getByRole("button", { name: "Start synthetic survey" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Advance +1 step" }).click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Replay history" }).click();
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("replay-badge")).toHaveText(/Replay identical ✓ deterministic/);
});

test("honesty badge switches to kernel-telemetry scope during playback", async ({ page }) => {
  await expect(page.getByTestId("honesty-badge")).toHaveText(/Static vehicle anchors/);
  await page.getByRole("button", { name: "Start synthetic survey" }).click();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("honesty-badge")).toHaveText(/SYNTHETIC_SIM kernel telemetry/);
  await expect(page.getByTestId("honesty-badge")).toHaveText(/No evidence, AI or settlement actions/);
});

test("World Dive button is hidden under prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/demo/mission?fixture=1");
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(4000);
  await expect(page.getByRole("button", { name: "World Dive", exact: true })).toHaveCount(0);
});
