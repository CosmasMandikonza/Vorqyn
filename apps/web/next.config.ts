import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Deployment only: retain traced imports outside the web workspace.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Consume @vorqyn/contracts as TypeScript source from the workspace.
  transpilePackages: ["@vorqyn/contracts"],
};

export default nextConfig;
