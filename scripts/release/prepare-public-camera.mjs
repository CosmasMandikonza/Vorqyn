import prepare from "./prepare-browser.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
export default function preparePublicCamera() {
  prepare();
  writeFileSync(
    join(process.env.RELEASE_ARTIFACT_DIR, "capture-scope.json"),
    JSON.stringify(
      {
        scope:
          "Actual signed-out public HTTPS camera acceptance; sourceSha in sidecars is the QA harness, not the remote deployment",
        origin: process.env.RELEASE_PUBLIC_ORIGIN,
        remoteDeploymentSha: null,
        note: "No mocks, forced clicks, product credentials or deployment-SHA inference. Inspect hosting record separately.",
      },
      null,
      2,
    ) + "\n",
  );
}
