"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

type TranslationFunction = ReturnType<typeof useTranslations>;

import {
  BrandIcon,
  DashboardIcon,
  IpIcon,
  MonitorIcon,
  SettingIcon,
  TagAIIcon,
  TeamIcon,
} from "@/components/ui";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type SidebarSection = "main" | "featureLibrary" | "configuration";

type MenuItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  section: SidebarSection;
};

const getMenuItems = (t: TranslationFunction): MenuItem[] => [
  {
    title: t("Sidebar.dashboard"),
    url: "/tagging/dashboard",
    icon: DashboardIcon,
    section: "main",
  },
  {
    title: t("Sidebar.review"),
    url: "/tagging/review",
    icon: TagAIIcon,
    section: "main",
  },
  {
    title: t("Sidebar.test"),
    url: "/tagging/test",
    icon: MonitorIcon,
    section: "main",
  },
  {
    title: t("Sidebar.brand"),
    url: "/tagging/brand",
    icon: BrandIcon,
    section: "featureLibrary",
  },
  {
    title: "IP 形象",
    url: "/tagging/ip",
    icon: IpIcon,
    section: "featureLibrary",
  },
  {
    title: t("Sidebar.settings"),
    url: "/tagging/settings",
    icon: SettingIcon,
    section: "configuration",
  },
  {
    title: t("Sidebar.access"),
    url: "/tagging/access",
    icon: TeamIcon,
    section: "configuration",
  },
];

function renderMenuItems(items: MenuItem[], pathname: string) {
  return items.map((item) => (
    <SidebarMenuItem key={item.url}>
      <SidebarMenuButton
        className="px-4 h-10"
        asChild
        isActive={pathname === item.url || pathname.startsWith(`${item.url}/`)}
        tooltip={item.title}
      >
        <Link href={item.url}>
          <item.icon className="size-4" />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  ));
}

export function getActiveMenuTitle(pathname: string, t: TranslationFunction): string {
  const menuItems = getMenuItems(t);
  const activeItem = menuItems.find(
    (item) => pathname === item.url || pathname.startsWith(`${item.url}/`),
  );
  return activeItem?.title || t("App.title");
}

export function AppSidebar({ className, ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const t = useTranslations("Tagging");
  const menuItems = getMenuItems(t);
  const mainMenuItems = menuItems.filter((item) => item.section === "main");
  const featureLibraryMenuItems = menuItems.filter((item) => item.section === "featureLibrary");
  const configurationMenuItems = menuItems.filter((item) => item.section === "configuration");

  return (
    <Sidebar collapsible="icon" className={cn("bg-background", className)} {...props}>
      <SidebarHeader className="group-data-[state=collapsed]:px-0 mb-4 px-[18px] h-[48px] flex flex-row items-center justify-between group-data-[state=collapsed]:justify-center">
        <div className="group-data-[state=collapsed]:hidden leading-[32px] text-base font-semibold">
          {t("App.title")}
        </div>
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarContent className="px-1.5">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu>{renderMenuItems(mainMenuItems, pathname)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="p-0 pt-6">
          <SidebarGroupLabel
            asChild
            className="h-[18px] rounded-none px-4 py-0 text-[13px] leading-[18px] text-[#8f9bb3] font-normal"
          >
            <span>{t("Sidebar.featureLibrary")}</span>
          </SidebarGroupLabel>
          <SidebarGroupContent className="pt-2">
            <SidebarMenu>{renderMenuItems(featureLibraryMenuItems, pathname)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="p-0 pt-6">
          <SidebarGroupLabel
            asChild
            className="h-[18px] rounded-none px-4 py-0 text-[13px] leading-[18px] text-[#8f9bb3] font-normal"
          >
            <span>{t("Sidebar.configuration")}</span>
          </SidebarGroupLabel>
          <SidebarGroupContent className="pt-2">
            <SidebarMenu>{renderMenuItems(configurationMenuItems, pathname)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>{/* 可以在这里添加用户信息或其他底部内容 */}</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
