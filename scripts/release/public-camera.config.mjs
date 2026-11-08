/** Actual HTTPS camera matrix only. Native-zoom shell cases intentionally stay local. */
import config from "./judge-qa.config.mjs";
import { safePublicUrl } from "./lib.mjs";
const origin = process.env.RELEASE_PUBLIC_ORIGIN;
if (!safePublicUrl(origin) || !process.env.RELEASE_ARTIFACT_DIR)
  throw new Error(
    "Supply an HTTPS RELEASE_PUBLIC_ORIGIN and fresh RELEASE_ARTIFACT_DIR",
  );
export default {
  ...config,
  globalSetup: new URL("./prepare-public-camera.mjs", import.meta.url).pathname,
  webServer: undefined,
  use: { ...config.use, baseURL: origin },
  projects: [
    { name: "public-camera", testMatch: "judge-qa-cross-system.spec.ts" },
  ],
};
