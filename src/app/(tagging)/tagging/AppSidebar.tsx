"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

type TranslationFunction = (key: string) => string;

import {
  BrandIcon,
  DashboardIcon,
  IpIcon,
  MonitorIcon,
  PersonIcon,
  ProductIcon,
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useFeatureLibraryFeatures } from "@/hooks/use-feature-library";
import { FeatureType, isFeatureTypeEnabled } from "@/lib/feature-library";
import { cn } from "@/lib/utils";

type SidebarSection = "main" | "featureLibrary" | "configuration";

type MenuItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  section: SidebarSection;
  featureType?: FeatureType;
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
    featureType: "brand",
  },
  {
    title: t("Sidebar.product"),
    url: "/tagging/product",
    icon: ProductIcon,
    section: "featureLibrary",
    featureType: "product",
  },
  {
    title: t("Sidebar.person"),
    url: "/tagging/person",
    icon: PersonIcon,
    section: "featureLibrary",
    featureType: "person",
  },
  {
    title: t("Sidebar.ip"),
    url: "/tagging/ip",
    icon: IpIcon,
    section: "featureLibrary",
    featureType: "ip",
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

const sidebarLabelMotionClassName =
  "whitespace-nowrap opacity-100 translate-x-0 transition-[opacity,transform] duration-150 delay-200 group-data-[state=collapsed]:pointer-events-none group-data-[state=collapsed]:opacity-0 group-data-[state=collapsed]:-translate-x-1 group-data-[state=collapsed]:delay-0 group-data-[state=collapsed]:duration-75";

function renderMenuItems(items: MenuItem[], pathname: string, onNavigate: () => void) {
  return items.map((item) => (
    <SidebarMenuItem key={item.url}>
      <SidebarMenuButton
        className="px-4 h-10 group-data-[state=collapsed]:mx-auto"
        asChild
        isActive={pathname === item.url || pathname.startsWith(`${item.url}/`)}
        tooltip={item.title}
      >
        <Link href={item.url} onClick={onNavigate}>
          <item.icon className="size-4" />
          <span className={sidebarLabelMotionClassName}>{item.title}</span>
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
  const t = useTranslations("Tagging") as TranslationFunction;
  const { isMobile, setOpenMobile } = useSidebar();
  const featureLibraryFeatures = useFeatureLibraryFeatures();
  const menuItems = getMenuItems(t);
  const mainMenuItems = menuItems.filter((item) => item.section === "main");
  const featureLibraryMenuItems = featureLibraryFeatures.featureLibrary
    ? menuItems.filter(
        (item) =>
          item.section === "featureLibrary" &&
          item.featureType &&
          isFeatureTypeEnabled(featureLibraryFeatures, item.featureType),
      )
    : [];
  const configurationMenuItems = menuItems.filter((item) => item.section === "configuration");
  const handleNavigate = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);

  return (
    <Sidebar collapsible="icon" className={cn("bg-background", className)} {...props}>
      <SidebarHeader className="group-data-[state=collapsed]:px-0 group-data-[state=collapsed]:gap-0 mb-4 px-[18px] h-[48px] flex flex-row items-center justify-between group-data-[state=collapsed]:justify-center">
        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden leading-[32px] text-base font-semibold",
            sidebarLabelMotionClassName,
            "group-data-[state=collapsed]:w-0 group-data-[state=collapsed]:flex-none",
          )}
        >
          {t("App.title")}
        </div>
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarContent className="px-1.5">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu>{renderMenuItems(mainMenuItems, pathname, handleNavigate)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {featureLibraryMenuItems.length > 0 ? (
          <SidebarGroup className="p-0 pt-6">
            <SidebarGroupLabel className="h-[18px] overflow-hidden rounded-none px-4 py-0 text-[13px] leading-[18px] text-[#8f9bb3] font-normal">
              <span className={sidebarLabelMotionClassName}>{t("Sidebar.featureLibrary")}</span>
            </SidebarGroupLabel>
            <SidebarGroupContent className="pt-2">
              <SidebarMenu>
                {renderMenuItems(featureLibraryMenuItems, pathname, handleNavigate)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        <SidebarGroup className="p-0 pt-6">
          <SidebarGroupLabel className="h-[18px] overflow-hidden rounded-none px-4 py-0 text-[13px] leading-[18px] text-[#8f9bb3] font-normal">
            <span className={sidebarLabelMotionClassName}>{t("Sidebar.configuration")}</span>
          </SidebarGroupLabel>
          <SidebarGroupContent className="pt-2">
            <SidebarMenu>
              {renderMenuItems(configurationMenuItems, pathname, handleNavigate)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>{/* 可以在这里添加用户信息或其他底部内容 */}</SidebarFooter>
    </Sidebar>
  );
}
