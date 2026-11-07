import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";

const KEY = "vorqyn.local-mission-drafts";
const shots = resolve(
  __dirname,
  "../../../../docs/evidence/vq-03-ux/screenshots",
);
async function capture(
  page: Page,
  options: { path: string; fullPage?: boolean },
) {
  // Capture from the top so Chromium does not include off-viewport fixed controls
  // at the previous scroll offset in a full-page image.
  await page.evaluate(() =>
    window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
  );
  await page.screenshot(options);
}
async function collection(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? '{"drafts":[]}').drafts,
    KEY,
  );
}
async function saved(page: Page) {
  await expect
    .poll(
      async () =>
        await page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          return raw
            ? JSON.parse(raw).drafts.some(
                (d: { complete: boolean }) => d.complete,
              )
            : false;
        }, KEY),
    )
    .toBe(true);
}
async function begin(page: Page, title: string) {
  await page
    .getByRole("button", { name: "New local draft", exact: true })
    .click();
  await page.getByRole("textbox", { name: /Mission title/ }).fill(title);
  await page.getByRole("button", { name: "Continue", exact: false }).click();
}
async function configure(
  page: Page,
  title: string,
  budget: string,
  kind: "water" | "land" = "water",
) {
  await begin(page, title);
  await page
    .getByRole("checkbox", {
      name:
        kind === "water" ? /Underwater inspection region/ : /Harbor trunk road/,
    })
    .check();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page
    .getByRole("checkbox", {
      name: kind === "water" ? "Sonar obstruction mapping" : "Route mapping",
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("textbox", { name: /Proposed budget/ }).fill(budget);
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(
    page.getByRole("heading", { name: "Review & save", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save local draft", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Save local draft", exact: true })
    .click();
  await saved(page);
  await expect(
    page.getByRole("status").filter({ hasText: /Draft reviewed/ }),
  ).toBeVisible();
}

test("distinct A and B survive reload, edits, repeated save and confirmed deletion", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (!["GET", "HEAD"].includes(r.method()))
      requests.push(r.method() + " " + r.url());
  });
  await page.goto("/workspace/create");
  await configure(page, "Mission A · Basin", "2.000000001");
  const a = (await collection(page))[0];
  expect(a.budgetLamports).toBe("2000000001");
  await page
    .getByRole("button", { name: "Save local draft", exact: true })
    .dblclick();
  await configure(page, "Mission B · Road", "7.5", "land");
  expect(await collection(page)).toHaveLength(2);
  await capture(page, {
    path: resolve(shots, "distinct-a-b-light-1280.png"),
    fullPage: true,
  });
  await page.reload();
  await page
    .getByRole("button", { name: /Mission A · Basin.*Reviewed/ })
    .click();
  await page
    .getByRole("button", { name: "Edit Objective", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: /Mission title/ }),
  ).toHaveValue("Mission A · Basin");
  await page
    .getByRole("textbox", { name: /Mission title/ })
    .fill("Mission A · Revised");
  await expect
    .poll(
      async () =>
        (await collection(page)).find((d: { id: string }) => d.id === a.id)
          ?.input.title,
    )
    .toBe("Mission A · Revised");
  await page
    .getByRole("button", { name: /Mission B · Road.*Reviewed/ })
    .click();
  await page.getByRole("button", { name: "Edit Proposed budget" }).click();
  await expect(
    page.getByRole("textbox", { name: /Proposed budget/ }),
  ).toHaveValue("7.5");
  await page.waitForTimeout(650);
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Delete Mission A · Revised", exact: true })
    .click();
  expect(await collection(page)).toHaveLength(2);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete Mission A · Revised", exact: true })
    .click();
  await expect.poll(async () => (await collection(page)).length).toBe(1);
  expect((await collection(page))[0].input.title).toBe("Mission B · Road");
  await capture(page, {
    path: resolve(shots, "after-delete-b-preserved-light-1280.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: /Proposed budget/ }),
  ).toHaveValue("7.5");
  expect(requests).toEqual([]);
});

test("validation focuses required fields and rejects contradictory evidence and invalid money", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/workspace/create");
  await page
    .getByRole("button", { name: "New local draft", exact: true })
    .click();
  await page.getByRole("textbox", { name: /Mission title/ }).fill("   ");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(
    page.getByRole("textbox", { name: /Mission title/ }),
  ).toBeFocused();
  await expect(
    page.getByText("Name this draft so you can find it later."),
  ).toBeVisible();
  await capture(page, {
    path: resolve(shots, "validation-title-light-390.png"),
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: /Mission title/ })
    .fill("Optical-only proposal");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.locator("#draft-zones")).toBeFocused();
  await page
    .getByRole("checkbox", { name: /Underwater inspection region/ })
    .check();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.locator("#draft-machines")).toBeFocused();
  await page
    .getByRole("checkbox", { name: "Optical inspection", exact: true })
    .check();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page
    .getByRole("textbox", { name: /Proposed budget/ })
    .fill("0.0000000001");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText(/must match a selected sensor/)).toBeVisible();
  await page.getByLabel("Underwater evidence method").selectOption("optical");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(
    page.getByRole("textbox", { name: /Proposed budget/ }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: /Proposed budget/ })
    .fill("0.000000001");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("0.000000001 SOL · 1 lamports")).toBeVisible();
});

