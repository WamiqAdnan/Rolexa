import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse and mammoth are CommonJS with dynamic requires — keep them out of
  // the bundler and let Node resolve them at runtime.
  serverExternalPackages: ["pdf-parse", "mammoth"],
  experimental: {
    // CV uploads can be a few MB.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
