import { test, expect, type Page, type Locator } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const out = resolve(
  process.env.RELEASE_ARTIFACT_DIR ?? "../../../release-browser-results",
);
const routes = [
  ["/", "home"],
  ["/demo", "demo"],
  ["/demo/mission", "mission"],
  ["/workspace", "workspace"],
  ["/workspace/create", "draft"],
] as const;

async function evidence(
  page: Page,
  label: string,
  theme: string,
  viewport: { width: number; height: number },
  dpr = 1,
) {
  await page.evaluate(() => document.fonts.ready);
  const measured = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    rootZoom: getComputedStyle(document.documentElement).zoom,
  }));
  expect(measured).toMatchObject({ ...viewport, dpr });
  await expect(page.locator("html")).toHaveClass(new RegExp(theme));
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    offenders: [
      ...document.querySelectorAll(
        "header, header *, main button, main [role=group], main input",
      ),
    ].flatMap((el) => {
      const r = el.getBoundingClientRect();
      return r.width && (r.right > innerWidth || r.left < 0)
        ? [
            {
              tag: el.tagName,
              class: el.getAttribute("class"),
              name: el.getAttribute("aria-label"),
              text: el.textContent?.trim().slice(0, 120),
              rect: r.toJSON(),
            },
          ]
        : [];
    }),
    header: [
      ...document.querySelectorAll(
        ".site-header, .site-header > *, .header-actions > *",
      ),
    ].map((el) => ({
      class: el.className,
      display: getComputedStyle(el).display,
      rect: el.getBoundingClientRect().toJSON(),
    })),
  }));
  const name = `${label}-${theme}-${viewport.width}x${viewport.height}-dpr${dpr}`;
  mkdirSync(resolve(out, "screenshots"), { recursive: true });
  const png = await page.screenshot({
    path: resolve(out, "screenshots", `${name}.png`),
    fullPage: false,
    animations: "disabled",
    // Native zoom uses a non-emulated window. Chromium/Playwright returns the
    // layout viewport raster here; assert the actual IHDR instead of assuming
    // that browser devicePixelRatio equals the screenshot sampling ratio.
    scale: "device",
  });
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.subarray(12, 16).toString()).toBe("IHDR");
  const pixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  expect(pixels).toEqual({
    width: viewport.width,
    height: viewport.height,
  });
  const run = JSON.parse(
    readFileSync(resolve(out, "capture-run.json"), "utf8"),
  );
  expect(run.sourceSha).toMatch(/^[a-f0-9]{40}$/);
  writeFileSync(
    resolve(out, "screenshots", `${name}.json`),
    JSON.stringify(
      {
        name,
        runId: run.id,
        commitSha: run.sourceSha,
        capturedAt: new Date().toISOString(),
        source: "real Chromium; local production server; no response fixtures",
        url: page.url(),
        theme,
        viewport: measured,
        screenshotOptions: {
          fullPage: false,
          animations: "disabled",
          scale: "device",
        },
        png: pixels,
        sha256: createHash("sha256").update(png).digest("hex"),
        layout,
      },
      null,
      2,
    ) + "\n",
  );
  expect
    .soft(
      layout.documentWidth,
      `${name}: document overflow; inspect measured offenders`,
    )
    .toBeLessThanOrEqual(viewport.width);
  return layout;
}

