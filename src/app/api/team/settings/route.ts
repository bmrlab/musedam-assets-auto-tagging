import { AUTH_TOKEN_HEADER, AuthTokenError, getAuthSession, resolveTokenIdentity } from "@/app/(auth)/requestAuth";
import { checkUserPermission } from "@/app/(auth)/lib";
import { getTaggingSettings } from "@/app/(tagging)/tagging/settings/lib";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * 确定这次请求对应的用户和团队。
 * 带了 token 就只认 token 里的团队：没有打标权限的成员登录会被拒绝，但这里仍要如实回报 hasPermission=false，
 * 不能退回共享 cookie——那里可能是同一用户在别的团队（比如有权限的团队）的旧登录，会把权限串过来。
 */
async function resolveIdentity() {
  const token = (await headers()).get(AUTH_TOKEN_HEADER);
  if (token) {
    try {
      return await resolveTokenIdentity(token);
    } catch (error) {
      if (error instanceof AuthTokenError) return null;
      throw error;
    }
  }
  // 兼容期：没带 token 的旧版父项目仍按共享 cookie 登录态
  const session = await getAuthSession();
  return session?.user && session?.team ? { user: session.user, team: session.team } : null;
}

export async function GET() {
  try {
    const identity = await resolveIdentity();

    if (!identity) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized",
        },
        { status: 401 },
      );
    }

    // 获取团队设置和检查用户权限
    const [settings, hasPermission] = await Promise.all([
      getTaggingSettings(identity.team.id),
      checkUserPermission({ user: identity.user, team: identity.team })
        .then(() => true)
        .catch(() => false),
    ]);

    // 返回简化的信息
    return NextResponse.json({
      success: true,
      data: {
        manualTriggerTagging:
          settings.isTaggingEnabled && settings.triggerTiming.manualTriggerTagging,
        hasPermission,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status: 500 },
    );
  }
}
