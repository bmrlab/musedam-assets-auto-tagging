"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

type TranslationFunction = ReturnType<typeof useTranslations>;

import { DashboardIcon, MonitorIcon, SettingIcon, TagAIIcon, TeamIcon } from "@/components/ui";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const getMenuItems = (t: TranslationFunction) => [
  {
    title: t("Sidebar.dashboard"),
    url: "/tagging/dashboard",
    icon: DashboardIcon,
  },
  {
    title: t("Sidebar.review"),
    url: "/tagging/review",
    icon: TagAIIcon,
  },
  {
    title: t("Sidebar.test"),
    url: "/tagging/test",
    icon: MonitorIcon,
  },
  {
    title: t("Sidebar.settings"),
    url: "/tagging/settings",
    icon: SettingIcon,
  },
  {
    title: t("Sidebar.access"),
    url: "/tagging/access",
    icon: TeamIcon,
  },
];

export function getActiveMenuTitle(pathname: string, t: TranslationFunction): string {
  const menuItems = getMenuItems(t);
  const activeItem = menuItems.find((item) => pathname === item.url);
  return activeItem?.title || t("App.title");
}

export function AppSidebar({ className, ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const t = useTranslations("Tagging");
  const menuItems = getMenuItems(t);

  return (
    <Sidebar collapsible="icon" className={cn("px-1.5 bg-background", className)} {...props}>
      <SidebarHeader className="group-data-[state=collapsed]:px-0 mb-2 flex flex-row items-center justify-between group-data-[state=collapsed]:justify-center">
        <div className="group-data-[state=collapsed]:hidden font-medium">{t("App.title")}</div>
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {menuItems.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                className="px-[14px] h-10"
                asChild
                isActive={pathname === item.url}
                tooltip={item.title}
              >
                <Link href={item.url}>
                  <item.icon className="size-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>{/* 可以在这里添加用户信息或其他底部内容 */}</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
