"use client";

import { useSession, signOut } from "@/app/(auth)/client";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function Home() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const handleLogout = async () => {
    await signOut();
    router.refresh();
  };

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">正在加载...</p>
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
              <h1 className="text-2xl font-bold text-gray-900">
                MuseDAM 资产自动标记系统
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              {session?.user ? (
                <>
                  <span className="text-gray-700">
                    欢迎, {session.user.name}
                  </span>
                  {session.user.role === "admin" && (
                    <Link
                      href="/admin"
                      className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                    >
                      管理员面板
                    </Link>
                  )}
                  <button
                    onClick={handleLogout}
                    className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700"
                  >
                    退出登录
                  </button>
                </>
              ) : (
                <div className="flex space-x-2">
                  <Link
                    href="/login"
                    className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
                  >
                    登录
                  </Link>
                  <Link
                    href="/register"
                    className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                  >
                    注册
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg p-8">
            {session?.user ? (
              <div className="text-center">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  欢迎使用 MuseDAM 资产自动标记系统
                </h2>
                <p className="text-xl text-gray-600 mb-8">
                  这里是主要功能区域，您可以进行资产管理和自动标记操作。
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      资产上传
                    </h3>
                    <p className="text-gray-600 mb-4">
                      上传您的数字资产进行自动标记和分类
                    </p>
                    <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                      开始上传
                    </button>
                  </div>

                  <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      标记管理
                    </h3>
                    <p className="text-gray-600 mb-4">查看和管理已标记的资产</p>
                    <button className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
                      查看标记
                    </button>
                  </div>

                  <div className="bg-white p-6 rounded-lg shadow">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      AI 分析
                    </h3>
                    <p className="text-gray-600 mb-4">
                      使用 AI 技术进行智能分析和标记
                    </p>
                    <button className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700">
                      AI 分析
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <h2 className="text-3xl font-bold text-gray-900 mb-4">
                  欢迎使用 MuseDAM 资产自动标记系统
                </h2>
                <p className="text-xl text-gray-600 mb-8">
                  请先登录以访问系统功能
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Link
                    href="/login"
                    className="bg-blue-600 text-white px-6 py-3 rounded-lg text-lg hover:bg-blue-700"
                  >
                    立即登录
                  </Link>
                  <Link
                    href="/register"
                    className="bg-green-600 text-white px-6 py-3 rounded-lg text-lg hover:bg-green-700"
                  >
                    注册账户
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
