"use client";
import { PageLoadingFallback } from "@/components/PageLoadingFallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocaleClient } from "@/i18n/client";
import { signIn } from "next-auth/react";
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

  useEffect(() => {
    setLoading(true);
    signIn("token-login", {
      token,
      callbackUrl,
      redirect: false,
    })
      .then((result) => {
        if (result?.error) {
          setError(result.error);
        } else {
          router.replace(callbackUrl);
        }
        setLoading(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token, callbackUrl, router]);

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
