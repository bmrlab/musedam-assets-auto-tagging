"use client";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useSearchParams } from "next/navigation";
import * as React from "react";

// 内部组件用于监听主题变化事件
function ThemeEventListener() {
  const { setTheme } = useTheme();

  React.useEffect(() => {
    const handleThemeChange = (event: CustomEvent) => {
      const { theme } = event.detail;
      if (theme === "light" || theme === "dark") {
        setTheme(theme);
      }
    };

    // 监听自定义的 theme-change 事件
    window.addEventListener("theme-change", handleThemeChange as EventListener);

    return () => {
      window.removeEventListener("theme-change", handleThemeChange as EventListener);
    };
  }, [setTheme]);

  return null;
}

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
      <ThemeEventListener />
      {children}
    </NextThemesProvider>
  );
}
