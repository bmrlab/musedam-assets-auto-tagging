"use client";

import {
  AUTH_TOKEN_QUERY,
  clearAuthToken,
  getAuthToken,
  installAuthFetch,
  setAuthToken,
  withAuthTokenQuery,
} from "@/lib/auth-token";
import type { Session } from "next-auth";
import { usePathname } from "next/navigation";
import * as React from "react";

type AuthState = {
  data: Session | null;
  status: "loading" | "authenticated" | "unauthenticated";
  /** token 失效的原因（过期/无效/无权限），用于在登录页展示 */
  error?: string;
};

type AuthContextValue = AuthState & {
  /** 用新 token 重新拉取登录信息（登录页、父项目换发 token 后调用） */
  refresh: (token?: string) => Promise<AuthState>;
  signOut: () => void;
};

// 要在任何组件发请求之前就装好，所以放在模块加载阶段
installAuthFetch();

const AuthContext = React.createContext<AuthContextValue | null>(null);

// 过期前多久通知父项目换发新 token
const REFRESH_LEAD_MS = 10 * 60 * 1000;

async function loadSession(): Promise<AuthState & { tokenExpiresAt?: number }> {
  // 没有 token 也要问一次服务端：兼容期内旧版父项目靠共享 cookie 登录
  try {
    const response = await fetch("/api/auth/me", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.success) {
      return { data: body.session, status: "authenticated", tokenExpiresAt: body.tokenExpiresAt };
    }
    return { data: null, status: "unauthenticated", error: body?.code ?? "INVALID_TOKEN" };
  } catch {
    return { data: null, status: "unauthenticated", error: "NETWORK_ERROR" };
  }
}

function notifyParentTokenExpiring() {
  if (typeof window === "undefined" || window.parent === window) return;
  window.parent.postMessage(
    {
      source: "musedam-app",
      target: "musedam",
      type: "event",
      event: "auth-token-expiring",
      timestamp: new Date().toISOString(),
    },
    "*",
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({ data: null, status: "loading" });
  const pathname = usePathname();

  const refresh = React.useCallback(async (token?: string) => {
    if (token) setAuthToken(token);
    const next = await loadSession();
    setState(next);
    return next;
  }, []);

  React.useEffect(() => {
    let timer: number | undefined;
    void loadSession().then((next) => {
      setState(next);
      if (next.tokenExpiresAt) {
        const delay = Math.max(next.tokenExpiresAt - Date.now() - REFRESH_LEAD_MS, 0);
        // setTimeout 上限约 24.8 天，token 有效期远小于它
        timer = window.setTimeout(notifyParentTokenExpiring, delay);
      }
    });
    return () => window.clearTimeout(timer);
  }, []);

  // 整页刷新时服务端读不到 sessionStorage，URL 上始终保留 ?_t=<token>；
  // 客户端导航会丢掉查询参数，所以路径变化后补回去（只改地址栏，不触发导航）。
  React.useEffect(() => {
    const token = getAuthToken();
    if (!token) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(AUTH_TOKEN_QUERY) === token) return;
    window.history.replaceState(
      window.history.state,
      "",
      withAuthTokenQuery(url.pathname + url.search + url.hash, token),
    );
  }, [pathname]);

  // 父项目换发新 token 后通过 postMessage 下发
  React.useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (
        message?.source === "musedam" &&
        message?.target === "musedam-app" &&
        message?.type === "action" &&
        message?.action === "updateAuthToken" &&
        typeof message?.args?.token === "string"
      ) {
        void refresh(message.args.token);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [refresh]);

  const signOut = React.useCallback(() => {
    clearAuthToken();
    setState({ data: null, status: "unauthenticated" });
  }, []);

  const value = React.useMemo(() => ({ ...state, refresh, signOut }), [state, refresh, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuthContext() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error("useSession must be used within AuthProvider");
  return context;
}

/** 与 next-auth 的 useSession 形状一致：{ data, status }。 */
export function useSession() {
  const { data, status, error } = useAuthContext();
  return { data, status, error };
}

export function useAuthActions() {
  const { refresh, signOut } = useAuthContext();
  return { refresh, signOut };
}
