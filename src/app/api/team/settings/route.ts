import { getAuthSession } from "@/app/(auth)/requestAuth";
import { checkUserPermission } from "@/app/(auth)/lib";
import { getTaggingSettings } from "@/app/(tagging)/tagging/settings/lib";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await getAuthSession();

    if (!session?.user || !session?.team) {
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
      getTaggingSettings(session.team.id),
      checkUserPermission({ user: session.user, team: session.team })
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
