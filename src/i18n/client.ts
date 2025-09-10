"use client";
import Cookies from "js-cookie";
import { Locale, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export function useLocaleClient() {
  const locale = useLocale();
  const router = useRouter();

  const toggleLocale = useCallback(() => {
    const newLocale = locale === "zh-CN" ? "en-US" : "zh-CN";
    // Save to cookie
    Cookies.set("locale", newLocale, { expires: 365 });
    // Refresh the page to apply changes
    router.refresh();
  }, [locale, router]);

  const setLocale = useCallback(
    (locale: Locale) => {
      // Save to cookie
      Cookies.set("locale", locale, { expires: 365 });
      // Refresh the page to apply changes
      router.refresh();
    },
    [router],
  );

  return { toggleLocale, setLocale };
}
