import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/web/package.json"));
const { defineConfig } = require("@playwright/test");
const out =
  process.env.RELEASE_ARTIFACT_DIR ??
  resolve(root, "../release-browser-results");
const remote = process.env.RELEASE_TARGET_BASE_URL;
export default defineConfig({
  testDir: join(root, "apps/web/tests/browser"),
  workers: 1,
  fullyParallel: false,
  timeout: 90000,
  expect: { timeout: 20000 },
  outputDir: join(out, "traces"),
  reporter: [
    ["line"],
    [
      "json",
      {
        outputFile: join(
          out,
          process.env.RELEASE_STAGE === "integration"
            ? "integration-playwright.json"
            : "playwright.json",
        ),
      },
    ],
  ],
  use: {
    baseURL: remote ?? "http://127.0.0.1:3110",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: [
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-dev-shm-usage",
      ],
    },
  },
  projects: [
    { name: "judge", testMatch: "release-smoke.spec.ts" },
    { name: "capture", testMatch: "release-capture.spec.ts" },
    { name: "integration", testMatch: "release-integration.spec.ts" },
  ],
  webServer: remote
    ? undefined
    : {
        command: "pnpm --filter @vorqyn/web start --port 3110",
        cwd: root,
        url: "http://127.0.0.1:3110",
        reuseExistingServer: false,
        timeout: 30000,
      },
});
