"use client";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { getActiveMenuTitle } from "./AppSidebar";

export function LayoutHeader() {
  const pathname = usePathname();
  const t = useTranslations("Tagging");
  const activeTitle = getActiveMenuTitle(pathname, t);
  return (
    <header
      className={cn(
        "z-1 mt-2 ml-2 px-3 py-1 rounded-full",
        "flex shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12",
        "backdrop-blur-sm bg-zinc-50 dark:bg-zinc-900",
        "supports-[backdrop-filter]:bg-background/60",
      )}
    >
      <h1 className="text-lg font-semibold">{activeTitle}</h1>
    </header>
  );
}
