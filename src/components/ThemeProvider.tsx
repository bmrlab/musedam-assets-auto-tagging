"use client";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useSearchParams } from "next/navigation";
import * as React from "react";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  const searchParams = useSearchParams();
  let forcedTheme = searchParams.get("theme") ?? undefined;
  if (forcedTheme !== "dark" && forcedTheme !== "light") {
    forcedTheme = undefined;
  }
  if (
    forcedTheme &&
    typeof window !== "undefined" &&
    window.localStorage.getItem("theme") !== forcedTheme
  ) {
    window.localStorage.setItem("theme", forcedTheme);
  }
  return (
    <NextThemesProvider {...props} storageKey="theme" forcedTheme={forcedTheme}>
      {children}
    </NextThemesProvider>
  );
}
