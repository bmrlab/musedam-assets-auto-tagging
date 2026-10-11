import { getAuthSession } from "@/app/(auth)/requestAuth";
import { checkUserPermission } from "@/app/(auth)/lib";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await getAuthSession();
    
    if (!session?.user || !session?.team) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }

    const result = await checkUserPermission({ user: session.user, team: session.team });
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // 权限检查失败时返回 403 Forbidden，而不是 500 Internal Server Error
    // 这样 postmessage 中的 res.ok 会正确返回 false
    const status = error instanceof Error && error.message === "Permission denied" ? 403 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
