import { enqueueTaggingTask } from "@/app/(tagging)/queue";
import { getTaggingSettings } from "@/app/(tagging)/tagging/settings/lib";
import { TaggingSettingsData } from "@/app/(tagging)/types";
import { idToSlug, slugToId } from "@/lib/slug";
import prisma from "@/prisma/prisma";
import { syncSingleAssetFromMuseDAM } from "@/musedam/assets";
import { MuseDAMID } from "@/musedam/types";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  teamId: z.coerce.bigint().positive(),
  // 可选参数，指定要处理的资产ID列表
  assetIds: z.array(z.number().positive()).optional(),
  // 可选参数，指定每批处理的数量，默认100
  batchSize: z.number().min(1).max(500).optional().default(100),
});

export async function POST(request: NextRequest) {
  try {
    // 解析请求体
    const body = await request.json();
    const {
      teamId: musedamTeamId,
      assetIds,
      batchSize,
    } = requestSchema.parse(body);

    // 根据 teamId 构造 team slug 并查询 team
    const teamSlug = idToSlug("team", new MuseDAMID(musedamTeamId));
    const team = await prisma.team.findUnique({
      where: { slug: teamSlug },
    });

    // 团队不存在
    if (!team) {
      return NextResponse.json({ success: false, error: "Team not found" }, { status: 404 });
    }

    const settings = await getTaggingSettings(team.id);

    // 检查是否开启了打标功能
    if (!settings.isTaggingEnabled) {
      return NextResponse.json({
        success: true,
        data: {
          message: "Tagging is disabled for this team",
          totalAssets: 0,
          enqueuedTasks: 0,
          failedTasks: 0,
          taskType: "scheduled",
        },
      });
    }

    // 检查是否开启了定时打标
    if (!settings.triggerTiming.scheduledTagging) {
      return NextResponse.json({
        success: true,
        data: {
          message: "Scheduled tagging is not enabled",
          totalAssets: 0,
          enqueuedTasks: 0,
          failedTasks: 0,
          taskType: "scheduled",
        },
      });
    }

    // 批量发起打标
    const result = await processBatchTagging({
      team,
      settings,
      assetIds,
      batchSize,
    });

    // 返回结果
    if (result.success) {
      return NextResponse.json({
        success: true,
        data: {
          message: "Scheduled tagging completed",
          totalAssets: result.totalAssets,
          enqueuedTasks: result.enqueuedTasks,
          failedTasks: result.failedTasks,
          taskType: "scheduled",
        },
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.errors.join("; "),
      }, { status: 400 });
    }
  } catch (error) {
    console.error("API request failed:", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request format",
          details: error.issues,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}

/**
 * 批量处理打标任务
 */
async function processBatchTagging({
  team,
  settings,
  assetIds,
  batchSize = 100,
}: {
  team: { id: number; slug: string };
  settings: TaggingSettingsData;
  assetIds?: number[];
  batchSize?: number;
}): Promise<{
  success: boolean;
  totalAssets: number;
  enqueuedTasks: number;
  failedTasks: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let totalAssets = 0;
  let enqueuedTasks = 0;
  let failedTasks = 0;

  try {
    // 获取要处理的资产列表
    let targetAssetIds: number[] = [];

    if (assetIds && assetIds.length > 0) {
      // 如果指定了具体的资产ID列表，直接使用
      targetAssetIds = assetIds;
    } else {
      // 查询符合条件的资产对象
      const whereCondition: any = {
        teamId: team.id,
      };

      const assetObjects = await prisma.assetObject.findMany({
        where: whereCondition,
        select: { id: true, extra: true },
        take: batchSize * 10, // 获取更多资产以便后续过滤
      });

      // 从 extra 字段中提取 MuseDAMID
      targetAssetIds = assetObjects
        .map((asset) => {
          const extra = asset.extra as any;
          return extra?.id ? Number(extra.id) : null;
        })
        .filter((id): id is number => id !== null && id > 0)
        .slice(0, batchSize); // 限制批次大小
    }

    totalAssets = targetAssetIds.length;

    // 步骤1: 先同步所有资产，获取 AssetObject 信息
    const syncPromises = targetAssetIds.map(async (musedamAssetId) => {
      try {
        const result = await syncSingleAssetFromMuseDAM({
          musedamAssetId: new MuseDAMID(musedamAssetId),
          team,
        });
        return { success: true, musedamAssetId, ...result };
      } catch (error) {
        const errorMessage = `Failed to sync asset ${musedamAssetId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        return { success: false, musedamAssetId, error: errorMessage };
      }
    });

    const syncResults = await Promise.allSettled(syncPromises);
    const successfulSyncs = syncResults
      .filter((result): result is PromiseFulfilledResult<any> => 
        result.status === "fulfilled" && result.value.success
      )
      .map(result => result.value);

    // 步骤2: 批量查询已存在的队列项，避免重复创建任务
    const assetObjectIds = successfulSyncs.map(sync => sync.assetObject.id);
    const existingQueueItems = await prisma.taggingQueueItem.findMany({
      where: {
        teamId: team.id,
        assetObjectId: {
          in: assetObjectIds,
        },
        status: {
          in: ["pending", "processing"], // 只检查进行中的任务
        },
      },
      select: {
        assetObjectId: true,
      },
    });

    const existingAssetObjectIds = new Set(existingQueueItems.map(item => item.assetObjectId));

    // 步骤3: 过滤掉已存在队列项的资产
    const validSyncs = successfulSyncs.filter(sync => 
      !existingAssetObjectIds.has(sync.assetObject.id)
    );

    // 步骤4: 批量处理有效资产（创建打标任务）
    const processingPromises = validSyncs.map(async (sync) => {
      try {
        const { assetObject, musedamAsset } = sync;

        // 检查是否在应用范围内
        if (settings.applicationScope.scopeType !== "all") {
          const musedamFolderIds: MuseDAMID[] = settings.applicationScope.selectedFolders.map(
            (folder) => slugToId("assetFolder", folder.slug),
          );
          const hasIntersection = musedamAsset.parentIds.some((parentId: string | number) =>
            musedamFolderIds.some((folderId) => folderId.toString() === String(parentId)),
          );
          
          if (!hasIntersection) {
            return { success: false, reason: "Asset not in selected folders" };
          }
        }

        // 创建打标任务
        await enqueueTaggingTask({
          assetObject,
          matchingSources: settings.matchingSources,
          recognitionAccuracy: settings.recognitionAccuracy,
          taskType: "default",
        });

        return { success: true };
      } catch (error) {
        const errorMessage = `Failed to process asset ${sync.musedamAssetId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        errors.push(errorMessage);
        return { success: false, reason: errorMessage };
      }
    });

    // 统计同步失败的数量
    const syncFailures = syncResults
      .filter((result): result is PromiseFulfilledResult<any> => 
        result.status === "fulfilled" && !result.value.success
      ).length;

    const rejectedSyncs = syncResults
      .filter((result): result is PromiseRejectedResult => 
        result.status === "rejected"
      ).length;

    // 统计跳过（已存在队列项）的数量
    const skippedTasks = successfulSyncs.length - validSyncs.length;

    // console.log("tasks",skippedTasks)
    // 等待所有处理完成
    const results = await Promise.allSettled(processingPromises);

    // 统计结果
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        if (result.value.success) {
          enqueuedTasks++;
        } else {
          failedTasks++;
        }
      } else {
        failedTasks++;
        errors.push(`Promise rejected: ${result.reason}`);
      }
    });

    // 添加同步失败的错误信息
    if (syncFailures > 0 || rejectedSyncs > 0) {
      errors.push(`${syncFailures + rejectedSyncs} assets failed to sync`);
    }

    return {
      success: errors.length === 0 || enqueuedTasks > 0,
      totalAssets,
      enqueuedTasks,
      failedTasks,
      errors,
    };
  } catch (error) {
    const errorMessage = `Batch processing failed: ${
      error instanceof Error ? error.message : "Unknown error"
    }`;
    return {
      success: false,
      totalAssets,
      enqueuedTasks,
      failedTasks,
      errors: [...errors, errorMessage],
    };
  }
}