import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // UI talks to the local API server
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://localhost:${process.env.PORT ?? 8080}/:path*`,
      },
    ];
  },
};

export default nextConfig;
