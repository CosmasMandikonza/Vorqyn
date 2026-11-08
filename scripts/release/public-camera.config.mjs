/** Actual HTTPS camera matrix only. Native-zoom shell cases intentionally stay local. */
import config from "./judge-qa.config.mjs";
import prepare from "./prepare-browser.mjs";
import { safePublicUrl } from "./lib.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const origin = process.env.RELEASE_PUBLIC_ORIGIN;
if (!safePublicUrl(origin) || !process.env.RELEASE_ARTIFACT_DIR)
  throw new Error(
    "Supply an HTTPS RELEASE_PUBLIC_ORIGIN and fresh RELEASE_ARTIFACT_DIR",
  );
export default {
  ...config,
  globalSetup: () => {
    prepare();
    writeFileSync(
      join(process.env.RELEASE_ARTIFACT_DIR, "capture-scope.json"),
      JSON.stringify(
        {
          scope:
            "Actual signed-out public HTTPS camera acceptance; sourceSha in sidecars is the QA harness, not the remote deployment",
          origin,
          remoteDeploymentSha: null,
          note: "No mocks, forced clicks, product credentials or deployment-SHA inference. Inspect hosting record separately.",
        },
        null,
        2,
      ) + "\n",
    );
  },
  webServer: undefined,
  use: { ...config.use, baseURL: origin },
  projects: [
    { name: "public-camera", testMatch: "judge-qa-cross-system.spec.ts" },
  ],
};
