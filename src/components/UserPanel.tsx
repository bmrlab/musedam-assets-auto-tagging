"use client";

import { authClient, signOut, useSession } from "@/app/(auth)/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Building, Check, ChevronDown, LogOut, Settings, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UserPanel() {
  const [showOrgSelector, setShowOrgSelector] = useState(false);
  const { data: session } = useSession();
  const { data: organizations } = authClient.useListOrganizations();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const router = useRouter();

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  const handleProfileClick = () => {
    // TODO: 实现用户资料页面
    console.log("Navigate to profile");
  };

  const handleAdminClick = () => {
    router.push("/admin");
  };

  const handleSetActiveOrganization = async (organizationId: string | null) => {
    try {
      await authClient.organization.setActive({
        organizationId,
      });
      setShowOrgSelector(false);
    } catch (error) {
      console.error("设置活跃组织失败:", error);
    }
  };

  if (!session?.user) {
    return (
      <div className="flex items-center space-x-4">
        <Button onClick={() => router.push("/login")} variant="default">
          登录
        </Button>
        <Button onClick={() => router.push("/register")} variant="outline">
          注册
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-4">
      {/* 组织切换器 */}
      {session?.user && organizations && organizations.length > 0 && (
        <DropdownMenu open={showOrgSelector} onOpenChange={setShowOrgSelector}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2">
              <Building className="h-4 w-4" />
              <span>{activeOrganization ? activeOrganization.name : "个人模式"}</span>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <DropdownMenuLabel>选择组织</DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => handleSetActiveOrganization(null)}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="h-6 w-6 rounded bg-muted flex items-center justify-center">
                  <User className="h-3 w-3" />
                </div>
                <div>
                  <p className="text-sm font-medium">个人模式</p>
                  <p className="text-xs text-muted-foreground">不属于任何组织</p>
                </div>
              </div>
              {!activeOrganization && <Check className="h-4 w-4" />}
            </DropdownMenuItem>

            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                onClick={() => handleSetActiveOrganization(org.id)}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center">
                    {org.logo ? (
                      <img src={org.logo} alt={org.name} className="h-6 w-6 rounded" />
                    ) : (
                      <span className="text-xs font-medium text-primary">
                        {org.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{org.name}</p>
                    <p className="text-xs text-muted-foreground">@{org.slug}</p>
                  </div>
                </div>
                {activeOrganization?.id === org.id && <Check className="h-4 w-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* 用户下拉菜单 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-8 w-8 rounded-full">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
              <span className="text-sm font-medium text-primary-foreground">
                {session.user.name?.charAt(0).toUpperCase() || "U"}
              </span>
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end" forceMount>
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col space-y-1">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
                  <span className="text-sm font-medium text-primary-foreground">
                    {session.user.name?.charAt(0).toUpperCase() || "U"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <p className="text-sm font-medium leading-none">{session.user.name}</p>
                  <p className="text-xs leading-none text-muted-foreground mt-1">
                    {session.user.email}
                  </p>
                  {session.user.role && (
                    <div className="mt-1">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          session.user.role === "admin"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
                        }`}
                      >
                        {session.user.role === "admin" ? "管理员" : "用户"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleProfileClick}>
            <User className="mr-2 h-4 w-4" />
            <span>个人资料</span>
          </DropdownMenuItem>
          {session.user.role === "admin" && (
            <DropdownMenuItem onClick={handleAdminClick}>
              <Settings className="mr-2 h-4 w-4" />
              <span>管理员面板</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>退出登录</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
