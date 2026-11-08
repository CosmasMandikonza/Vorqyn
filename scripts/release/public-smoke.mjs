#!/usr/bin/env node
/** Fresh anonymous contexts; no credentials, protection bypass or mocked API. */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { smokeOrigin } from "./public-smoke-lib.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2),
  value = (name) => args[args.indexOf(name) + 1];
if (!args.includes("--out") || !value("--out"))
  throw new Error("--out <NEW directory outside checkout> is required");
const out = resolve(value("--out")),
  rel = relative(root, out);
if (!rel.startsWith("../") || existsSync(out))
  throw new Error("Choose a new artifact directory outside the checkout");
mkdirSync(out, { recursive: true });
const git = (argv) =>
  spawnSync("git", argv, { cwd: root, encoding: "utf8" }).stdout?.trim();
const localOnly = args.includes("--local-only");
const report = {
  schema: "vorqyn.public-smoke/1",
  startedAt: new Date().toISOString(),
  status: "BLOCKED",
  scope: localOnly
    ? "LOCAL HARNESS ONLY — no public deployment verified"
    : "signed-out public HTTPS functional smoke",
  checkoutSha: git(["rev-parse", "HEAD"]),
  workingTreeDirty: !!git(["status", "--porcelain"]),
  origin: null,
  remoteDeploymentSha: null,
  provenance:
    "Retain the actual hosting build/deploy record separately; browser checks cannot attest the remote commit.",
  checks: [],
  priorStrictQa: {
    status: "FAIL",
    sourceSha: "cbbdb18abdd70d1519cc76f53dd28f52fd8702f4",
    report: "docs/evidence/qa-final/README.md",
    note: "Historical failures remain preserved. This hosting smoke cannot clear them; consult the separately executed merged-main strict QA follow-up.",
  },
};
let browser;
try {
  if (!args.includes("--origin")) {
    report.reason =
      "No public HTTPS origin supplied; deployment and external smoke remain BLOCKED";
    process.exitCode = 2;
  } else {
    report.origin = smokeOrigin(value("--origin"), localOnly);
    const require = createRequire(join(root, "apps/web/package.json"));
    const { chromium, expect } = require("@playwright/test");
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: [
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-dev-shm-usage",
      ],
    });
    report.browserVersion = browser.version();
    const options = {
      baseURL: report.origin,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      ignoreHTTPSErrors: false,
      storageState: { cookies: [], origins: [] },
    };
    const context = await browser.newContext(options);
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(30000);
    report.cookiesAtStart = (await context.cookies()).length;
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.addInitScript(() =>
      localStorage.setItem("vorqyn-theme", "light"),
    );
    const check = async (id, fn) => {
      const start = Date.now();
      try {
        const detail = await fn();
        report.checks.push({
          id,
          status: "PASS",
          durationMs: Date.now() - start,
          detail,
        });
      } catch (error) {
        report.checks.push({
          id,
          status: "FAIL",
          durationMs: Date.now() - start,
          reason: error.message,
        });
      }
    };
    const capture = async (p, name) => {
      await p.evaluate(() => document.fonts.ready);
      const viewport = await p.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      }));
      expect(viewport).toEqual({ width: 1440, height: 900, dpr: 1 });
      await expect(p.locator("html")).toHaveClass(/light/);
      mkdirSync(join(out, "screenshots"), { recursive: true });
      const png = await p.screenshot({
        path: join(out, "screenshots", `${name}-light-1440x900.png`),
        fullPage: false,
        animations: "disabled",
        scale: "device",
      });
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.subarray(12, 16).toString()).toBe("IHDR");
      const pixels = {
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20),
      };
      expect(pixels).toEqual({ width: 1440, height: 900 });
      writeFileSync(
        join(out, "screenshots", `${name}-light-1440x900.json`),
        JSON.stringify(
          {
            url: p.url(),
            viewport,
            png: pixels,
            theme: await p.locator("html").getAttribute("class"),
            checkoutSha: report.checkoutSha,
            remoteDeploymentSha: null,
            scope: report.scope,
            screenshotOptions: {
              fullPage: false,
              animations: "disabled",
              scale: "device",
            },
            capturedAt: new Date().toISOString(),
            sha256: createHash("sha256").update(png).digest("hex"),
          },
          null,
          2,
        ) + "\n",
      );
    };
    for (const [route, label] of [
      ["/", "home"],
      ["/demo", "demo"],
      ["/demo/mission", "mission"],
      ["/workspace/create", "draft"],
    ])
      await check(`route-${label}`, async () => {
        const response = await page.goto(route);
        expect(response.status()).toBe(200);
        expect(new URL(page.url()).origin).toBe(report.origin);
        expect(new URL(page.url()).pathname).toBe(route);
        await expect(
          page.locator("header").getByRole("link", { name: "VORQYN home" }),
        ).toBeVisible();
        await expect(
          page.getByRole("main").getByRole("heading", { level: 1 }),
        ).toBeVisible();
        if (label === "mission") {
          await expect(
            page.getByTestId("world-canvas-frame").locator("canvas"),
          ).toBeVisible();
          await expect(page.getByTestId("loading-veil")).toHaveCount(0);
        }
        if (label === "draft")
          await expect(
            page.getByText(
              "Local Mission Draft · Saved in This Browser · Not Funded or Launched",
              { exact: true },
            ),
          ).toBeVisible();
        await capture(page, label);
        return { status: response.status(), url: page.url() };
      });
    await check("actual-api-and-server-limits", async () => {
      const post = (operations) =>
        context.request.post("/api/demo/simulation", {
          data: {
            schema: "vorqyn.demo-sim/request/1",
            seed: 20261107,
            operations,
          },
          timeout: 30000,
        });
      const cleanResponse = await post([{ op: "step", count: 2 }]);
      expect(cleanResponse.status()).toBe(200);
      expect(cleanResponse.headers()["cache-control"]).toContain("no-store");
      const clean = await cleanResponse.json();
      expect(clean.sourceKind).toBe("SYNTHETIC_SIM");
      expect(clean.frameId).toBe("ENU_PORT-001_LOCAL");
      expect(clean.snapshots).toHaveLength(2);
      expect(await (await post([{ op: "step", count: 2 }])).json()).toEqual(
        clean,
      );
      const faulted = await (
        await post([
          { op: "step", count: 1 },
          {
            op: "command",
            command: {
              type: "injectOpticalVisibilityFault",
              robotId: "rov-01",
              severity: "severe",
              durationMs: 9000,
              idempotencyKey: "public-smoke-fault",
            },
          },
          { op: "step", count: 1 },
        ])
      ).json();
      const rov = (data) =>
        data.snapshots.at(-1).robots.find((r) => r.robotId === "rov-01");
      const q = (data, kind) =>
        rov(data).sensors.find((s) => s.kind === kind).measured.quality01;
      expect(q(faulted, "optical")).toBeLessThan(q(clean, "optical") * 0.3);
      expect(q(faulted, "sonar")).toBe(q(clean, "sonar"));
      const limits = [];
      for (const [name, operations] of [
        [
          "101 operations",
          Array.from({ length: 101 }, () => ({ op: "step", count: 1 })),
        ],
        ["13 steps per operation", [{ op: "step", count: 13 }]],
        [
          "408 total steps",
          Array.from({ length: 34 }, () => ({ op: "step", count: 12 })),
        ],
      ]) {
        const r = await post(operations);
        expect(r.status()).toBe(400);
        limits.push({ name, status: r.status() });
      }
      const oversized = await context.request.post("/api/demo/simulation", {
        data: "x".repeat(16385),
        headers: { "content-type": "application/json" },
      });
      expect(oversized.status()).toBe(413);
      const malformed = await context.request.post("/api/demo/simulation", {
        data: "{",
        headers: { "content-type": "application/json" },
      });
      expect(malformed.status()).toBe(400);
      const method = await context.request.get("/api/demo/simulation");
      expect(method.status()).toBe(405);
      const maximum = await post([
        ...Array.from({ length: 33 }, () => ({ op: "step", count: 12 })),
        { op: "step", count: 4 },
      ]);
      expect(maximum.status()).toBe(200);
      const maximumBody = await maximum.body();
      const maxData = JSON.parse(maximumBody.toString("utf8"));
      expect(maxData.snapshots).toHaveLength(400);
      expect(maxData.snapshots.at(-1).simulatorTimeMs).toBe(200000);
      const detail = {
        sourceKind: clean.sourceKind,
        matchedSimulatorTimeMs: clean.snapshots.at(-1).simulatorTimeMs,
        optical: {
          control: q(clean, "optical"),
          faulted: q(faulted, "optical"),
        },
        sonar: { control: q(clean, "sonar"), faulted: q(faulted, "sonar") },
        repeatedTraceIdentical: true,
        limits,
        body16385Bytes: oversized.status(),
        malformedJson: malformed.status(),
        getMethod: method.status(),
        maximumStepsAccepted: 400,
        maximumResponseBytes: maximumBody.length,
        perIpRateLimit:
          "NOT IMPLEMENTED by this route; trace bounds are not an incoming request quota",
      };
      writeFileSync(
        join(out, "api-proof.json"),
        JSON.stringify(detail, null, 2) + "\n",
      );
      return detail;
    });
    await check("source-bound-observation-trace-api", async () => {
      const data = {
        schema: "vorqyn.demo-sim/request/1",
        seed: 20261107,
        operations: [{ op: "step", count: 2 }],
      };
      const request = () =>
        context.request.post("/api/demo/observations", { data });
      const first = await request();
      expect(first.status()).toBe(200);
      expect(first.headers()["cache-control"]).toContain("no-store");
      const trace = await first.json();
      expect(trace.schema).toBe("vorqyn.guest-trace/response/1");
      expect(trace.sourceKind).toBe("SYNTHETIC_SIM");
      expect(trace.journal.recordsAccepted).toBe(2);
      expect(trace.clockDomains.chain).toBeNull();
      expect(trace.clockDomains.receipt).toContain("not UTC");
      expect(await (await request()).json()).toEqual(trace);
      const paged = await context.request.post(
        "/api/demo/observations?afterSequence=1&limit=1",
        { data },
      );
      expect(paged.status()).toBe(200);
      const pageData = await paged.json();
      expect(pageData.trace.records).toHaveLength(1);
      expect(pageData.trace.records[0].sequence).toBe(2);
      return {
        schema: trace.schema,
        sourceKind: trace.sourceKind,
        clockDomains: trace.clockDomains,
        records: trace.journal.recordsAccepted,
        repeatedTraceIdentical: true,
        pagingSequence: pageData.trace.records[0].sequence,
      };
    });
    await check("real-browser-fault-replay-and-2d", async () => {
      await page.goto("/demo/mission");
      await expect(page.getByTestId("loading-veil")).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page
        .getByRole("button", { name: "World Dive", exact: true })
        .click();
      const skip = page.getByRole("button", { name: /World Dive.*skip/ });
      await expect(skip).toBeVisible();
      await skip.click();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(
        page.getByRole("button", { name: "World Dive", exact: true }),
      ).toHaveCount(0);
      const operation = async (name) => {
        const [r] = await Promise.all([
          page.waitForResponse(
            (r) =>
              r.url().endsWith("/api/demo/simulation") &&
              r.request().method() === "POST",
          ),
          page.getByRole("button", { name, exact: true }).click(),
        ]);
        expect(r.status()).toBe(200);
        await expect(
          page.getByRole("button", { name: "Advance +1 step", exact: true }),
        ).toBeEnabled();
        return r.json();
      };
      await operation("Start synthetic survey");
      await operation("Advance +1 step");
      await operation("Advance +1 step");
      await operation("Advance +1 step");
      const inspector = page
        .locator('[data-testid="inspector-panel"]:visible')
        .first();
      await inspector
        .getByRole("button", { name: "Inspection ROV", exact: true })
        .click();
      await page
        .getByRole("group", { name: "Camera station", exact: true })
        .getByRole("button", { name: "FOLLOW", exact: true })
        .click();
      await operation("Inject underwater optical fault");
      await operation("Advance +1 step");
      const faulted = await operation("Advance +1 step");
      await expect(inspector).toContainText(
        "Active optical-visibility fault: severe",
      );
      await page
        .getByTestId("world-canvas-frame")
        .evaluate((el) =>
          el.scrollIntoView({ block: "center", behavior: "instant" }),
        );
      await page.waitForTimeout(600);
      await capture(page, "fault-follow");
      const ghost = page.getByRole("button", {
        name: /Ghost replay: recorded paths hidden/,
      });
      await ghost.click();
      await expect(
        page.getByRole("button", {
          name: /Ghost replay: recorded paths shown/,
        }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("playback-bar")).toContainText(
        "no simulated recovery",
      );
      await page.getByTestId("world-canvas-frame").scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await capture(page, "ghost-recorded-paths");
      const replay = await operation("Replay history");
      expect(replay.snapshots).toEqual(faulted.snapshots);
      await expect(page.getByTestId("replay-badge")).toContainText(
        "Replay identical",
      );
      await page.getByTestId("playback-bar").scrollIntoViewIfNeeded();
      await capture(page, "replay");
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
      await capture(page, "fallback");
      return {
        actualPost: true,
        replayIdentical: true,
        worldDiveInterrupted: true,
        reducedMotionHidesDive: true,
        ghostPathsAreRecordedOnly: true,
        sourceKind: "SYNTHETIC_SIM",
      };
    });
    await check("no-webgl-signed-out-alternative", async () => {
      const c = await browser.newContext(options);
      c.setDefaultTimeout(15000);
      try {
        const p = await c.newPage();
        p.on("pageerror", (e) => errors.push(e.message));
        p.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        await p.addInitScript(() => {
          localStorage.setItem("vorqyn-theme", "light");
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
            if (["webgl", "webgl2", "experimental-webgl"].includes(kind))
              return null;
            return get.call(this, kind, ...rest);
          };
        });
        await p.goto("/demo/mission");
        await expect(p.getByTestId("fallback-2d")).toBeVisible();
        await p
          .getByRole("button", { name: "Start synthetic survey", exact: true })
          .click();
        await p
          .getByRole("button", { name: "Advance +1 step", exact: true })
          .click();
        for (const text of [
          "SYNTHETIC_SIM",
          "drone-01",
          "rover-01",
          "rov-01",
          "pose ENU",
        ])
          await expect(p.getByTestId("fallback-robots")).toContainText(text);
        await expect(p.getByTestId("fallback-robots")).toContainText(
          "sim t 500 ms",
        );
        await p.getByTestId("fallback-robots").scrollIntoViewIfNeeded();
        await capture(p, "no-webgl");
        return "Actual context creation disabled; real API observations retained as text";
      } finally {
        await c.close();
      }
    });
    await check("unexpected-console-errors", async () => {
      expect(errors).toEqual([]);
      return errors;
    });
    report.status = report.checks.some((c) => c.status === "FAIL")
      ? "FAIL"
      : "PASS";
    report.publicHttpsSmoke = localOnly
      ? "NOT RUN — local validation cannot certify external access"
      : report.status;
    process.exitCode = report.status === "PASS" ? 0 : 1;
    await context.close();
  }
} catch (error) {
  report.status = "FAIL";
  report.reason = error.message;
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(
    join(out, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
