import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../../../../../vq28-browser-results",
  reporter: [
    ["line"],
    [
      "json",
      { outputFile: "../../../../../vq28-browser-results/results.json" },
    ],
  ],
  timeout: 60000,
  webServer: {
    command: "pnpm start --port 3100",
    cwd: "../..",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
