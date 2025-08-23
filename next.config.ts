import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*musetransfer*" },
      { protocol: "https", hostname: "*tezign*" },
      { protocol: "https", hostname: "*musedam*" },
    ],
  },
  experimental: {
    // see https://nextjs.org/docs/app/api-reference/functions/forbidden
    authInterrupts: true,
  },
};

export default nextConfig;
