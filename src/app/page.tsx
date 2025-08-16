"use client";

import { authClient, useSession } from "@/app/(auth)/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, Moon, Sun, Tags, Upload } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import UserPanel from "../components/UserPanel";

export default function Home() {
  const { data: session, isPending } = useSession();
  const { data: activeOrganization } = authClient.useActiveOrganization();
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  if (isPending) {
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
              {session?.user && activeOrganization && (
                <p className="text-sm text-muted-foreground mt-1">
                  当前组织: {activeOrganization.name}
                </p>
              )}
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
          {session?.user ? (
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-4">欢迎使用 MuseDAM 资产自动标记系统</h2>
              <p className="text-xl text-muted-foreground mb-4">
                这里是主要功能区域，您可以进行资产管理和自动标记操作。
              </p>

              {/* 当前组织状态 */}
              <div className="mb-8">
                {activeOrganization ? (
                  <Card className="max-w-md mx-auto">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-center">
                        {activeOrganization.logo && (
                          <img
                            src={activeOrganization.logo}
                            alt={activeOrganization.name}
                            className="h-8 w-8 rounded-full mr-3"
                          />
                        )}
                        <div>
                          <p className="text-sm font-medium text-primary">当前工作在组织</p>
                          <p className="text-lg font-bold">{activeOrganization.name}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="max-w-md mx-auto">
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">
                        您当前处于个人模式，可以通过右上角的组织切换器选择工作组织
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* 管理员入口 */}
              {session.user.role === "admin" && (
                <Card className="max-w-md mx-auto mb-8">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm font-medium mb-2">管理员功能</p>
                      <Button asChild>
                        <Link href="/admin">进入管理面板</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Upload className="h-5 w-5" />
                      资产上传
                    </CardTitle>
                    <CardDescription>上传您的数字资产进行自动标记和分类</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full">开始上传</Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Tags className="h-5 w-5" />
                      标记管理
                    </CardTitle>
                    <CardDescription>查看和管理已标记的资产</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="secondary" className="w-full">
                      查看标记
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="h-5 w-5" />
                      AI 分析
                    </CardTitle>
                    <CardDescription>使用 AI 技术进行智能分析和标记</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" className="w-full">
                      AI 分析
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <h2 className="text-3xl font-bold mb-4">欢迎使用 MuseDAM 资产自动标记系统</h2>
              <p className="text-xl text-muted-foreground mb-8">请先登录以访问系统功能</p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild size="lg">
                  <Link href="/login">立即登录</Link>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <Link href="/register">注册账户</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
