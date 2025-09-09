import { processPendingQueueItems } from "@/app/(tagging)/queue";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // 验证内部 API key
    const authHeader = request.headers.get("Authorization");
    const expectedKey = process.env.INTERNAL_API_KEY;

    if (!expectedKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Internal API key not configured",
        },
        { status: 500 },
      );
    }

    if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 },
      );
    }

    // 处理队列中的待处理项
    const result = await processPendingQueueItems();

    return NextResponse.json({
      success: true,
      processing: result.processing,
      skipped: result.skipped,
    });
  } catch (error) {
    console.error("Queue processing failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
