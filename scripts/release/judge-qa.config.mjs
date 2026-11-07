import config from "./playwright.config.mjs";
export default {
  ...config,
  projects: [{ name: "judge-qa", testMatch: "judge-qa*.spec.ts" }],
};
