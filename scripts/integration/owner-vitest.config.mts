/** Read-only owner unit tests, not an orchestration/authority driver or owner workspace CI. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const harness = fileURLToPath(new URL("../..", import.meta.url));
const target = process.env.INTEGRATION_TARGET_ROOT;
const component = process.env.INTEGRATION_OWNER_SUITE;
if (
  !target ||
  !["mission-orchestration", "evidence-adapter"].includes(component ?? "")
)
  throw new Error(
    "Supply reviewed INTEGRATION_TARGET_ROOT and INTEGRATION_OWNER_SUITE",
  );
export default {
  root: resolve(target, "apps/web"),
  resolve: {
    alias: {
      "@": resolve(target, "apps/web"),
      "@vorqyn/contracts": resolve(harness, "packages/contracts/src/index.ts"),
      vitest: resolve(harness, "apps/web/node_modules/vitest/dist/index.js"),
    },
  },
  test: {
    environment: "node",
    setupFiles: [],
    include: [`tests/${component}/*.test.tsx`],
  },
};
