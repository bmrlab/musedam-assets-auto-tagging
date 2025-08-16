"use client";

import { useState, useEffect } from "react";
import { useSession, signOut, authClient } from "@/app/(auth)/client";
import { useRouter } from "next/navigation";
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

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showCreateUser, setShowCreateUser] = useState(false);

  const { data: session } = useSession();
  const router = useRouter();

  // 检查是否是管理员
  useEffect(() => {
    if (session === null) {
      router.push("/login");
    } else if (session?.user && session.user.role !== "admin") {
      router.push("/");
    }
  }, [session, router]);

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
              typeof user.createdAt === "string"
                ? user.createdAt
                : user.createdAt.toISOString(),
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
              <h1 className="text-2xl font-bold text-gray-900">管理员面板</h1>
              <p className="text-sm text-gray-600">
                欢迎回来，{session.user.name}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
            >
              退出登录
            </button>
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

        {/* Search and Actions */}
        <div className="mb-6 bg-white shadow rounded-lg p-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex-1 max-w-md">
              <label htmlFor="search" className="sr-only">
                搜索用户
              </label>
              <input
                type="text"
                id="search"
                placeholder="搜索用户邮箱..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <button
              onClick={() => setShowCreateUser(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              创建用户
            </button>
          </div>
        </div>

        {/* Create User Modal */}
        <CreateUserModal
          isOpen={showCreateUser}
          onClose={() => setShowCreateUser(false)}
          onUserCreated={loadUsers}
        />

        {/* Users Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">用户列表</h2>
          </div>

          {loading ? (
            <div className="p-6 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">加载中...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      用户
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      角色
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      状态
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      创建时间
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {user.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            {user.email}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            user.role === "admin"
                              ? "bg-red-100 text-red-800"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          {user.role || "user"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            user.banned
                              ? "bg-red-100 text-red-800"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          {user.banned ? "已封禁" : "正常"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => setSelectedUser(user)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          管理
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {users.length === 0 && (
                <div className="p-6 text-center text-gray-500">
                  没有找到用户
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* User Management Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                管理用户: {selectedUser.name}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    设置角色
                  </label>
                  <div className="space-x-2">
                    <button
                      onClick={() => handleSetRole(selectedUser.id, "user")}
                      className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                    >
                      普通用户
                    </button>
                    <button
                      onClick={() => handleSetRole(selectedUser.id, "admin")}
                      className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                    >
                      管理员
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    用户状态
                  </label>
                  {selectedUser.banned ? (
                    <div>
                      <p className="text-sm text-red-600 mb-2">
                        封禁原因: {selectedUser.banReason || "无"}
                      </p>
                      <button
                        onClick={() => handleUnbanUser(selectedUser.id)}
                        className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                      >
                        解除封禁
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() =>
                        handleBanUser(selectedUser.id, "管理员封禁")
                      }
                      className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                    >
                      封禁用户
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => setSelectedUser(null)}
                  className="bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
