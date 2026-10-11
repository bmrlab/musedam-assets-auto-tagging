"use client";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useEffect } from "react";
import { AppSidebar } from "./AppSidebar";
import { LayoutHeader } from "./LayoutHeader";

export default function TaggingLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.body.classList.add("tagging-layout-active");
    return () => {
      document.body.classList.remove("tagging-layout-active");
    };
  }, []);

  return (
    <SidebarProvider className="h-dvh">
      <AppSidebar />
      <SidebarInset className="h-full relative overflow-y-scroll scrollbar-thin ">
        <LayoutHeader />
        {/* 页面根节点带 data-fill-viewport 时（有分页的列表页），main 不按内容撑高，页面恰好占满可视高度、
            只有列表区域自己滚动；其他页面仍按内容撑高、由外层整体滚动 */}
        <main className="pt-[22px] pb-5 px-5 flex flex-1 flex-col gap-4 bg-basic-1 has-[>[data-fill-viewport]]:min-h-0">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
