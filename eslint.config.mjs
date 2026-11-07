// @ts-check
import tseslint from "typescript-eslint";
import frontendLint from "./apps/web/eslint.config.mjs";

/**
 * VORQYN root ESLint config (VQ-00 foundation).
 *
 * Deliberately minimal: shared TypeScript/JavaScript rules across the
 * workspace. Lane 2 introduces the full Next.js lint configuration together
 * with the branded UI shell in VQ-02 (#3); this file must not become a
 * contested shared surface between lanes.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/target/**",
      "**/.anchor/**",
      "**/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  ...frontendLint,
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { jsx: true },
    },
  },
);
