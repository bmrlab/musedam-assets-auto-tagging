// 迁移脚本/接口共用的出网 fetch。不依赖 Next / "server-only"。
//
// 客户环境常见的做法是通过 HTTPS_PROXY 环境变量走代理出公网：容器里 curl 会自动读这些变量，
// Node 自带的 fetch 不读，于是出现"容器里 curl 通、应用里 fetch 立刻失败"。
// 配了任一代理变量就用 undici 的 EnvHttpProxyAgent（同时尊重 NO_PROXY），否则直连。
// 变量优先级与 Jina 调用保持一致（src/lib/brand/env.ts）：FETCH_HTTPS_PROXY > HTTPS_PROXY > HTTP_PROXY > ALL_PROXY。

import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import type { SourceFetch } from "./import-team";

export function buildOutboundFetch(): { fetch: SourceFetch; label: string } {
  const env = (k: string) => process.env[k]?.trim() || process.env[k.toLowerCase()]?.trim() || "";
  const httpsProxy = env("FETCH_HTTPS_PROXY") || env("HTTPS_PROXY") || env("HTTP_PROXY") || env("ALL_PROXY");
  if (!httpsProxy) return { fetch: (url) => fetch(url), label: "直连（未配置代理环境变量）" };
  const noProxy = env("NO_PROXY");
  const dispatcher = new EnvHttpProxyAgent({ httpProxy: env("HTTP_PROXY") || httpsProxy, httpsProxy, noProxy });
  const shownProxy = httpsProxy.replace(/\/\/[^@]*@/, "//***@"); // 不打印代理里的账号密码
  return {
    fetch: (url) => undiciFetch(url, { dispatcher }),
    label: `代理 ${shownProxy}${noProxy ? `（NO_PROXY=${noProxy}）` : ""}`,
  };
}
