import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