const sizes = [
  { width: 1440, height: 900 },
  { width: 1024, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 844 },
];
const themes = ["light", "dark"];
async function setTheme(page: Page, theme: string) {
  await page.addInitScript(
    (value) => localStorage.setItem("vorqyn-theme", value),
    theme,
  );
}
function errorsOn(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}
async function focus(control: Locator) {
  // Enter keyboard modality before programmatic targeting; mouse focus need not
  // match :focus-visible and is not a keyboard-focus regression.
  await control.page().keyboard.press("Tab");
  await control.focus();
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS("outline-style", "solid");
  await expect(control).toHaveCSS("outline-width", "3px");
}
async function headerUsable(page: Page, width: number) {
  const header = page.locator("header");
  await expect(header.getByRole("link", { name: "VORQYN home" })).toBeVisible();
  const menu = header.getByRole("button", { name: "Open navigation" });
  if (width < 1024) await expect(menu).toBeVisible();
  else {
    await expect(
      header.getByRole("navigation", { name: "Main navigation" }),
    ).toBeVisible();
    for (const name of ["Light", "Dark", "System"])
      await expect(
        header.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    await expect(
      header.getByRole("link", { name: /Create Workspace/ }),
    ).toBeVisible();
  }
  const rects = await header.locator("a,button").evaluateAll((elements) =>
    elements
      .map((el) => ({
        name: el.getAttribute("aria-label") ?? el.textContent,
        rect: el.getBoundingClientRect().toJSON(),
      }))
      .filter((el) => el.rect.width > 0),
  );
  for (const item of rects) {
    expect.soft(item.rect.left, JSON.stringify(item)).toBeGreaterThanOrEqual(0);
    expect
      .soft(item.rect.right, JSON.stringify(item))
      .toBeLessThanOrEqual(width);
  }
}
for (const theme of themes)
  test(`shared header fits at CSS root zoom 200% ${theme} (historical 89px reproduction)`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await page.goto("/");
    await page.evaluate(() => (document.documentElement.style.zoom = "2"));
    const data = await evidence(page, "css-root-zoom-200", theme, {
      width: 1440,
      height: 900,
    });
    const actions = data.header.find((el) => el.class === "header-actions")!;
    expect(actions.rect.right).toBeLessThanOrEqual(1440);
    for (const name of ["Light", "Dark", "System"])
      await expect(
        page.locator("header").getByRole("button", { name, exact: true }),
      ).toBeVisible();
    await expect(
      page.locator("header").getByRole("link", { name: /Create Workspace/ }),
    ).toBeVisible();
  });

for (const theme of themes)
  for (const size of sizes)
    test(`shared routes and accessible navigation ${theme} ${size.width}x${size.height}`, async ({
      page,
    }) => {
      const errors = errorsOn(page);
      await page.setViewportSize(size);
      await setTheme(page, theme);
      for (const [route, label] of routes) {
        await page.goto(route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        if (label === "mission")
          await expect(page.getByTestId("loading-veil")).toHaveCount(0);
        await headerUsable(page, size.width);
        await evidence(page, `shell-${label}`, theme, size);
      }
      await page.goto("/");
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Skip to content" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      expect(await page.evaluate(() => location.hash)).toBe("#main");
      expect(
        await page.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
      ).toBe(true);
      await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
      if (size.width < 1024) {
        const trigger = page.getByRole("button", { name: "Open navigation" });
        await focus(trigger);
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: "Navigate VORQYN" });
        await expect(dialog).toBeVisible();
        for (let i = 0; i < 12; i++) {
          await page.keyboard.press("Tab");
          expect(
            await dialog.evaluate((el) => el.contains(document.activeElement)),
          ).toBe(true);
        }
        for (const name of ["Light", "Dark", "System"])
          await expect(
            dialog.getByRole("button", { name, exact: true }),
          ).toBeVisible();
        await dialog
          .getByRole("button", {
            name: theme === "light" ? "Light" : "Dark",
            exact: true,
          })
          .click();
        await expect(
          dialog.getByRole("link", { name: /Create Workspace/ }),
        ).toBeVisible();
        await evidence(page, "mobile-menu", theme, size);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await trigger.click();
        await dialog
          .getByRole("link", { name: "Explore Demo", exact: true })
          .click();
        await expect(page).toHaveURL(/\/demo$/);
        await expect(dialog).toHaveCount(0);
        await trigger.click();
        await dialog
          .getByRole("link", { name: "Create Workspace", exact: true })
          .click();
        await expect(page).toHaveURL(/\/workspace$/);
        await expect(dialog).toHaveCount(0);
        await trigger.click();
        await page.setViewportSize({ width: 1024, height: 900 });
        await expect(dialog).toHaveCount(0);
      } else {
        const link = page
          .locator("header")
          .getByRole("link", { name: /Create Workspace/ });
        await focus(link);
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/workspace$/);
        const toggle = page.locator("header").getByRole("button", {
          name: theme === "light" ? "Light" : "Dark",
          exact: true,
        });
        await focus(toggle);
        await page.keyboard.press("Enter");
      }
      await page.reload();
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      expect(errors).toEqual([]);
    });

