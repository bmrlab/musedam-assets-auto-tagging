"use client";

import { useState } from "react";
import { useSession, signOut, authClient } from "@/app/(auth)/client";
import { useRouter } from "next/navigation";

export default function UserPanel() {
  const [isOpen, setIsOpen] = useState(false);
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
        <button
          onClick={() => router.push("/login")}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          登录
        </button>
        <button
          onClick={() => router.push("/register")}
          className="border border-blue-600 text-blue-600 px-4 py-2 rounded hover:bg-blue-50"
        >
          注册
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-4">
      {/* 组织切换器 */}
      {session?.user && organizations && organizations.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowOrgSelector(!showOrgSelector)}
            className="flex items-center px-3 py-2 text-sm bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <div className="flex items-center">
              <svg
                className="h-4 w-4 mr-2 text-gray-400"
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
              <span className="text-gray-700">
                {activeOrganization ? activeOrganization.name : "个人模式"}
              </span>
              <svg
                className="ml-2 h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </button>

          {showOrgSelector && (
            <div className="origin-top-right absolute right-0 mt-2 w-56 rounded-md shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  选择组织
                </p>
              </div>

              <button
                onClick={() => handleSetActiveOrganization(null)}
                className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                  !activeOrganization
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-700"
                }`}
              >
                <div className="flex items-center">
                  <div className="h-6 w-6 rounded bg-gray-200 flex items-center justify-center mr-3">
                    <svg
                      className="h-3 w-3 text-gray-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium">个人模式</p>
                    <p className="text-xs text-gray-500">不属于任何组织</p>
                  </div>
                  {!activeOrganization && (
                    <svg
                      className="ml-auto h-4 w-4 text-blue-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                </div>
              </button>

              {organizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => handleSetActiveOrganization(org.id)}
                  className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 ${
                    activeOrganization?.id === org.id
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-700"
                  }`}
                >
                  <div className="flex items-center">
                    <div className="h-6 w-6 rounded bg-blue-100 flex items-center justify-center mr-3">
                      {org.logo ? (
                        <img
                          src={org.logo}
                          alt={org.name}
                          className="h-6 w-6 rounded"
                        />
                      ) : (
                        <span className="text-xs font-medium text-blue-600">
                          {org.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{org.name}</p>
                      <p className="text-xs text-gray-500">@{org.slug}</p>
                    </div>
                    {activeOrganization?.id === org.id && (
                      <svg
                        className="ml-2 h-4 w-4 text-blue-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* 点击外部关闭组织选择器 */}
          {showOrgSelector && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowOrgSelector(false)}
            ></div>
          )}
        </div>
      )}

      {/* 用户下拉菜单 */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center text-sm rounded-full bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-white"
        >
          <span className="sr-only">打开用户菜单</span>
          <div className="h-8 w-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-sm font-medium text-white">
              {session.user.name?.charAt(0).toUpperCase() || "U"}
            </span>
          </div>
        </button>

        {isOpen && (
          <div className="origin-top-right absolute right-0 mt-2 w-64 rounded-md shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
            {/* 用户信息 */}
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex items-center">
                <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center">
                  <span className="text-sm font-medium text-white">
                    {session.user.name?.charAt(0).toUpperCase() || "U"}
                  </span>
                </div>
                <div className="ml-3">
                  <div className="text-sm font-medium text-gray-900">
                    {session.user.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {session.user.email}
                  </div>
                  {session.user.role && (
                    <div className="text-xs">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          session.user.role === "admin"
                            ? "bg-red-100 text-red-800"
                            : "bg-green-100 text-green-800"
                        }`}
                      >
                        {session.user.role === "admin" ? "管理员" : "用户"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 菜单项 */}
            <div className="py-1">
              <button
                onClick={handleProfileClick}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                <div className="flex items-center">
                  <svg
                    className="h-4 w-4 mr-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  个人资料
                </div>
              </button>

              {session.user.role === "admin" && (
                <button
                  onClick={handleAdminClick}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  <div className="flex items-center">
                    <svg
                      className="h-4 w-4 mr-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    管理员面板
                  </div>
                </button>
              )}

              <div className="border-t border-gray-100 my-1"></div>

              <button
                onClick={handleLogout}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                <div className="flex items-center">
                  <svg
                    className="h-4 w-4 mr-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                  退出登录
                </div>
              </button>
            </div>
          </div>
        )}

        {/* 点击外部关闭下拉菜单 */}
        {isOpen && (
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          ></div>
        )}
      </div>
    </div>
  );
}
