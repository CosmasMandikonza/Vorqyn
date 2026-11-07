import tseslint from "typescript-eslint";
import next from "@next/eslint-plugin-next";
import hooks from "eslint-plugin-react-hooks";

export const frontendRules = {
  plugins: { "@next/next": next, "react-hooks": hooks },
  rules: {
    ...next.configs.recommended.rules,
    ...next.configs["core-web-vitals"].rules,
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",
  },
};

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/next-env.d.ts"] },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    ...frontendRules,
    settings: { next: { rootDir: import.meta.dirname } },
  },
);
