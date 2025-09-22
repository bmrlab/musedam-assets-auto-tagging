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
        "mt-[22px] ml-2 px-3 rounded-full",
        "flex shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12",
      )}
    >
      <h1 className="text-lg font-semibold">{activeTitle}</h1>
    </header>
  );
}
