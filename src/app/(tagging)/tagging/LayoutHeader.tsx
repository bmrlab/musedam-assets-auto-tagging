"use client";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { getActiveMenuTitle } from "./AppSidebar";

export function LayoutHeader() {
  const pathname = usePathname();
  const t = useTranslations("Tagging") as (key: string) => string;

  const hidesPageTitle =
    pathname.startsWith("/tagging/brand") ||
    pathname.startsWith("/tagging/ip") ||
    pathname.startsWith("/tagging/person") ||
    pathname.startsWith("/tagging/product");

  const activeTitle = getActiveMenuTitle(pathname, t);

  return (
    <header
      className={cn(
        "mt-[22px] ml-2 px-3 rounded-full",
        "flex shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12",
        hidesPageTitle && "md:hidden",
      )}
    >
      <SidebarTrigger className="md:hidden" />
      {!hidesPageTitle && <h1 className="text-xl font-semibold">{activeTitle}</h1>}
    </header>
  );
}
