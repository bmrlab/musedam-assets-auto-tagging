import { getAuthSession } from "@/app/(auth)/requestAuth";
import { slugToId } from "@/lib/slug";
import { issueTagManagementProof } from "@/lib/tagging/tag-management-proof";
import { assertMainSiteTagManagementPermission } from "@/musedam/tagManagementPermission";
import { NextRequest, NextResponse } from "next/server";

// 只接受显式携带的两套凭据，不使用主站 cookie；允许父窗口跨域交换，绝不回传主站 token。
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "x-auth-token, x-user-id, x-org-id, x-token, content-type",
  "Cache-Control": "no-store",
};
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors });
}

export async function POST(request: NextRequest) {
  try {
    if (!request.headers.get("x-auth-token")) throw new Error("Missing application credential");
    const session = await getAuthSession();
    if (!session?.user || !session.team) throw new Error("Unauthorized");
    const userId = slugToId("user", session.user.slug).toString();
    const teamId = slugToId("team", session.team.slug).toString();
    const token = request.headers.get("x-token");
    if (
      !token ||
      token.length > 8192 ||
      request.headers.get("x-user-id") !== userId ||
      request.headers.get("x-org-id") !== teamId
    )
      throw new Error("Identity mismatch");
    await assertMainSiteTagManagementPermission({ userId, teamId, token });
    return NextResponse.json(
      { success: true, ...issueTagManagementProof(session.user.id, session.team.id) },
      { headers: cors },
    );
  } catch {
    // 不将网关响应、主站凭据或完整用户资料放进日志及错误响应。
    return NextResponse.json(
      { success: false, message: "无法确认标签管理权限" },
      { status: 403, headers: cors },
    );
  }
}
