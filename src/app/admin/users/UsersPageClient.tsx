"use client";
import { authClient, signOut, useSession } from "@/app/(auth)/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Building,
  ChevronRight,
  Home,
  Loader2,
  LogOut,
  Search,
  TestTube,
  UserPlus,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CreateUserModal from "./CreateUserModal";

interface User {
  id: string;
  email: string;
  name: string;
  role?: string;
  createdAt: Date | string;
  banned?: boolean | null;
  banReason?: string | null;
  emailVerified?: boolean;
  updatedAt?: Date;
  image?: string | null;
  banExpires?: Date | null;
}

export function UsersPageClient() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);

  const { data: session } = useSession();
  const router = useRouter();

  // 加载用户列表
  const loadUsers = async () => {
    try {
      setLoading(true);
      const result = await authClient.admin.listUsers({
        query: {
          limit: 100,
          searchValue: searchTerm,
          searchField: "email",
        },
      });

      if (result.error) {
        setError(result.error.message || "加载用户失败");
      } else {
        const users = result.data?.users || [];
        setUsers(
          users.map((user) => ({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            createdAt:
              typeof user.createdAt === "string" ? user.createdAt : user.createdAt.toISOString(),
            banned: user.banned || false,
            banReason: user.banReason,
            emailVerified: user.emailVerified,
            updatedAt: user.updatedAt,
            image: user.image,
            banExpires: user.banExpires,
          })),
        );
      }
    } catch (err) {
      setError("加载用户时发生错误");
      console.error("Load users error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.user?.role === "admin") {
      loadUsers();
    }
  }, [session, searchTerm]);

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  const handleSetRole = async (userId: string, role: string) => {
    try {
      const result = await authClient.admin.setRole({
        userId,
        role: role as "user" | "admin",
      });

      if (result.error) {
        setError(result.error.message || "设置角色失败");
      } else {
        await loadUsers();
        setSelectedUser(null);
      }
    } catch (err) {
      setError("设置角色时发生错误");
      console.error("Set role error:", err);
    }
  };

  const handleBanUser = async (userId: string, reason: string) => {
    try {
      const result = await authClient.admin.banUser({
        userId,
        banReason: reason,
        banExpiresIn: 60 * 60 * 24 * 30, // 30 days
      });

      if (result.error) {
        setError(result.error.message || "封禁用户失败");
      } else {
        await loadUsers();
        setSelectedUser(null);
      }
    } catch (err) {
      setError("封禁用户时发生错误");
      console.error("Ban user error:", err);
    }
  };

  const handleUnbanUser = async (userId: string) => {
    try {
      const result = await authClient.admin.unbanUser({
        userId,
      });

      if (result.error) {
        setError(result.error.message || "解封用户失败");
      } else {
        await loadUsers();
        setSelectedUser(null);
      }
    } catch (err) {
      setError("解封用户时发生错误");
      console.error("Unban user error:", err);
    }
  };

  if (!session?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin mx-auto" />
          <p className="mt-4 text-muted-foreground">正在加载...</p>
        </div>
      </div>
    );
  }

  if (session.user.role !== "admin") {
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
                    <span className="font-medium">用户管理</span>
                  </li>
                </ol>
              </nav>
              <h1 className="text-2xl font-bold">用户管理</h1>
              <p className="text-sm text-muted-foreground">管理系统用户和权限</p>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="outline" onClick={() => router.push("/admin/organizations")}>
                <Building className="h-4 w-4 mr-2" />
                组织管理
              </Button>
              <Button variant="outline" onClick={() => router.push("/admin/federation")}>
                <TestTube className="h-4 w-4 mr-2" />
                MuseDAM联合登录
              </Button>
              <Button variant="destructive" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                退出登录
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {error && (
          <Card className="mb-4 border-destructive">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <p className="text-destructive">{error}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setError("")}
                  className="text-destructive hover:text-destructive"
                >
                  ×
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Search and Actions */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex-1 max-w-md relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="搜索用户邮箱..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button onClick={() => setShowCreateUser(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                创建用户
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Modals */}
        <CreateUserModal
          isOpen={showCreateUser}
          onClose={() => setShowCreateUser(false)}
          onUserCreated={loadUsers}
        />

        {/* Users Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              用户列表
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center p-6">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p className="ml-2 text-muted-foreground">加载中...</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead>
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        用户
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        角色
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        状态
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        创建时间
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map((user) => (
                      <tr key={user.id} className="hover:bg-muted/50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium">{user.name}</div>
                            <div className="text-sm text-muted-foreground">{user.email}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              user.role === "admin"
                                ? "bg-destructive/10 text-destructive"
                                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
                            }`}
                          >
                            {user.role || "user"}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              user.banned
                                ? "bg-destructive/10 text-destructive"
                                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
                            }`}
                          >
                            {user.banned ? "已封禁" : "正常"}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                          {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <Button variant="ghost" size="sm" onClick={() => setSelectedUser(user)}>
                            管理
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {users.length === 0 && (
                  <div className="p-6 text-center text-muted-foreground">没有找到用户</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* User Management Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>管理用户: {selectedUser?.name}</DialogTitle>
            <DialogDescription>修改用户角色和状态设置</DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-3">设置角色</h4>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetRole(selectedUser.id, "user")}
                  >
                    普通用户
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetRole(selectedUser.id, "admin")}
                  >
                    管理员
                  </Button>
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="text-sm font-medium mb-3">用户状态</h4>
                {selectedUser.banned ? (
                  <div>
                    <p className="text-sm text-destructive mb-2">
                      封禁原因: {selectedUser.banReason || "无"}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleUnbanUser(selectedUser.id)}
                    >
                      解除封禁
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleBanUser(selectedUser.id, "管理员封禁")}
                  >
                    封禁用户
                  </Button>
                )}
              </div>

              <Separator />

              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setSelectedUser(null)}>
                  关闭
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
