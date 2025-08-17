"use client";
import { Button } from "@/components/ui/button";
import UserPanel from "@/components/UserPanel";
import { ExtractServerActionData } from "@/lib/serverAction";
import { Moon, Sun } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchUserAndTeam } from "./actions";

export default function Home() {
  const { data: session, status: sessionStatus } = useSession();
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState<ExtractServerActionData<typeof fetchUserAndTeam>["user"] | null>(
    null,
  );
  const [team, setTeam] = useState<ExtractServerActionData<typeof fetchUserAndTeam>["team"] | null>(
    null,
  );

  useEffect(() => {
    if (session?.user) {
      fetchUserAndTeam().then((result) => {
        if (result.success) {
          const { user, team } = result.data;
          setUser(user);
          setTeam(team);
        }
      });
    }
  }, [sessionStatus]);

  if (sessionStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">正在加载...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-2xl font-bold">MuseDAM 资产自动标记系统</h1>
              {/*{session?.user && activeOrganization && (
                <p className="text-sm text-muted-foreground mt-1">
                  当前组织: {activeOrganization.name}
                </p>
              )}*/}
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label="切换主题"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <UserPanel />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {user && team ? (
            <div>
              <div>
                user: {user.name} ({user.slug})
              </div>
              <div>
                team: {team.name} ({team.slug})
              </div>
            </div>
          ) : (
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-4">欢迎使用 MuseDAM 资产自动标记系统</h2>
              <p className="text-xl text-muted-foreground mb-8">请先登录以访问系统功能</p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild size="lg">
                  <Link href="/auth/signin">立即登录</Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/auth/signup">注册账户</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
