import { test, expect, type Page } from "@playwright/test";

async function ready(page: Page) {
  await expect(
    page.getByRole("button", { name: "Use 2D map", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId("world-canvas-frame").locator("canvas"),
  ).toBeVisible();
  await expect(page.getByTestId("loading-veil")).toHaveCount(0);
}
test("judge journey: landing → guest → real 3D → 2D → independently saved local draft", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Explore Demo", exact: false })
    .first()
    .click();
  await expect(page).toHaveURL(/\/demo$/);
  await page
    .getByRole("link", { name: "Explore the 3D world preview" })
    .click();
  await expect(page).toHaveURL(/\/demo\/mission$/);
  await ready(page);
  await expect(page.getByTestId("honesty-badge")).toContainText(
    /Static vehicle anchors|SYNTHETIC_SIM|Synthetic simulation/i,
  );
  const canvas = page.getByTestId("world-canvas-frame").locator("canvas");
  expect(
    await canvas.evaluate((el) => (el as HTMLCanvasElement).width),
  ).toBeGreaterThan(100);
  for (const name of ["AIR", "LAND", "UW", "INSPECT", "RESET"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Use 2D map", exact: true }).click();
  await expect(page.getByTestId("fallback-2d")).toContainText("ENU m");
  await expect(
    page.getByRole("img", { name: /Generated top-down plan/ }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Create Workspace", exact: false })
    .first()
    .click();
  await page.getByRole("link", { name: "Plan a local mission draft" }).click();
  await expect(page).toHaveURL(/\/workspace\/create/);
  await expect(
    page.getByText(
      "Local Mission Draft · Saved in This Browser · Not Funded or Launched",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "New local draft", exact: true })
    .click();
  await page.getByLabel(/Mission title/).fill("Judge release · Basin brief");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page
    .getByRole("checkbox", { name: /Underwater inspection region/ })
    .check();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page
    .getByRole("checkbox", { name: "Sonar obstruction mapping", exact: true })
    .check();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel(/Proposed budget/).fill("1.000000001");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(
    page.getByRole("button", { name: "Save local draft", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Save local draft", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("vorqyn.local-mission-drafts") ??
              '{"drafts":[]}',
          ).drafts[0]?.complete,
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Judge release · Basin brief",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("1.000000001 SOL · 1000000001 lamports", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("no WebGL preserves real metadata, machine selection and source labels", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (
        kind === "webgl" ||
        kind === "webgl2" ||
        kind === "experimental-webgl"
      )
        return null;
      return get.call(this, kind as "2d", ...(args as []));
    } as typeof get;
  });
  await page.goto("/demo/mission");
  await expect(page.getByTestId("fallback-2d")).toContainText("WebGL-capable");
  await page
    .getByRole("button", { name: "Inspection ROV", exact: true })
    .click();
  await expect(page.getByTestId("fallback-2d")).toContainText("rov_home");
  await expect(page.getByTestId("fallback-2d")).toContainText(
    /Static anchor fixture|SYNTHETIC_SIM/,
  );
});

test("failed metadata is an explicit error, never an infinite successful loader", async ({
  page,
}) => {
  await page.route("**/port-world/world.json", (route) =>
    route.fulfill({
      status: 503,
      body: "Release QA: deliberately unavailable",
    }),
  );
  await page.goto("/demo/mission");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "World metadata unavailable",
  );
  await expect(page.getByTestId("honesty-badge")).toContainText(
    /Static|SYNTHETIC_SIM/i,
  );
});

test("failed GLB is recoverable through actual 2D fallback", async ({
  page,
}) => {
  await page.route("**/port-world/*.glb", (route) => route.abort("failed"));
  await page.goto("/demo/mission");
  await expect(
    page.getByRole("button", { name: "Retry 3D view", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use 2D map", exact: true }).click();
  await expect(page.getByTestId("fallback-2d")).toContainText(
    "Inspection regions",
  );
});

test("keyboard, reduced motion, selection and theme changes keep static source truth", async ({
  page,
}) => {
  await page.goto("/demo/mission");
  await ready(page);
  const station = page.getByRole("button", { name: "LAND", exact: true });
  await station.focus();
  await page.keyboard.press("Enter");
  await expect(station).toHaveAttribute("aria-pressed", "true");
  await expect(station).toHaveCSS("outline-style", "solid");
  const inspector = page
    .locator('[data-testid="inspector-panel"]:visible')
    .first();
  await inspector
    .getByRole("button", { name: "Access rover", exact: true })
    .click();
  const facts = await inspector.locator("dl").innerText();
  await page.getByRole("button", { name: "Dark", exact: true }).first().click();
  await expect.poll(() => inspector.locator("dl").innerText()).toBe(facts);
  await expect(page.getByTestId("honesty-badge")).toContainText(
    /Static|SYNTHETIC_SIM/i,
  );
  expect(await page.locator(".split-word").count()).toBe(0);
  await expect(
    page.getByRole("button", { name: "Use 2D map", exact: true }),
  ).toBeVisible();
});

test("native 200% zoom keeps viewer navigation accessible", async ({
  browser,
}, info) => {
  const c = await browser
    .browserType()
    .launchPersistentContext(info.outputPath("zoom-profile"), {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      headless: true,
      viewport: null,
      deviceScaleFactor: undefined,
      args: [
        "--window-size=1440,900",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
  try {
    const p = await c.newPage();
    await p.goto("chrome://settings/appearance");
    await p.evaluate(() => {
      const w = globalThis as unknown as {
        chrome: { settingsPrivate: { setDefaultZoom: (x: number) => void } };
      };
      w.chrome.settingsPrivate.setDefaultZoom(2);
    });
    await p.goto("http://127.0.0.1:3110/demo/mission");
    await ready(p);
    expect(
      await p.evaluate(() => ({ width: innerWidth, ratio: devicePixelRatio })),
    ).toEqual({ width: 720, ratio: 2 });
    expect(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await p.getByRole("button", { name: "Use 2D map", exact: true }).click();
    await expect(p.getByTestId("fallback-2d")).toBeVisible();
  } finally {
    await c.close();
  }
});
