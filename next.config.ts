import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  /* config options here */
  experimental: {
    // see https://nextjs.org/docs/app/api-reference/functions/forbidden
    authInterrupts: true,
  },
};

export default nextConfig;