test("partial inputs and step selection resume after reload", async ({
  page,
}) => {
  await page.goto("/workspace/create");
  await begin(page, "Work in progress");
  await page.getByRole("checkbox", { name: /Pier B deck/ }).check();
  await expect
    .poll(async () => (await collection(page))[0]?.input.zoneIds)
    .toContain("pier_b_deck");
  await expect.poll(async () => (await collection(page))[0]?.step).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Environment", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Pier B deck/ }),
  ).toBeChecked();
});

for (const raw of ["{bad-json", '{"version":42,"drafts":[]}'])
  test(`safe corrupt/version recovery ${raw}`, async ({ page }) => {
    await page.addInitScript(
      ({ key, raw }) => {
        if (!sessionStorage.getItem("seeded")) {
          localStorage.setItem(key, raw);
          sessionStorage.setItem("seeded", "yes");
        }
      },
      { key: KEY, raw },
    );
    await page.goto("/workspace/create");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Draft storage needs attention",
    );
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
      raw,
    );
    await capture(page, {
      path: resolve(
        shots,
        raw.startsWith("{bad")
          ? "corrupt-storage-light-1280.png"
          : "future-schema-light-1280.png",
      ),
      fullPage: true,
    });
    page.once("dialog", (d) => d.dismiss());
    await page
      .getByRole("button", { name: "Reset unreadable local drafts" })
      .click();
    expect(await page.evaluate((key) => localStorage.getItem(key), KEY)).toBe(
      raw,
    );
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "Reset unreadable local drafts" })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await begin(page, "Recovered plan");
    await expect
      .poll(async () => (await collection(page))[0]?.input.title)
      .toBe("Recovered plan");
  });

test("storage disabled preserves an editable memory-only draft and prompts before navigation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
  });
  await page.goto("/workspace/create");
  await begin(page, "Memory only");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Browser storage is disabled",
  );
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("link", { name: "Workspace", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/create/);
  await expect(
    page.getByRole("heading", { name: "Environment", exact: true }),
  ).toBeVisible();
});

test("sensitive-looking input never reaches local storage", async ({
  page,
}) => {
  await page.goto("/workspace/create");
  await page
    .getByRole("button", { name: "New local draft", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: /Mission title/ })
    .fill("private key: demonstration");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Sensitive-looking",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key) ?? "", KEY),
  ).not.toContain("private key");
});

test("two tabs detect stale edits, preserve copies and never resurrect a deleted draft", async ({
  context,
  page,
}) => {
  await page.goto("/workspace/create");
  await configure(page, "Shared plan", "2");
  const second = await context.newPage();
  await second.goto(page.url());
  await page
    .getByRole("button", { name: "Edit Objective", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: /Mission title/ })
    .fill("Tab A revision");
  await expect(second.getByRole("main").getByRole("alert")).toContainText(
    "A newer browser copy exists",
  );
  await second
    .getByRole("button", { name: "Keep changes as new draft" })
    .click();
  await expect.poll(async () => (await collection(page)).length).toBe(2);
  const copyId = new URL(second.url()).searchParams.get("draft");
  await second.waitForTimeout(600);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete Shared plan", exact: true })
    .click();
  await expect(second.getByRole("main").getByRole("alert")).toContainText(
    "A newer browser copy exists",
  );
  await second.getByRole("button", { name: "Load browser copy" }).click();
  await expect(
    second.getByRole("heading", { name: /A mission begins/ }),
  ).toBeVisible();
  expect(
    (await collection(page)).some((d: { id: string }) => d.id === copyId),
  ).toBe(false);
});

