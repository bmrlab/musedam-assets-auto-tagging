import { handleMuseDAMLogin } from "@/app/admin/actions/federation";

export default async function MuseDAMLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token;

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">登录失败</h1>
          <p className="text-gray-600">缺少登录令牌</p>
        </div>
      </div>
    );
  }

  // 处理登录
  await handleMuseDAMLogin(token);

  // 这里不会执行到，因为handleMuseDAMLogin会重定向
  return null;
}
