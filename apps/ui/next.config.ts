import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile the shared workspace package so Next.js can compile it
  transpilePackages: ["@devmind/shared"],
};

export default nextConfig;
