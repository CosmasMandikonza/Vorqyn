import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Consume @vorqyn/contracts as TypeScript source from the workspace.
  transpilePackages: ["@vorqyn/contracts"],
};

export default nextConfig;
