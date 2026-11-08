/**
 * Browser-target bundling verification (PR #50 review finding 1).
 *
 * Bundles the package entrypoint for the browser platform and FAILS if:
 *  - the bundle references any node: builtin, or
 *  - esbuild had to mark anything as external (silent runtime breakage).
 * Run as part of `pnpm test` so CI enforces it on every change.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: "browser",
  format: "esm",
  write: false,
  logLevel: "silent",
  metafile: true,
});

const nodeImports = Object.keys(result.metafile.inputs).filter((f) => f.includes("node:"));
if (nodeImports.length > 0) {
  console.error(`FAIL: browser bundle pulled in Node builtins: ${nodeImports.join(", ")}`);
  process.exit(1);
}
const externals = result.outputFiles.flatMap((f) =>
  [...f.text.matchAll(/from\s*"([^"]*node:[^"]*)"/g)].map((m) => m[1]),
);
if (externals.length > 0) {
  console.error(`FAIL: browser bundle still imports node builtins: ${[...new Set(externals)].join(", ")}`);
  process.exit(1);
}
console.log(`OK: @vorqyn/chain-client bundles clean for the browser (${Object.keys(result.metafile.inputs).length} modules)`);
