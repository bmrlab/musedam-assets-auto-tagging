import { AuthTokenError, AUTH_TOKEN_HEADER, resolveAuthToken } from "@/app/(auth)/requestAuth";
import { NextRequest, NextResponse } from "next/server";

// 按请求里的 token 返回当前 tab 对应的登录信息（取代 next-auth 的 /api/auth/session），
// 同时带回 token 过期时间，前端据此在过期前让父项目换发新 token。
export async function GET(request: NextRequest) {
  const token = request.headers.get(AUTH_TOKEN_HEADER);
  if (!token) {
    return NextResponse.json({ success: false, code: "TOKEN_REQUIRED" }, { status: 401 });
  }
  try {
    const { session, tokenExpiresAt } = await resolveAuthToken(token);
    return NextResponse.json({ success: true, session, tokenExpiresAt });
  } catch (error) {
    if (error instanceof AuthTokenError) {
      return NextResponse.json(
        { success: false, code: error.code },
        { status: error.code === "PERMISSION_DENIED" ? 403 : 401 },
      );
    }
    throw error;
  }
}
