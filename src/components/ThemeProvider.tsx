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
  return (
    <NextThemesProvider forcedTheme={forcedTheme} {...props}>
      {children}
    </NextThemesProvider>
  );
}
