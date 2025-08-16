"use client";

import { useState, useEffect } from "react";
import { useSession, signOut, authClient } from "@/app/(auth)/client";
import { useRouter } from "next/navigation";
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
  const handleCreateOrg = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const name = formData.get("name") as string;
    const slug = formData.get("slug") as string;
    const logo = formData.get("logo") as string;

    if (!name || !slug) {
      setError("组织名称和标识符不能为空");
      return;
    }

    try {
      setActionLoading(true);

      const result = await authClient.organization.create({
        name,
        slug,
        logo: logo || undefined,
        metadata: {},
      });

      if (result.error) {
        throw new Error(result.error.message || "创建组织失败");
      }

      setShowCreateOrg(false);
      setError("");

      // 重新加载数据
      await loadOrganizations();

      // 重置表单
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建组织失败");
    } finally {
      setActionLoading(false);
    }
  };

  // 删除组织
  const handleDeleteOrg = async (orgId: string, orgName: string) => {
    if (
      !confirm(`确定要删除组织"${orgName}"吗？这将删除所有相关的成员关系。`)
    ) {
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

  // 直接添加成员
  const handleInviteMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const organizationId = formData.get("organizationId") as string;
    const userEmail = formData.get("userEmail") as string;
    const role = formData.get("role") as "owner" | "admin" | "member";

    try {
      setActionLoading(true);

      // 使用服务端的addMember方法直接添加成员
      await addMemberToOrganization(organizationId, userEmail, role);

      setShowAddMember(false);
      setSelectedOrg(null);
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
  const handleUpdateRole = async (
    member: Member,
    newRole: "owner" | "admin" | "member",
  ) => {
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

  if (!session?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">正在加载...</p>
        </div>
      </div>
    );
  }

  if (session.user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">访问被拒绝</h1>
          <p className="text-gray-600 mb-4">您没有权限访问管理员面板</p>
          <button
            onClick={() => router.push("/")}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              {/* Breadcrumb */}
              <nav className="flex mb-2" aria-label="Breadcrumb">
                <ol className="flex items-center space-x-2">
                  <li>
                    <button
                      onClick={() => router.push("/")}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      首页
                    </button>
                  </li>
                  <li className="flex items-center">
                    <svg
                      className="flex-shrink-0 h-4 w-4 text-gray-400 mx-2"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-gray-500">管理员</span>
                  </li>
                  <li className="flex items-center">
                    <svg
                      className="flex-shrink-0 h-4 w-4 text-gray-400 mx-2"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-gray-900 font-medium">组织管理</span>
                  </li>
                </ol>
              </nav>
              <h1 className="text-2xl font-bold text-gray-900">组织管理</h1>
              <p className="text-sm text-gray-600">管理组织和成员关系</p>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push("/admin/users")}
                className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
              >
                用户管理
              </button>
              <button
                onClick={handleLogout}
                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
            <button
              onClick={() => setError("")}
              className="float-right text-red-700 hover:text-red-900"
            >
              ×
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="mb-6 bg-white shadow rounded-lg p-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-medium text-gray-900">
              组织列表 ({organizations.length})
            </h2>
            <button
              onClick={() => setShowCreateOrg(true)}
              disabled={actionLoading}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              创建组织
            </button>
          </div>
        </div>

        {/* Organizations List */}
        {loading ? (
          <div className="bg-white shadow rounded-lg p-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">加载中...</p>
          </div>
        ) : organizations.length === 0 ? (
          <div className="bg-white shadow rounded-lg p-8 text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-gray-100 mb-4">
              <svg
                className="h-6 w-6 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无组织</h3>
            <p className="text-gray-600 mb-4">
              还没有创建任何组织。点击上方的"创建组织"按钮开始。
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {organizations.map((org) => (
              <div
                key={org.id}
                className="bg-white shadow rounded-lg overflow-hidden"
              >
                <div className="px-6 py-4 border-b border-gray-200">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                      {org.logo && (
                        <img
                          src={org.logo}
                          alt={org.name}
                          className="h-8 w-8 rounded"
                        />
                      )}
                      <div>
                        <h3 className="text-lg font-medium text-gray-900">
                          {org.name}
                        </h3>
                        <p className="text-sm text-gray-500">
                          @{org.slug} • {org.members?.length || 0} 成员 • 创建于{" "}
                          {new Date(org.createdAt).toLocaleDateString("zh-CN")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          setSelectedOrg(org);
                          setShowAddMember(true);
                        }}
                        disabled={actionLoading}
                        className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                      >
                        添加成员
                      </button>
                      <button
                        onClick={() => handleDeleteOrg(org.id, org.name)}
                        disabled={actionLoading}
                        className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 disabled:opacity-50"
                      >
                        删除组织
                      </button>
                    </div>
                  </div>
                </div>

                {/* Members */}
                <div className="px-6 py-4">
                  <h4 className="text-sm font-medium text-gray-900 mb-3">
                    成员列表
                  </h4>
                  {!org.members || org.members.length === 0 ? (
                    <p className="text-sm text-gray-500">暂无成员</p>
                  ) : (
                    <div className="space-y-2">
                      {org.members.map((member) => (
                        <div
                          key={member.id}
                          className="flex justify-between items-center p-3 bg-gray-50 rounded"
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {member.user.name}
                            </p>
                            <p className="text-sm text-gray-500">
                              {member.user.email}
                            </p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span
                              className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                member.role === "owner"
                                  ? "bg-purple-100 text-purple-800"
                                  : member.role === "admin"
                                    ? "bg-red-100 text-red-800"
                                    : "bg-green-100 text-green-800"
                              }`}
                            >
                              {member.role === "owner"
                                ? "所有者"
                                : member.role === "admin"
                                  ? "管理员"
                                  : "成员"}
                            </span>
                            <button
                              onClick={() => setSelectedMember(member)}
                              disabled={actionLoading}
                              className="text-blue-600 hover:text-blue-900 text-sm disabled:opacity-50"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleRemoveMember(member)}
                              disabled={actionLoading}
                              className="text-red-600 hover:text-red-900 text-sm disabled:opacity-50"
                            >
                              移除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Organization Modal */}
      {showCreateOrg && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                创建新组织
              </h3>
              <form onSubmit={handleCreateOrg} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    组织名称 *
                  </label>
                  <input
                    type="text"
                    name="name"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="我的组织"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    组织标识符 *
                  </label>
                  <input
                    type="text"
                    name="slug"
                    required
                    pattern="[a-z0-9-]+"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="my-organization"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    只能包含小写字母、数字和连字符
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Logo URL (可选)
                  </label>
                  <input
                    type="url"
                    name="logo"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="https://example.com/logo.png"
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCreateOrg(false)}
                    disabled={actionLoading}
                    className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? "创建中..." : "创建组织"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMember && selectedOrg && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                添加成员到 {selectedOrg.name}
              </h3>
              <form onSubmit={handleInviteMember} className="space-y-4">
                <input
                  type="hidden"
                  name="organizationId"
                  value={selectedOrg.id}
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    用户邮箱 *
                  </label>
                  <select
                    name="userEmail"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">选择用户</option>
                    {users
                      .filter(
                        (user) =>
                          !selectedOrg.members?.some(
                            (member) => member.user.email === user.email,
                          ),
                      )
                      .map((user) => (
                        <option key={user.id} value={user.email}>
                          {user.name} ({user.email})
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    角色 *
                  </label>
                  <select
                    name="role"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="member">成员</option>
                    <option value="admin">管理员</option>
                    <option value="owner">所有者</option>
                  </select>
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddMember(false);
                      setSelectedOrg(null);
                    }}
                    disabled={actionLoading}
                    className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={actionLoading}
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading ? "添加中..." : "添加成员"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Member Role Modal */}
      {selectedMember && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                编辑成员角色: {selectedMember.user.name}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    当前角色:{" "}
                    {selectedMember.role === "owner"
                      ? "所有者"
                      : selectedMember.role === "admin"
                        ? "管理员"
                        : "成员"}
                  </label>
                  <div className="space-y-2">
                    <button
                      onClick={() => handleUpdateRole(selectedMember, "member")}
                      disabled={
                        actionLoading || selectedMember.role === "member"
                      }
                      className="w-full bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      设为成员
                    </button>
                    <button
                      onClick={() => handleUpdateRole(selectedMember, "admin")}
                      disabled={
                        actionLoading || selectedMember.role === "admin"
                      }
                      className="w-full bg-yellow-600 text-white px-3 py-2 rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      设为管理员
                    </button>
                    <button
                      onClick={() => handleUpdateRole(selectedMember, "owner")}
                      disabled={
                        actionLoading || selectedMember.role === "owner"
                      }
                      className="w-full bg-purple-600 text-white px-3 py-2 rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      设为所有者
                    </button>
                  </div>
                </div>
                <div className="flex justify-end pt-4">
                  <button
                    onClick={() => setSelectedMember(null)}
                    disabled={actionLoading}
                    className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400 disabled:opacity-50"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