for (const theme of ["light", "dark"])
  for (const width of [1440, 1024, 390, 320])
    test(`review visual and axe ${theme} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(
        (theme) => localStorage.setItem("vorqyn-theme", theme),
        theme,
      );
      await page.goto("/workspace/create");
      await configure(page, "Pier B · Inspection brief", "1.250000001");
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const audit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        audit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      await capture(page, {
        path: resolve(shots, `review-${theme}-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Edit Objective", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Objective", exact: true }),
      ).toBeFocused();
      const formAudit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(formAudit.violations.map((v) => v.id)).toEqual([]);
      await capture(page, {
        path: resolve(shots, `objective-${theme}-${width}.png`),
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });

test("native 200% zoom and keyboard navigation", async ({ browser }, info) => {
  const c = await browser
    .browserType()
    .launchPersistentContext(info.outputPath("profile"), {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      headless: true,
      viewport: null,
      args: ["--window-size=1440,1000"],
    });
  try {
    const p = await c.newPage();
    await p.goto("chrome://settings/appearance");
    await p.evaluate(() => {
      const api = globalThis as unknown as {
        chrome: {
          settingsPrivate: { setDefaultZoom: (value: number) => void };
        };
      };
      api.chrome.settingsPrivate.setDefaultZoom(2);
    });
    await p.goto("http://127.0.0.1:3100/workspace/create");
    await p
      .getByRole("button", { name: "New local draft", exact: true })
      .focus();
    await p.keyboard.press("Enter");
    await expect(
      p.getByRole("heading", { name: "Objective", exact: true }),
    ).toBeFocused();
    await p.keyboard.press("Tab");
    await expect(
      p.getByRole("textbox", { name: /Mission title/ }),
    ).toBeFocused();
    expect(
      await p.evaluate(() => ({
        width: innerWidth,
        outer: outerWidth,
        ratio: devicePixelRatio,
      })),
    ).toEqual({ width: 720, outer: 1440, ratio: 2 });
    expect(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await capture(p, {
      path: resolve(shots, "native-zoom-200.png"),
      fullPage: true,
    });
  } finally {
    await c.close();
  }
});

test("tampered unsupported zones are blocked without silently replacing stored drafts", async ({
  page,
}) => {
  await page.goto("/workspace/create");
  await configure(page, "Zone integrity test", "3");
  await page.evaluate((key) => {
    const value = JSON.parse(localStorage.getItem(key)!);
    value.drafts[0].input.zoneIds = ["not-a-port-region"];
    localStorage.setItem(key, JSON.stringify(value));
  }, KEY);
  await page.reload();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "invalid fields",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), KEY),
  ).toContain("not-a-port-region");
});

test("quota failures never claim a save", async ({ page }) => {
  await page.addInitScript((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === key) throw new DOMException("Quota", "QuotaExceededError");
      return set.call(this, k, v);
    };
  }, KEY);
  await page.goto("/workspace/create");
  await begin(page, "Quota-limited plan");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "could not save",
  );
  expect(await collection(page)).toHaveLength(0);
});

test("capability and evidence controls pass accessibility audits and preserve keyboard edits", async ({
  page,
}) => {
  await page.goto("/workspace/create");
  await begin(page, "Accessible brief");
  await page
    .getByRole("checkbox", { name: /Underwater inspection region/ })
    .check();
  for (let step = 1; step <= 3; step++) {
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      audit.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    if (step === 2) {
      await page
        .getByRole("checkbox", {
          name: "Sonar obstruction mapping",
          exact: true,
        })
        .focus();
      await page.keyboard.press("Space");
    }
    await capture(page, {
      path: resolve(shots, `step-${step + 1}-light-1440.png`),
      fullPage: true,
    });
    if (step < 3) await page.getByRole("button", { name: /Continue/ }).click();
  }
});

test("unsupported Web Locks keeps planning editable without unsafe last-write behavior", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "locks", { value: undefined }),
  );
  await page.goto("/workspace/create");
  await begin(page, "Memory-only compatibility plan");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Web Locks support",
  );
  expect(await collection(page)).toHaveLength(0);
});

test("title text cannot inject markup or scripts into saved drafts", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", async (d) => {
    dialogs.push(d.message());
    await d.dismiss();
  });
  await page.goto("/workspace/create");
  await configure(page, "<img src=x onerror=alert(1)>", "1");
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "<img src=x onerror=alert(1)>",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("main").locator("img")).toHaveCount(0);
  expect(dialogs).toEqual([]);
});
