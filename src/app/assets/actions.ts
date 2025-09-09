"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { enqueueTaggingTask } from "@/app/(tagging)/queue";
import { SourceBasedTagPredictions } from "@/app/(tagging)/types";
import { ServerActionResult } from "@/lib/serverAction";
import { syncAssetsFromMuseDAM } from "@/musedam/assets";
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
      take: 100,
    });

    return {
      success: true,
      data: { assets },
    };
  });
}

export async function predictAssetTagsAction(
  assetId: number,
  options?: {
    matchingSources?: {
      basicInfo: boolean;
      materializedPath: boolean;
      contentAnalysis: boolean;
      tagKeywords: boolean;
    };
    recognitionAccuracy?: "precise" | "balanced" | "broad";
  },
): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const assetObject = await prisma.assetObject.findUniqueOrThrow({
      where: { id: assetId, teamId },
    });
    await enqueueTaggingTask({
      assetObject,
      matchingSources: options?.matchingSources,
      recognitionAccuracy: options?.recognitionAccuracy,
    });
    return {
      success: true,
      data: undefined,
    };
  });
}

export async function predictAssetTagsAndWaitAction(
  assetId: number,
  options?: {
    matchingSources?: {
      basicInfo: boolean;
      materializedPath: boolean;
      contentAnalysis: boolean;
      tagKeywords: boolean;
    };
    recognitionAccuracy?: "precise" | "balanced" | "broad";
  },
): Promise<ServerActionResult<{ predictions: SourceBasedTagPredictions }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const assetObject = await prisma.assetObject.findUnique({
        where: { id: assetId, teamId },
      });

      if (!assetObject) {
        return {
          success: false,
          message: "资产不存在或无权限访问",
        };
      }

      const taggingQueueItem = await enqueueTaggingTask({
        assetObject,
        matchingSources: options?.matchingSources,
        recognitionAccuracy: options?.recognitionAccuracy,
      });

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
              predictions: SourceBasedTagPredictions;
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

export async function fetchSampleAssetsAction(): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { id: true, slug: true },
    });
    await syncAssetsFromMuseDAM({ team });
    return {
      success: true,
      data: undefined,
    };
  });
}