for (const theme of themes)
  for (const windowWidth of [1440, 2048])
    test(`native Chromium 200% shared routes ${theme} window ${windowWidth}`, async ({
      browser,
    }, info) => {
      const context = await browser
        .browserType()
        .launchPersistentContext(info.outputPath("native-profile"), {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          headless: true,
          viewport: null,
          deviceScaleFactor: undefined,
          reducedMotion: "reduce",
          args: [
            `--window-size=${windowWidth},900`,
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        });
      try {
        const page = await context.newPage();
        const errors = errorsOn(page);
        await setTheme(page, theme);
        await page.goto("http://127.0.0.1:3110/");
        const initial = await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        }));
        expect(initial.width).toBe(windowWidth);
        expect(initial.dpr).toBe(1);
        await page.goto("chrome://settings/appearance");
        await page.evaluate(() => {
          const w = globalThis as unknown as {
            chrome: {
              settingsPrivate: { setDefaultZoom: (n: number) => void };
            };
          };
          w.chrome.settingsPrivate.setDefaultZoom(2);
        });
        const expected = {
          width: initial.width / 2,
          // Chromium reports the integer layout viewport after native zoom.
          height: Math.floor(initial.height / 2),
        };
        for (const [route, label] of routes) {
          await page.goto(`http://127.0.0.1:3110${route}`);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await headerUsable(page, expected.width);
          await evidence(
            page,
            `native-200-${windowWidth}-${label}`,
            theme,
            expected,
            2,
          );
          if (expected.width < 1024) {
            const trigger = page.getByRole("button", {
              name: "Open navigation",
            });
            await focus(trigger);
            await page.keyboard.press("Enter");
            const dialog = page.getByRole("dialog", {
              name: "Navigate VORQYN",
            });
            await expect(dialog).toBeVisible();
            await expect(
              dialog.getByRole("link", { name: /Create Workspace/ }),
            ).toBeVisible();
            await expect(
              dialog.getByRole("button", { name: "System", exact: true }),
            ).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(trigger).toBeFocused();
          }
        }
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });

