import { enqueueTaggingTask } from "@/app/(tagging)/queue";
import { getTaggingSettings } from "@/app/(tagging)/tagging/settings/lib";
import { idToSlug, slugToId } from "@/lib/slug";
import { fetchMuseDAMFolderSubIds, syncSingleAssetFromMuseDAM } from "@/musedam/assets";
import { MuseDAMID } from "@/musedam/types";
import { AssetObject } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  teamId: z.coerce.bigint().positive(),
  assetId: z.coerce.bigint().positive(),
  matchingSources: z
    .object({
      basicInfo: z.boolean(),
      materializedPath: z.boolean(),
      contentAnalysis: z.boolean(),
      tagKeywords: z.boolean(),
    })
    .optional()
    .default({
      basicInfo: true,
      materializedPath: true,
      contentAnalysis: true,
      tagKeywords: true,
    }),
  triggerType: z.enum(["default", "manual", "scheduled"]).optional().default("default"),
  recognitionAccuracy: z.enum(["precise", "balanced", "broad"]).optional().default("balanced"),
});

export async function POST(request: NextRequest) {
  try {
    // 解析请求体
    const body = await request.json();
    const {
      teamId: musedamTeamId,
      assetId: musedamAssetId,
      matchingSources,
      recognitionAccuracy,
      triggerType
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

    // 未开启自动打标；且发起的是自动打标任务；不进入队列
    if(!settings.triggerTiming.autoRealtimeTagging && triggerType === "default"){
      return NextResponse.json({
        success: true,
        data: {
          message: "Tagging auto realtime is not enabled",
          queueItemId: null,
          status: null,
        },
      });
    }

    // 1. 从 MuseDAM 同步素材到本地数据库
    let assetObject: AssetObject;
    let musedamAsset: { parentIds: MuseDAMID[] };
    try {
      ({ assetObject, musedamAsset } = await syncSingleAssetFromMuseDAM({
        musedamAssetId: new MuseDAMID(musedamAssetId),
        team,
      }));
    } catch (error) {
      console.error("Failed to sync asset from MuseDAM:", error);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to sync asset ${musedamAssetId}: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
        { status: 400 },
      );
    }

    if (settings.applicationScope.scopeType !== "all") {  
      // 获取到selectedFolders 和其子文件夹
      const selectedFolderIds = settings.applicationScope.selectedFolders.map(folder => slugToId("assetFolder", folder.slug))
      const musedamFolderSubIds = await fetchMuseDAMFolderSubIds({
        team,
        musedamFolderIds: selectedFolderIds,
      });

      // 简化：允许集合 = 选中目录 + 每个选中目录的子目录（来自返回的 map 键和值）
      const allowedFolderIdSet = new Set<string>(selectedFolderIds.map((id) => id.toString()));
      for (const [folderIdStr, subIds] of Object.entries(
        musedamFolderSubIds as unknown as Record<string, (number | string)[]>,
      )) {
        allowedFolderIdSet.add(folderIdStr);
        for (const subId of subIds) allowedFolderIdSet.add(String(subId));
      }

      // 检查素材所在父目录是否在允许集合内
      const hasIntersection = musedamAsset.parentIds.some((parentId) =>
        allowedFolderIdSet.has(String(parentId)),
      );

      if (!hasIntersection) {
        return NextResponse.json(
          {
            success: true,
            data: {
              message: `Asset ${musedamAssetId} is not in the selected folders`,
              queueItemId: null,
              status: null,
            },
          },
          { status: 202 },
        );
      }
    }

    // 2. 发起 AI 打标任务
    try {
      const taggingQueueItem = await enqueueTaggingTask({
        assetObject,
        matchingSources,
        recognitionAccuracy,
      });

      return NextResponse.json({
        success: true,
        data: {
          message: "Asset tagging task enqueued successfully",
          queueItemId: taggingQueueItem.id,
          status: taggingQueueItem.status,
        },
      });
    } catch (error) {
      console.error("Failed to enqueue tagging task:", error);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to start tagging task: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
        { status: 500 },
      );
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
