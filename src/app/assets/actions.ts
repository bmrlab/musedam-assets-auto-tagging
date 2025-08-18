"use server";
import { enqueueTaggingTask, TagPrediction } from "@/ai/tagging";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { AssetObject } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export async function fetchTeamAssets(): Promise<
  ServerActionResult<{
    assets: AssetObject[];
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const assets = await prisma.assetObject.findMany({
      where: { teamId },
      orderBy: [{ createdAt: "desc" }],
      take: 10, // 默认前10个
    });

    return {
      success: true,
      data: { assets },
    };
  });
}

export async function predictAssetTagsAction(
  assetId: number,
): Promise<ServerActionResult<{ predictions: TagPrediction[] }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const assetObject = await prisma.assetObject.findFirst({
        where: { id: assetId, teamId },
      });

      if (!assetObject) {
        return {
          success: false,
          message: "资产不存在或无权限访问",
        };
      }

      const taggingQueueItem = await enqueueTaggingTask({ assetObject });

      // 轮询队列项状态，每5秒检查一次
      const maxWaitTime = 60000; // 最大等待时间60秒
      const pollInterval = 5000; // 5秒轮询间隔
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        const updatedQueueItem = await prisma.taggingQueueItem.findUnique({
          where: { id: taggingQueueItem.id },
        });

        if (!updatedQueueItem) {
          return {
            success: false,
            message: "队列项不存在",
          };
        }

        if (updatedQueueItem.status === "completed") {
          const { predictions } =
            (updatedQueueItem.result as unknown as {
              predictions: TagPrediction[];
            }) ?? {};
          if (!predictions) {
            return {
              success: false,
              message: "AI标签预测结果为空",
            };
          }
          return {
            success: true,
            data: {
              predictions,
            },
          };
        }

        if (updatedQueueItem.status === "failed") {
          return {
            success: false,
            message: "AI标签预测失败，请稍后重试",
          };
        }
      }

      // 超时处理
      return {
        success: false,
        message: "AI标签预测超时，请稍后重试",
      };
    } catch (error) {
      console.error("AI标签预测失败:", error);
      return {
        success: false,
        message: "AI标签预测失败，请稍后重试",
      };
    }
  });
}