async function operation(page: Page, name: string) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/demo/simulation") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name, exact: true }).click();
  const res = await response;
  expect(res.status()).toBe(200);
  const data = await res.json();
  expect(data.sourceKind).toBe("SYNTHETIC_SIM");
  await expect(
    page.getByRole("button", { name: "Advance +1 step", exact: true }),
  ).toBeEnabled();
  return data;
}
for (const theme of themes)
  for (const size of sizes)
    test(`real guest fault replay and inspector ${theme} ${size.width}x${size.height}`, async ({
      page,
    }) => {
      const errors = errorsOn(page);
      await page.setViewportSize(size);
      await setTheme(page, theme);
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
      await expect(page.getByTestId("transport-badge")).toContainText(
        "LIVE API · SYNTHETIC_SIM",
      );
      await operation(page, "Start synthetic survey");
      const before = await operation(page, "Advance +1 step");
      const inspector = page
        .locator('[data-testid="inspector-panel"]:visible')
        .first();
      await inspector
        .getByRole("button", { name: "Inspection ROV", exact: true })
        .click();
      for (const name of ["AIR", "LAND", "UW", "INSPECT", "FOLLOW", "RESET"]) {
        const button = page
          .getByRole("group", { name: "Camera station", exact: true })
          .getByRole("button", { name, exact: true });
        await focus(button);
        await page.keyboard.press("Enter");
        await expect(button).toHaveAttribute("aria-pressed", "true");
        const bounds = await button.boundingBox();
        expect(bounds).not.toBeNull();
        expect
          .soft(
            bounds!.x + bounds!.width,
            `Camera ${name} exceeds ${size.width}px`,
          )
          .toBeLessThanOrEqual(size.width);
      }
      await page
        .getByRole("group", { name: "Camera station", exact: true })
        .getByRole("button", { name: "UW", exact: true })
        .click();
      await frame.evaluate((el) =>
        el.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      await page.waitForTimeout(600);
      await evidence(page, "journey-clean-uw", theme, size);
      for (const [station, label] of [
        ["FOLLOW", "follow"],
        ["INSPECT", "inspect"],
      ]) {
        await page
          .getByRole("group", { name: "Camera station", exact: true })
          .getByRole("button", { name: station, exact: true })
          .click();
        await frame.evaluate((el) =>
          el.scrollIntoView({ block: "center", behavior: "instant" }),
        );
        await page.waitForTimeout(600);
        await evidence(page, `journey-${label}`, theme, size);
      }
      await page
        .getByRole("group", { name: "Camera station", exact: true })
        .getByRole("button", { name: "UW", exact: true })
        .click();
      await operation(page, "Inject underwater optical fault");
      const faulted = await operation(page, "Advance +1 step");
      const rov = (data: typeof before) =>
        data.snapshots
          .at(-1)
          .robots.find((r: { robotId: string }) => r.robotId === "rov-01");
      const quality = (robot: ReturnType<typeof rov>, kind: string) =>
        robot.sensors.find((s: { kind: string }) => s.kind === kind).measured
          .quality01;
      expect(quality(rov(faulted), "optical")).toBeLessThan(
        quality(rov(before), "optical") * 0.3,
      );
      expect(quality(rov(faulted), "sonar")).toBeGreaterThan(0);
      await expect(inspector).toContainText(
        "Active optical-visibility fault: severe",
      );
      await expect(inspector).toContainText(
        `q ${quality(rov(faulted), "optical").toFixed(3)}`,
      );
      await expect(inspector).toContainText("SYNTHETIC_SIM");
      await frame.evaluate((el) =>
        el.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      await page.waitForTimeout(600);
      await evidence(page, "journey-fault-uw", theme, size);
      await inspector
        .getByText(/Active optical-visibility fault:/)
        .scrollIntoViewIfNeeded();
      await evidence(page, "journey-fault-inspector", theme, size);
      const slider = page.getByRole("slider", {
        name: "Timeline",
        exact: true,
      });
      await slider.focus();
      await page.keyboard.press("Home");
      await page.keyboard.press("End");
      await expect(slider).toHaveAttribute(
        "aria-valuetext",
        /simulator time 1000 ms/,
      );
      const replay = await operation(page, "Replay history");
      expect(replay.snapshots).toEqual(faulted.snapshots);
      await expect(page.getByTestId("replay-badge")).toContainText(
        "Replay identical",
      );
      await expect(page.getByTestId("playback-notice")).toHaveAttribute(
        "role",
        "status",
      );
      await page
        .getByTestId("playback-bar")
        .evaluate((el) =>
          el.scrollIntoView({ block: "start", behavior: "instant" }),
        );
      await evidence(page, "journey-replay", theme, size);
      await page
        .getByRole("button", { name: "Use 2D map", exact: true })
        .click();
      await expect(page.getByTestId("fallback-robots")).toContainText(
        "FAULT severe",
      );
      await expect(page.getByTestId("fallback-robots")).toContainText(
        "SYNTHETIC_SIM",
      );
      await page.getByTestId("fallback-robots").scrollIntoViewIfNeeded();
      await evidence(page, "journey-fallback", theme, size);
      mkdirSync(resolve(out, "observations"), { recursive: true });
      writeFileSync(
        resolve(out, "observations", `fault-${theme}-${size.width}.json`),
        JSON.stringify(
          {
            source: "actual POST /api/demo/simulation; no mocked transport",
            before: rov(before),
            after: rov(faulted),
            replayIdentical: true,
            simulatorTimeMs: faulted.snapshots.at(-1).simulatorTimeMs,
          },
          null,
          2,
        ) + "\n",
      );
      expect(errors).toEqual([]);
    });

for (const theme of themes)
  for (const size of [sizes[0]!, sizes[2]!])
    test(`no WebGL actual synthetic text alternative ${theme} ${size.width}`, async ({
      page,
    }) => {
      const errors = errorsOn(page);
      await page.setViewportSize(size);
      await setTheme(page, theme);
      await page.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          kind: string,
          ...args: unknown[]
        ) {
          if (["webgl", "webgl2", "experimental-webgl"].includes(kind))
            return null;
          return get.call(this, kind as "2d", ...(args as []));
        } as typeof get;
      });
      await page.goto("/demo/mission");
      await expect(page.getByTestId("fallback-2d")).toBeVisible();
      await operation(page, "Start synthetic survey");
      await operation(page, "Advance +1 step");
      const robots = page.getByTestId("fallback-robots");
      for (const text of [
        "drone-01",
        "rover-01",
        "rov-01",
        "SYNTHETIC_SIM",
        "pose ENU",
        "optical q",
      ])
        await expect(robots).toContainText(text);
      await expect(
        page.getByTestId("fallback-2d").getByRole("status"),
      ).toContainText("2D fallback");
      await robots.scrollIntoViewIfNeeded();
      await evidence(page, "no-webgl", theme, size);
      expect(errors).toEqual([]);
    });
