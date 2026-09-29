import { withAuth } from "@/app/(auth)/withAuth";
import { getFeatureLibraryFeaturesFromRequest } from "@/lib/feature-library-server";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import pLimit from "p-limit";
import { z } from "zod";
import { buildQueueStatusPayload } from "./queue-status-payload";

// 单次最多查询的队列项数量（测试页一次选择的素材数通常远小于此）
const MAX_QUEUE_ITEM_IDS = 200;
// 每个队列项还要查排队预估与关联标签，限制并发避免占满数据库连接池
const PAYLOAD_CONCURRENCY = 5;

const idsSchema = z.array(z.coerce.number().int().positive()).min(1).max(MAX_QUEUE_ITEM_IDS);

/**
 * 批量查询队列项状态：GET /api/tagging/queue-status?ids=1,2,3
 * 每一项的结构与单条接口 /api/tagging/queue-status/[queueItemId] 的 data 相同；
 * 不存在或不属于当前团队的 id 放在 missingIds 里。
 */
export async function GET(request: NextRequest) {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const parsed = idsSchema.safeParse(
        (request.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean),
      );
      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid ids",
            message: `ids must be 1-${MAX_QUEUE_ITEM_IDS} comma-separated positive integers`,
          },
          { status: 400 },
        );
      }
      const ids: number[] = [...new Set(parsed.data)];
      const featureLibraryFeatures = getFeatureLibraryFeaturesFromRequest(request);

      const queueItems = await prisma.taggingQueueItem.findMany({
        where: {
          id: { in: ids },
          teamId,
        },
        include: {
          assetObject: true,
        },
      });
      const foundIds = new Set(queueItems.map((item) => item.id));
      const limit = pLimit(PAYLOAD_CONCURRENCY);
      const items = await Promise.all(
        queueItems.map((queueItem) =>
          limit(() => buildQueueStatusPayload({ teamId, queueItem, featureLibraryFeatures })),
        ),
      );

      return NextResponse.json({
        success: true,
        data: {
          items,
          missingIds: ids.filter((id) => !foundIds.has(id)),
        },
      });
    } catch (error) {
      console.error("批量获取队列状态失败:", error);
      return NextResponse.json(
        {
          success: false,
          error: "批量获取队列状态失败",
          message: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    }
  });
}
