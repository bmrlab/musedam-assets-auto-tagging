"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { enqueueTaggingTask } from "@/app/(tagging)/queue";
import { ServerActionResult } from "@/lib/serverAction";
import { syncSingleAssetFromMuseDAM } from "@/musedam/assets";
import { MuseDAMID } from "@/musedam/types";
import prisma from "@/prisma/prisma";

interface SelectedAsset {
  id: MuseDAMID; // 素材唯一标识
  name: string; // 素材名称
  extension: string; // 文件扩展名
  size: number; // 文件大小（字节）
  url?: string; // 素材访问链接
  thumbnail?: string; // 缩略图链接
  width?: number; // 图片宽度（图片类型）
  height?: number; // 图片高度（图片类型）
  type?: string; // 素材类型
  folderId?: MuseDAMID; // 所在文件夹ID
  folderName?: string; // 所在文件夹名称
}

export async function startTaggingTasksAction(
  selectedAssets: SelectedAsset[],
  options?: {
    matchingSources?: {
      basicInfo: boolean;
      materializedPath: boolean;
      contentAnalysis: boolean;
      tagKeywords: boolean;
    };
    recognitionAccuracy?: "precise" | "balanced" | "broad";
  },
): Promise<
  ServerActionResult<{
    successCount: number;
    failedCount: number;
    failedAssets: string[];
    queueItemIds: number[];
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      let successCount = 0;
      let failedCount = 0;
      const failedAssets: string[] = [];
      const queueItemIds: number[] = [];

      // 批量发起打标任务
      for (const asset of selectedAssets) {
        try {
          const musedamAssetId = asset.id;

          // 获取完整的team信息
          const team = await prisma.team.findUniqueOrThrow({
            where: { id: teamId },
            select: { id: true, slug: true },
          });

          // 1. 从 MuseDAM 同步素材到本地数据库
          const { assetObject } = await syncSingleAssetFromMuseDAM({
            musedamAssetId,
            team,
          });

          // 2. 发起 AI 打标任务
          const taggingQueueItem = await enqueueTaggingTask({
            assetObject,
            matchingSources: options?.matchingSources,
            recognitionAccuracy: options?.recognitionAccuracy,
          });

          queueItemIds.push(taggingQueueItem.id);
          successCount++;
        } catch (error) {
          console.error(`Error starting tagging for asset ${asset.name} (${asset.id}):`, error);
          failedCount++;
          failedAssets.push(asset.name);
        }
      }

      return {
        success: true,
        data: {
          successCount,
          failedCount,
          failedAssets,
          queueItemIds,
        },
      };
    } catch (error) {
      console.error("批量发起打标任务失败:", error);
      return {
        success: false,
        message: "批量发起打标任务失败",
      };
    }
  });
}
