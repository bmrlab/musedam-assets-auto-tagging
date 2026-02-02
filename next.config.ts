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
  // 限制缓存大小，防止磁盘空间问题
  onDemandEntries: {
    // 页面在内存中保留的最长时间（秒）
    maxInactiveAge: 60 * 60, // 1 小时
    // 同时保留在内存中的页面数量
    pagesBufferLength: 5,
  },
};

const withNextIntl = createNextIntlPlugin();
export default withNextIntl(nextConfig);
