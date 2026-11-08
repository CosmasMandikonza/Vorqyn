import config from "../../apps/web/vitest.config.mts";
export default {
  ...config,
  test: {
    ...config.test,
    environment: "node",
    setupFiles: [],
    include: [
      `tests/cross-system/${process.env.INTEGRATION_COMPONENT}.acceptance.ts`,
    ],
  },
};
