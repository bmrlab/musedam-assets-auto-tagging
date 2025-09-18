"use client";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { LayoutHeader } from "./LayoutHeader";

export default function TaggingLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider className="h-dvh">
      <AppSidebar />
      <SidebarInset className="h-full relative overflow-y-scroll scrollbar-thin ">
        <LayoutHeader />
        <main className="pt-[22px] pb-5 px-5 flex flex-1 flex-col gap-4 bg-muted/30">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
