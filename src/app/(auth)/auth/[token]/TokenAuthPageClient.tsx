"use client";
import { PageLoadingFallback } from "@/components/PageLoadingFallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocaleClient } from "@/i18n/client";
import { useAuthActions } from "@/components/AuthProvider";
import { signIn } from "next-auth/react";
import { clearAuthToken, withAuthTokenQuery } from "@/lib/auth-token";
import { Locale } from "next-intl";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function TokenAuthPageClient({
  token,
  callbackUrl,
  theme,
  locale,
}: {
  token: string;
  callbackUrl: string;
  theme?: "light" | "dark";
  locale?: string;
}) {
  const { setTheme } = useTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { setLocale } = useLocaleClient();
  const { refresh } = useAuthActions();

  useEffect(() => {
    setLoading(true);
    // 登录态只属于当前 tab：token 存进本 tab 的 sessionStorage，不再写共享 cookie，
    // 所以另一个 tab 切换到别的团队不会影响这里。
    refresh(token)
      .then(async (result) => {
        if (result.status === "authenticated") {
          // 兼容期：同时种旧的共享 cookie，没带 token 的旧版父项目（可见页直接打开 callbackUrl）才能继续用。
          // 失败不影响新版的按 tab token 登录。TODO: 旧版父项目下线后删除
          await signIn("token-login", { token, redirect: false }).catch(() => undefined);
          router.replace(withAuthTokenQuery(callbackUrl, token));
        } else {
          clearAuthToken();
          setError(result.error ?? "INVALID_TOKEN");
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token, callbackUrl, router, refresh]);

  useEffect(() => {
    if (theme) {
      setTheme(theme);
    }
  }, [theme, setTheme]);

  useEffect(() => {
    if (locale) {
      setLocale(locale as Locale);
    }
  }, [locale, setLocale]);

  if (loading) {
    return (
      <div className="h-dvh w-dvw flex flex-col items-stretch justify-start">
        <PageLoadingFallback />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/">Go to Home</Link>
          </CardContent>
        </Card>
      </div>
    );
  }
}
