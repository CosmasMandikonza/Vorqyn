import config from "./playwright.config.mjs";
export default {
  ...config,
  use: { ...config.use, actionTimeout: 10000, navigationTimeout: 30000 },
  projects: [{ name: "judge-qa", testMatch: "judge-qa*.spec.ts" }],
};
