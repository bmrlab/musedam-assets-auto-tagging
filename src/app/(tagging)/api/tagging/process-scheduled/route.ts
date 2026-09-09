import { NextRequest, NextResponse } from "next/server";

import { runScheduledTagging } from "@/app/(tagging)/scheduled-tagging";
import { rootLogger } from "@/lib/logging";

const logger = rootLogger.child({ service: "process-scheduled-tagging" });

// 验证内部 API 密钥
function validateApiKey(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }

  const token = authHeader.substring(7);
  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!internalApiKey) {
    logger.error("INTERNAL_API_KEY not configured in environment");
    return false;
  }

  return token === internalApiKey;
}

export async function POST(request: NextRequest) {
  try {
    // 验证 API 密钥
    if (!validateApiKey(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const summary = await runScheduledTagging();
    return NextResponse.json(summary);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "未知错误";
    logger.error("定时标签任务处理失败: " + errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 },
    );
  }
}
