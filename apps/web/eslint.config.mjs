import next from "@next/eslint-plugin-next";
import hooks from "eslint-plugin-react-hooks";

export default [{
  files: ["apps/web/**/*.{ts,tsx}"],
  plugins: { "@next/next": next, "react-hooks": hooks },
  rules: {
    ...next.configs.recommended.rules,
    ...next.configs["core-web-vitals"].rules,
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
  },
  settings: { next: { rootDir: "apps/web/" } },
}];
