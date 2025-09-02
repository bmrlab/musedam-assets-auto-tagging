"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

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
import {
  BarChart3Icon,
  BugPlayIcon,
  CheckSquareIcon,
  SettingsIcon,
  ShieldIcon,
} from "lucide-react";

const menuItems = [
  {
    title: "控制面板",
    url: "/tagging/dashboard",
    icon: BarChart3Icon,
  },
  {
    title: "AI打标审核",
    url: "/tagging/review",
    icon: CheckSquareIcon,
  },
  {
    title: "AI打标设置",
    url: "/tagging/settings",
    icon: SettingsIcon,
  },
  {
    title: "权限管理",
    url: "/tagging/access",
    icon: ShieldIcon,
  },
  {
    title: "测试打标",
    url: "/tagging/test",
    icon: BugPlayIcon,
  },
];

export function getActiveMenuTitle(pathname: string): string {
  const activeItem = menuItems.find((item) => pathname === item.url);
  return activeItem?.title || "AI 自动打标引擎";
}

export function AppSidebar({ className, ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" className={cn("p-2 bg-background", className)} {...props}>
      <SidebarHeader className="group-data-[state=collapsed]:px-0 mb-2 flex flex-row items-center justify-between group-data-[state=collapsed]:justify-center">
        <div className="group-data-[state=collapsed]:hidden font-medium px-1">AI 自动打标引擎</div>
        <SidebarTrigger className="hover:bg-transparent dark:hover:bg-transparent" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {menuItems.map((item) => (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                className="px-3 h-9"
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
