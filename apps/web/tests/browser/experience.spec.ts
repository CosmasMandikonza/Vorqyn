import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

const screenshotDirectory = resolve(
  __dirname,
  "../../../../docs/evidence/vq-02/screenshots",
);
const routes = [
  { path: "/", name: "landing" },
  { path: "/demo", name: "demo" },
  { path: "/workspace", name: "workspace" },
];

for (const route of routes)
  for (const theme of ["light", "dark"])
    for (const width of [1440, 1280, 1024, 390, 320]) {
      test(`${route.name} / ${theme} / ${width}px`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.addInitScript(
          (selected) => localStorage.setItem("vorqyn-theme", selected),
          theme,
        );
        const response = await page.goto(route.path);
        expect(response?.status()).toBe(200);
        await expect(page.locator("html")).toHaveClass(
          theme === "dark" ? "dark" : "light",
        );
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator("main h1")).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const audit = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          audit.violations.map(({ id, nodes }) => ({
            id,
            targets: nodes.map((n) => n.target),
          })),
        ).toEqual([]);
        await page.screenshot({
          path: resolve(
            screenshotDirectory,
            `${route.name}-${theme}-${width}.png`,
          ),
          fullPage: true,
          animations: "disabled",
        });
        expect(errors).toEqual([]);
      });
    }

test("hero CTAs, route navigation and native builder outline", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Explore Demo" })
    .first()
    .click();
  await expect(page).toHaveURL("/demo");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "One mission. Three environments.",
  );
  await page
    .getByRole("main")
    .getByRole("link", { name: "Create Workspace" })
    .click();
  await expect(page).toHaveURL("/workspace");
  await page.getByRole("link", { name: "View mission template" }).click();
  await page.getByText("Preview mission structure", { exact: true }).click();
  await expect(
    page.getByText("Evidence & budget", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("theme survives navigation and reload and responds to system changes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "Dark", exact: true }).first().click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page
    .getByRole("main")
    .getByRole("link", { name: "Explore Demo" })
    .first()
    .click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveClass("dark");
  expect(await page.evaluate(() => localStorage.getItem("vorqyn-theme"))).toBe(
    "dark",
  );
  await page
    .getByRole("button", { name: "System", exact: true })
    .first()
    .click();
  await expect(page.locator("html")).toHaveClass("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass("light");
});

test("keyboard mobile sheet traps focus, closes with Escape and follows links", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Navigate VORQYN" });
  await expect(dialog).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveCSS("outline-style", "solid");
  await trigger.press("Enter");
  await dialog.getByRole("link", { name: "Explore Demo" }).click();
  await expect(page).toHaveURL("/demo");
  await expect(dialog).toHaveCount(0);
});

test("skip link and reduced motion preserve immediate readable content", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(
    await page
      .locator(".split-word")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("all internal link paths and anchor targets exist", async ({
  page,
  request,
}) => {
  for (const route of routes) {
    await page.goto(route.path);
    const destinations = await page
      .locator('a[href^="/"], a[href^="#"]')
      .evaluateAll((anchors) => [
        ...new Set(anchors.map((a) => a.getAttribute("href")!)),
      ]);
    for (const destination of destinations) {
      const [path, hash] = destination.split("#");
      expect((await request.get(path || route.path)).status()).toBe(200);
      if (hash) {
        await page.goto(`${path || route.path}#${hash}`);
        await expect(page.locator(`[id="${hash}"]`)).toHaveCount(1);
      }
    }
  }
});

test("missing route gives a useful 404 and no fabricated success", async ({
  page,
}) => {
  expect((await page.goto("/not-a-route"))?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "This route is outside the map." }),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("link", { name: "Return to overview" })
    .click();
  await expect(page).toHaveURL("/");
});

test("blocked fonts use readable fallbacks", async ({ page }) => {
  await page.route("**/*.{woff,woff2}", (route) => route.abort());
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("native 200% browser zoom keeps navigation and primary actions usable", async ({
  browser,
}, testInfo) => {
  const context = await browser
    .browserType()
    .launchPersistentContext(testInfo.outputPath("zoom-profile"), {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      headless: true,
      viewport: null,
      args: ["--window-size=1440,1000"],
    });
  try {
    const page = await context.newPage();
    await page.goto("chrome://settings/appearance");
    await page.evaluate(() => {
      const settings = globalThis as unknown as {
        chrome: { settingsPrivate: { setDefaultZoom: (zoom: number) => void } };
      };
      settings.chrome.settingsPrivate.setDefaultZoom(2);
    });
    for (const route of routes) {
      await page.goto(`http://127.0.0.1:3100${route.path}`);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => ({
          width: innerWidth,
          ratio: devicePixelRatio,
          outer: outerWidth,
        })),
      ).toEqual({ width: 720, ratio: 2, outer: 1440 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole("button", { name: "Open navigation" }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.screenshot({
        path: resolve(screenshotDirectory, `${route.name}-zoom-200.png`),
        fullPage: true,
      });
    }
  } finally {
    await context.close();
  }
});

test("server-rendered routes remain readable with JavaScript disabled", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  for (const route of routes) {
    expect(
      (await page.goto(`http://127.0.0.1:3100${route.path}`))?.status(),
    ).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("http://127.0.0.1:3100/workspace");
  await page.getByText("Preview mission structure", { exact: true }).click();
  await expect(
    page.getByText("Evidence & budget", { exact: true }),
  ).toBeVisible();
  await context.close();
});
