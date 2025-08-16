"use client";

import { signOut, useSession } from "@/app/(auth)/client";
import { createMuseDAMLoginLink } from "@/app/admin/actions/federation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Building,
  ChevronRight,
  Copy,
  ExternalLink,
  Home,
  Link,
  Loader2,
  LogOut,
  TestTube,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function FederationTestPageClient() {
  const [formData, setFormData] = useState({
    museDAMUserId: "",
    museDAMOrgId: "",
    userInfo: {
      name: "",
      email: "",
      role: "user",
      organizationRole: "member",
    },
    orgInfo: {
      name: "",
      logo: "",
    },
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    data?: any;
    error?: string;
  } | null>(null);

  const { data: session } = useSession();
  const router = useRouter();

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
    section?: string,
  ) => {
    const { name, value } = e.target;

    if (section === "userInfo") {
      setFormData((prev) => ({
        ...prev,
        userInfo: {
          ...prev.userInfo,
          [name]: value,
        },
      }));
    } else if (section === "orgInfo") {
      setFormData((prev) => ({
        ...prev,
        orgInfo: {
          ...prev.orgInfo,
          [name]: value,
        },
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const generateTestData = () => {
    const timestamp = Date.now();
    setFormData({
      museDAMUserId: `musedam-user-${timestamp}`,
      museDAMOrgId: `musedam-org-${timestamp}`,
      userInfo: {
        name: `MuseDAM用户-${timestamp}`,
        email: `musedam-${timestamp}@example.com`,
        role: "user",
        organizationRole: "member",
      },
      orgInfo: {
        name: `MuseDAM组织-${timestamp}`,
        logo: "https://via.placeholder.com/64/4f46e5/ffffff?text=MD",
      },
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const response = await createMuseDAMLoginLink({
        museDAMUserId: formData.museDAMUserId,
        museDAMOrgId: formData.museDAMOrgId,
        userInfo: formData.userInfo,
        orgInfo: formData.orgInfo,
      });

      setResult(response);
    } catch (error) {
      setResult({
        success: false,
        error: "网络错误",
      });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (!session?.user || session.user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">访问被拒绝</CardTitle>
            <CardDescription>您没有权限访问管理员面板</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push("/")} className="w-full">
              返回首页
            </Button>
          </CardContent>
        </Card>
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
              {/* Breadcrumb */}
              <nav className="flex mb-2" aria-label="Breadcrumb">
                <ol className="flex items-center space-x-2">
                  <li>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push("/")}
                      className="text-muted-foreground hover:text-foreground p-0 h-auto"
                    >
                      <Home className="h-4 w-4 mr-1" />
                      首页
                    </Button>
                  </li>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <li>
                    <span className="text-muted-foreground">管理员</span>
                  </li>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <li>
                    <span className="font-medium">MuseDAM联合登录测试</span>
                  </li>
                </ol>
              </nav>
              <h1 className="text-2xl font-bold">MuseDAM联合登录测试</h1>
              <p className="text-sm text-muted-foreground">测试与MuseDAM系统的联合登录功能</p>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="outline" onClick={() => router.push("/admin/users")}>
                <Users className="h-4 w-4 mr-2" />
                用户管理
              </Button>
              <Button variant="outline" onClick={() => router.push("/admin/organizations")}>
                <Building className="h-4 w-4 mr-2" />
                组织管理
              </Button>
              <Button variant="destructive" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                退出登录
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 测试表单 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TestTube className="h-5 w-5" />
                MuseDAM联合登录测试
              </CardTitle>
              <CardDescription>输入MuseDAM用户和组织信息，生成登录链接</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* 基本信息 */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">基本信息</h3>
                  <div className="space-y-2">
                    <Label htmlFor="museDAMUserId">MuseDAM用户ID *</Label>
                    <Input
                      id="museDAMUserId"
                      name="museDAMUserId"
                      value={formData.museDAMUserId}
                      onChange={handleInputChange}
                      placeholder="musedam-user-123"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="museDAMOrgId">MuseDAM组织ID *</Label>
                    <Input
                      id="museDAMOrgId"
                      name="museDAMOrgId"
                      value={formData.museDAMOrgId}
                      onChange={handleInputChange}
                      placeholder="musedam-org-456"
                      required
                    />
                  </div>
                </div>

                {/* 用户信息 */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">用户信息（可选）</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="user-name">姓名</Label>
                      <Input
                        id="user-name"
                        name="name"
                        value={formData.userInfo.name}
                        onChange={(e) => handleInputChange(e, "userInfo")}
                        placeholder="张三"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="user-email">邮箱</Label>
                      <Input
                        id="user-email"
                        name="email"
                        type="email"
                        value={formData.userInfo.email}
                        onChange={(e) => handleInputChange(e, "userInfo")}
                        placeholder="zhangsan@example.com"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="user-role">系统角色</Label>
                      <select
                        id="user-role"
                        name="role"
                        value={formData.userInfo.role}
                        onChange={(e) => handleInputChange(e, "userInfo")}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="user">普通用户</option>
                        <option value="admin">管理员</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="org-role">组织角色</Label>
                      <select
                        id="org-role"
                        name="organizationRole"
                        value={formData.userInfo.organizationRole}
                        onChange={(e) => handleInputChange(e, "userInfo")}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="member">成员</option>
                        <option value="admin">管理员</option>
                        <option value="owner">所有者</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 组织信息 */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium">组织信息（可选）</h3>
                  <div className="space-y-2">
                    <Label htmlFor="org-name">组织名称</Label>
                    <Input
                      id="org-name"
                      name="name"
                      value={formData.orgInfo.name}
                      onChange={(e) => handleInputChange(e, "orgInfo")}
                      placeholder="MuseDAM测试公司"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="org-logo">Logo URL</Label>
                    <Input
                      id="org-logo"
                      name="logo"
                      type="url"
                      value={formData.orgInfo.logo}
                      onChange={(e) => handleInputChange(e, "orgInfo")}
                      placeholder="https://example.com/logo.png"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={generateTestData}
                    className="flex-1"
                  >
                    生成测试数据
                  </Button>
                  <Button type="submit" disabled={loading} className="flex-1">
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        生成中...
                      </>
                    ) : (
                      <>
                        <Link className="mr-2 h-4 w-4" />
                        生成登录链接
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* 结果显示 */}
          <Card>
            <CardHeader>
              <CardTitle>测试结果</CardTitle>
              <CardDescription>生成的登录链接和相关信息</CardDescription>
            </CardHeader>
            <CardContent>
              {!result ? (
                <div className="text-center py-8 text-muted-foreground">
                  填写左侧表单并点击"生成登录链接"开始测试
                </div>
              ) : result.success ? (
                <div className="space-y-4">
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <h4 className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
                      ✅ 登录链接生成成功
                    </h4>
                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs text-green-700 dark:text-green-300">
                          登录链接
                        </Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            readOnly
                            value={result.data.loginUrl}
                            className="text-xs bg-white dark:bg-gray-900"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyToClipboard(result.data.loginUrl)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.open(result.data.loginUrl, "_blank")}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs text-green-700 dark:text-green-300">
                          过期时间
                        </Label>
                        <div className="text-xs font-mono bg-white dark:bg-gray-900 p-2 rounded border mt-1">
                          {new Date(result.data.expiresAt).toLocaleString("zh-CN")}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">使用说明：</h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>• 登录链接有效期为10分钟</li>
                      <li>• 点击链接将自动创建会话并登录</li>
                      <li>• 如果用户或组织不存在，系统会自动创建</li>
                      <li>• 用户会自动加入指定组织</li>
                      <li>• 登录链接为加密的JSON字符串，无需数据库存储</li>
                    </ul>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <h4 className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">
                    ❌ 生成失败
                  </h4>
                  <p className="text-sm text-red-700 dark:text-red-300">{result.error}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
