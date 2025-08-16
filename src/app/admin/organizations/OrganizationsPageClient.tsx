"use client";

import { authClient, signOut, useSession } from "@/app/(auth)/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Building,
  ChevronRight,
  Home,
  Loader2,
  LogOut,
  Plus,
  Settings,
  TestTube,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { addMemberToOrganization } from "../actions";

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: any;
  createdAt: Date;
  members?: Member[];
}

interface Member {
  id: string;
  userId: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
}

export function OrganizationsPageClient() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // 表单数据
  const [createOrgData, setCreateOrgData] = useState({
    name: "",
    slug: "",
    logo: "",
  });
  const [addMemberData, setAddMemberData] = useState({
    userEmail: "",
    role: "member" as "owner" | "admin" | "member",
  });

  const { data: session } = useSession();
  const router = useRouter();

  // 加载组织数据
  const loadOrganizations = async () => {
    try {
      setLoading(true);

      // 获取组织列表
      const orgsResult = await authClient.organization.list();

      if (orgsResult.error) {
        throw new Error(orgsResult.error.message || "获取组织列表失败");
      }

      const orgs = orgsResult.data || [];

      // 为每个组织获取成员信息
      const orgsWithMembers = await Promise.all(
        orgs.map(async (org: any) => {
          try {
            const membersResult = await authClient.organization.listMembers({
              query: {
                organizationId: org.id,
              },
            });

            return {
              ...org,
              members: membersResult.data?.members || [],
            };
          } catch (err) {
            console.error(`获取组织 ${org.id} 成员失败:`, err);
            return {
              ...org,
              members: [],
            };
          }
        }),
      );

      setOrganizations(orgsWithMembers);
    } catch (err) {
      console.error("加载组织数据失败:", err);
      setError(err instanceof Error ? err.message : "加载组织数据失败");
    } finally {
      setLoading(false);
    }
  };

  // 加载用户数据
  const loadUsers = async () => {
    try {
      const result = await authClient.admin.listUsers({
        query: { limit: 1000 },
      });

      if (result.error) {
        throw new Error(result.error.message || "获取用户列表失败");
      }

      setUsers(result.data?.users || []);
    } catch (err) {
      console.error("加载用户数据失败:", err);
      setError(err instanceof Error ? err.message : "加载用户数据失败");
    }
  };

  useEffect(() => {
    if (session?.user?.role === "admin") {
      Promise.all([loadOrganizations(), loadUsers()]);
    }
  }, [session]);

  const handleLogout = async () => {
    await signOut();
    router.push("/login");
  };

  // 创建组织
  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!createOrgData.name || !createOrgData.slug) {
      setError("组织名称和标识符不能为空");
      return;
    }

    try {
      setActionLoading(true);

      const result = await authClient.organization.create({
        name: createOrgData.name,
        slug: createOrgData.slug,
        logo: createOrgData.logo || undefined,
        metadata: {},
      });

      if (result.error) {
        throw new Error(result.error.message || "创建组织失败");
      }

      setShowCreateOrg(false);
      setError("");
      setCreateOrgData({ name: "", slug: "", logo: "" });

      // 重新加载数据
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建组织失败");
    } finally {
      setActionLoading(false);
    }
  };

  // 删除组织
  const handleDeleteOrg = async (orgId: string, orgName: string) => {
    if (!confirm(`确定要删除组织"${orgName}"吗？这将删除所有相关的成员关系。`)) {
      return;
    }

    try {
      setActionLoading(true);

      const result = await authClient.organization.delete({
        organizationId: orgId,
      });

      if (result.error) {
        throw new Error(result.error.message || "删除组织失败");
      }

      setError("");
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除组织失败");
    } finally {
      setActionLoading(false);
    }
  };

  // 添加成员
  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedOrg || !addMemberData.userEmail) {
      setError("请选择用户");
      return;
    }

    try {
      setActionLoading(true);

      // 使用服务端的addMember方法直接添加成员
      await addMemberToOrganization(selectedOrg.id, addMemberData.userEmail, addMemberData.role);

      setShowAddMember(false);
      setSelectedOrg(null);
      setAddMemberData({ userEmail: "", role: "member" });
      setError("");
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加成员失败");
    } finally {
      setActionLoading(false);
    }
  };

  // 移除成员
  const handleRemoveMember = async (member: Member) => {
    if (!confirm(`确定要移除成员"${member.user.name}"吗？`)) {
      return;
    }

    try {
      setActionLoading(true);

      const result = await authClient.organization.removeMember({
        organizationId: member.organizationId,
        memberIdOrEmail: member.user.email,
      });

      if (result.error) {
        throw new Error(result.error.message || "移除成员失败");
      }

      setError("");
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除成员失败");
    } finally {
      setActionLoading(false);
    }
  };

  // 更新成员角色
  const handleUpdateRole = async (member: Member, newRole: "owner" | "admin" | "member") => {
    try {
      setActionLoading(true);

      const result = await authClient.organization.updateMemberRole({
        organizationId: member.organizationId,
        memberId: member.id,
        role: newRole,
      });

      if (result.error) {
        throw new Error(result.error.message || "更新角色失败");
      }

      setSelectedMember(null);
      setError("");
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新角色失败");
    } finally {
      setActionLoading(false);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "owner":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400";
      case "admin":
        return "bg-destructive/10 text-destructive";
      case "member":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "owner":
        return "所有者";
      case "admin":
        return "管理员";
      case "member":
        return "成员";
      default:
        return role;
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
                    <span className="font-medium">组织管理</span>
                  </li>
                </ol>
              </nav>
              <h1 className="text-2xl font-bold">组织管理</h1>
              <p className="text-sm text-muted-foreground">管理组织和成员关系</p>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="outline" onClick={() => router.push("/admin/users")}>
                <Users className="h-4 w-4 mr-2" />
                用户管理
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

        {/* Actions */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-medium">组织列表</h2>
                <p className="text-sm text-muted-foreground">共 {organizations.length} 个组织</p>
              </div>
              <Button onClick={() => setShowCreateOrg(true)} disabled={actionLoading}>
                <Plus className="h-4 w-4 mr-2" />
                创建组织
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Organizations List */}
        {loading ? (
          <Card>
            <CardContent className="flex items-center justify-center p-6">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="ml-2 text-muted-foreground">加载中...</p>
            </CardContent>
          </Card>
        ) : organizations.length === 0 ? (
          <Card>
            <CardContent className="text-center p-8">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-muted mb-4">
                <Building className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">暂无组织</h3>
              <p className="text-muted-foreground mb-4">
                还没有创建任何组织。点击上方的"创建组织"按钮开始。
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {organizations.map((org) => (
              <Card key={org.id}>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                      {org.logo && (
                        <img src={org.logo} alt={org.name} className="h-8 w-8 rounded" />
                      )}
                      <div>
                        <CardTitle className="text-lg">{org.name}</CardTitle>
                        <CardDescription>
                          @{org.slug} • {org.members?.length || 0} 成员 • 创建于{" "}
                          {new Date(org.createdAt).toLocaleDateString("zh-CN")}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedOrg(org);
                          setShowAddMember(true);
                        }}
                        disabled={actionLoading}
                      >
                        <UserPlus className="h-4 w-4 mr-1" />
                        添加成员
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteOrg(org.id, org.name)}
                        disabled={actionLoading}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        删除
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div>
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      成员列表
                    </h4>
                    {!org.members || org.members.length === 0 ? (
                      <p className="text-sm text-muted-foreground">暂无成员</p>
                    ) : (
                      <div className="space-y-2">
                        {org.members.map((member) => (
                          <div
                            key={member.id}
                            className="flex justify-between items-center p-3 bg-muted/50 rounded-lg"
                          >
                            <div>
                              <p className="text-sm font-medium">{member.user.name}</p>
                              <p className="text-sm text-muted-foreground">{member.user.email}</p>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span
                                className={`px-2 py-1 text-xs font-semibold rounded-full ${getRoleColor(
                                  member.role,
                                )}`}
                              >
                                {getRoleLabel(member.role)}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedMember(member)}
                                disabled={actionLoading}
                              >
                                <Settings className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveMember(member)}
                                disabled={actionLoading}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Organization Dialog */}
      <Dialog open={showCreateOrg} onOpenChange={setShowCreateOrg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建新组织</DialogTitle>
            <DialogDescription>填写组织信息以创建新的组织</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateOrg} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">组织名称 *</Label>
              <Input
                id="org-name"
                value={createOrgData.name}
                onChange={(e) => setCreateOrgData({ ...createOrgData, name: e.target.value })}
                placeholder="我的组织"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-slug">组织标识符 *</Label>
              <Input
                id="org-slug"
                value={createOrgData.slug}
                onChange={(e) => setCreateOrgData({ ...createOrgData, slug: e.target.value })}
                pattern="[a-z0-9-]+"
                placeholder="my-organization"
                required
              />
              <p className="text-xs text-muted-foreground">只能包含小写字母、数字和连字符</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="org-logo">Logo URL (可选)</Label>
              <Input
                id="org-logo"
                type="url"
                value={createOrgData.logo}
                onChange={(e) => setCreateOrgData({ ...createOrgData, logo: e.target.value })}
                placeholder="https://example.com/logo.png"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateOrg(false)}>
                取消
              </Button>
              <Button type="submit" disabled={actionLoading}>
                {actionLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    创建中...
                  </>
                ) : (
                  "创建组织"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog */}
      <Dialog
        open={showAddMember}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddMember(false);
            setSelectedOrg(null);
            setAddMemberData({ userEmail: "", role: "member" });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加成员到 {selectedOrg?.name}</DialogTitle>
            <DialogDescription>选择用户并设置其在组织中的角色</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleInviteMember} className="space-y-4">
            <div className="space-y-2">
              <Label>用户邮箱 *</Label>
              <Select
                value={addMemberData.userEmail}
                onValueChange={(value) => setAddMemberData({ ...addMemberData, userEmail: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择用户" />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter(
                      (user) =>
                        !selectedOrg?.members?.some((member) => member.user.email === user.email),
                    )
                    .map((user) => (
                      <SelectItem key={user.id} value={user.email}>
                        {user.name} ({user.email})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>角色 *</Label>
              <Select
                value={addMemberData.role}
                onValueChange={(value: "owner" | "admin" | "member") =>
                  setAddMemberData({ ...addMemberData, role: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">成员</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                  <SelectItem value="owner">所有者</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowAddMember(false);
                  setSelectedOrg(null);
                  setAddMemberData({ userEmail: "", role: "member" });
                }}
              >
                取消
              </Button>
              <Button type="submit" disabled={actionLoading}>
                {actionLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    添加中...
                  </>
                ) : (
                  "添加成员"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Member Role Dialog */}
      <Dialog open={!!selectedMember} onOpenChange={(open) => !open && setSelectedMember(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑成员角色: {selectedMember?.user.name}</DialogTitle>
            <DialogDescription>修改用户在组织中的角色权限</DialogDescription>
          </DialogHeader>

          {selectedMember && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-3">
                  当前角色: {getRoleLabel(selectedMember.role)}
                </p>
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => handleUpdateRole(selectedMember, "member")}
                    disabled={actionLoading || selectedMember.role === "member"}
                  >
                    设为成员
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => handleUpdateRole(selectedMember, "admin")}
                    disabled={actionLoading || selectedMember.role === "admin"}
                  >
                    设为管理员
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => handleUpdateRole(selectedMember, "owner")}
                    disabled={actionLoading || selectedMember.role === "owner"}
                  >
                    设为所有者
                  </Button>
                </div>
              </div>

              <Separator />

              <DialogFooter>
                <Button variant="outline" onClick={() => setSelectedMember(null)}>
                  关闭
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
