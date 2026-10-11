// 每个 tab / iframe 自己持有的登录 token（不再依赖共享的 session cookie，避免多个 tab 切换团队时互相覆盖）。
// 浏览器里 sessionStorage 按「顶层浏览上下文」隔离，同一个 tab 里的多个同源 iframe 共用，不同 tab 互不影响。
// sessionStorage 不可用时（第三方存储被禁用等）退回内存变量；整页刷新靠 URL 上的 `_t` 参数兜底。

export const AUTH_TOKEN_HEADER = "x-auth-token";
export const AUTH_TOKEN_QUERY = "_t";
const STORAGE_KEY = "auto-tagging.auth-token";

let memoryToken: string | null = null;

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {}
  if (memoryToken) return memoryToken;
  try {
    return new URL(window.location.href).searchParams.get(AUTH_TOKEN_QUERY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  memoryToken = token;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } catch {}
}

export function clearAuthToken(): void {
  memoryToken = null;
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** 给 URL 补上 `_t`，让整页刷新（服务端渲染读不到 sessionStorage）也能识别当前 tab 的团队。 */
export function withAuthTokenQuery(url: string, token: string | null = getAuthToken()): string {
  if (!token) return url;
  const parsed = new URL(url, "http://localhost");
  parsed.searchParams.set(AUTH_TOKEN_QUERY, token);
  return parsed.pathname + parsed.search + parsed.hash;
}

let fetchInstalled = false;

/** 给所有同源请求（含 server action、RSC 导航）统一带上当前 tab 的 token。 */
export function installAuthFetch(): void {
  if (fetchInstalled || typeof window === "undefined") return;
  fetchInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getAuthToken();
    if (!token) return originalFetch(input, init);
    let requestUrl: string;
    if (typeof input === "string") requestUrl = input;
    else if (input instanceof URL) requestUrl = input.href;
    else requestUrl = input.url;
    let sameOrigin = false;
    try {
      sameOrigin = new URL(requestUrl, window.location.href).origin === window.location.origin;
    } catch {}
    if (!sameOrigin) return originalFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has(AUTH_TOKEN_HEADER)) headers.set(AUTH_TOKEN_HEADER, token);
    return originalFetch(input, { ...init, headers });
  };
}
