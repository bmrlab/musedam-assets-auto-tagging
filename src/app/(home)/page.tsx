"use client";
import { Button } from "@/components/ui/button";
import UserPanel from "@/components/UserPanel";
import { useLocaleClient } from "@/i18n/client";
import { ExtractServerActionData } from "@/lib/serverAction";
import { Moon, Sun } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchUserAndTeam } from "./actions";
import { Spin } from "@/components/ui/spin";

export default function Home() {
  const t = useTranslations("Homepage");
  const { data: session, status: sessionStatus } = useSession();
  const { theme, setTheme } = useTheme();
  const locale = useLocale();
  const { toggleLocale } = useLocaleClient();

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
  }, [session?.user, sessionStatus]);

  if (sessionStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Spin variant="dots" />
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
              <h1 className="text-2xl font-bold">{t("title")}</h1>
              {/*{session?.user && activeOrganization && (
                <p className="text-sm text-basic-5 mt-1">
                  当前组织: {activeOrganization.name}
                </p>
              )}*/}
            </div>
            <div className="flex items-center gap-4">
              <Button variant="outline" onClick={() => toggleLocale()} aria-label="切换语言">
                {locale === "zh-CN" ? "English" : "中文"}
              </Button>
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
              <p className="text-xl text-basic-5 mb-8">请先登录以访问系统功能</p>
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
