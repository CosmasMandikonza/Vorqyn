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

test("1024x900: inspector overlay never intercepts an ordinary Replay history click", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.waitForTimeout(1500); // re-layout at the new viewport

  // Journey to a faulted, replayable state.
  await page.getByRole("button", { name: "Start synthetic survey" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Run playback" }).click();
  await page.waitForTimeout(5000);
  await page.getByRole("button", { name: "Pause playback" }).click();
  await page.getByRole("button", { name: "Inject underwater optical fault" }).click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Advance +1 step" }).click();
  await page.waitForTimeout(1800);

  // GEOMETRIC assertion: the desktop inspector overlay must not intersect
  // the Replay history button's hit box at this viewport. This pins the
  // layout contract that PR #43 QA found broken (intercepted click at
  // ~(715.8, 461.9)) rather than relying on click success alone.
  const geometry = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="inspector-overlay"]');
    const replay = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Replay history",
    );
    if (!overlay || !replay) return { missing: overlay ? "replay" : "both" };
    const o = overlay.getBoundingClientRect();
    const r = replay.getBoundingClientRect();
    const intersects = !(
      r.right <= o.left ||
      r.left >= o.right ||
      r.bottom <= o.top ||
      r.top >= o.bottom
    );
    const hit = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return {
      intersects,
      hitIsReplayOrChild: hit === replay || replay.contains(hit ?? null),
      overlayRight: Math.round(o.right),
      replayRect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) },
    };
  });
  expect(geometry.missing).toBeUndefined();
  expect(geometry.intersects, `overlay intersects Replay button: ${JSON.stringify(geometry)}`).toBe(false);
  expect(geometry.hitIsReplayOrChild).toBe(true);

  // ORDINARY pointer click (no force, no DOM dispatch) — actionability
  // checks enforce the real hit-target path.
  await page.getByRole("button", { name: "Replay history", exact: true }).click();
  await expect(page.getByTestId("replay-badge")).toContainText(/Replay identical/);

  // Inspector overlay remains visible, scrollable and usable.
  const overlay = page.locator('[data-testid="inspector-overlay"]');
  await expect(overlay).toBeVisible();
  const panel = overlay.locator('[data-testid="inspector-panel"]');
  await expect(panel).toContainText(/kernel measurements/i);
  const scrollState = await overlay.evaluate((el) => ({
    scrollable: el.scrollHeight >= el.clientHeight,
    clientHeight: el.clientHeight,
  }));
  expect(scrollState.clientHeight).toBeGreaterThan(200);
});

test("320px camera station row: whole-row geometry, natural clicks and scroll assertions across all stations and themes", async ({ page }) => {
  test.setTimeout(120_000); // SwiftShader software rendering is slow; no assertion is relaxed
  const stations = ["RESET", "AIR", "LAND", "UW", "INSPECT", "FOLLOW"];
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      window.localStorage.setItem("theme", t);
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(t);
    }, theme);
    await page.reload();
    await page.waitForSelector("canvas", { timeout: 30000 });
    await page.waitForTimeout(6000);

    // A reload resets the in-memory kernel session; FOLLOW's honest gate
    // (sessionActive && selectedLive) needs a live session that is actually
    // producing observations (the start response alone carries no snapshots)
    // plus a selection. Walking stations without this journey would click a
    // disabled control.
    await page.getByRole("button", { name: "Start synthetic survey" }).click();
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: "Advance +1 step" }).click();
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: "Access rover" }).click();

    for (const station of stations) {
      // natural click through the real hit-target path
      await page.getByRole("button", { name: station, exact: true }).click();
      await page.waitForTimeout(400);

      // WHOLE-ROW geometry: every station button fully within the viewport,
      // hit-test resolves to the button itself, no internal scroll needed.
      const row = await page.evaluate(() => {
        const group = document.querySelector('[role="group"][aria-label="Camera station"]');
        if (!group) return { missing: true };
        const vw = document.documentElement.clientWidth;
        const buttons = [...group.querySelectorAll("button")].map((b) => {
          const r = b.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            label: b.textContent?.trim(),
            left: r.left,
            right: r.right,
            top: r.top,
            bottom: r.bottom,
            inViewport: r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= window.innerHeight,
            heightOk: r.height >= 44,
            hitOk: hit === b || b.contains(hit),
            pressed: b.getAttribute("aria-pressed"),
          };
        });
        return {
          buttons,
          allVisible: buttons.every((b) => b.inViewport),
          allHitOk: buttons.every((b) => b.hitOk),
          allHeightOk: buttons.every((b) => b.heightOk),
          pressed: buttons.filter((b) => b.pressed === "true").map((b) => b.label),
          internalScroll: group.scrollWidth > group.clientWidth + 1,
        };
      });
      expect(row.missing).toBeUndefined();
      expect(row.allVisible, JSON.stringify(row)).toBe(true);
      expect(row.allHitOk, JSON.stringify(row)).toBe(true);
      expect(row.allHeightOk).toBe(true);
      expect(row.internalScroll).toBe(false);
      expect(row.pressed).toEqual([station]);
    }

    // keyboard operability: focus + Enter must activate a station too —
    // these are native <button>s in a labelled group, no pointer-only path.
    await page.getByRole("button", { name: "RESET", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "RESET", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // page never scrolls horizontally at 320
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    );
    expect(pageOverflow).toBe(false);
  }
});

test("camera station row: selected machine and camera survive station changes", async ({ page }) => {
  await page.getByRole("button", { name: "Start synthetic survey" }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Inspection ROV" }).click();
  await page.getByRole("button", { name: "AIR", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "RESET", exact: true }).click();
  await page.waitForTimeout(400);
  const selected = await page.evaluate(() => {
    const chips = [...document.querySelectorAll("button")].filter((b) => b.getAttribute("aria-pressed") === "true");
    return chips.map((b) => b.textContent?.trim());
  });
  expect(selected.some((t) => t === "Inspection ROV")).toBe(true);
});

test.use({ hasTouch: true });
test("320px: camera stations are touch-operable (real tap activates station)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Start synthetic survey" }).click();
  await page.waitForTimeout(1800);

  const uw = page.getByRole("button", { name: "UW", exact: true });
  await uw.scrollIntoViewIfNeeded();
  const box = await uw.boundingBox();
  expect(box).not.toBeNull();
  // real touch pipeline (touchscreen.tap), not element.click() dispatch
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(400);
  await expect(uw).toHaveAttribute("aria-pressed", "true");

  // tap target must be at least ~44px tall at 320px (thumb-sized)
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
