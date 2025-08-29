import { enqueueTaggingTask } from "@/app/(tagging)/queue";
import { getTaggingSettings } from "@/app/(tagging)/tagging/settings/lib";
import { idToSlug, slugToId } from "@/lib/slug";
import { syncSingleAssetFromMuseDAM } from "@/musedam/assets";
import { AssetObject } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  teamId: z.number().int().positive(),
  assetId: z.number().int().positive(),
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
    } = requestSchema.parse(body);

    // 根据 teamId 构造 team slug 并查询 team
    const teamSlug = idToSlug("team", musedamTeamId);
    const team = await prisma.team.findUnique({
      where: { slug: teamSlug },
    });

    if (!team) {
      return NextResponse.json({ success: false, error: "Team not found" }, { status: 404 });
    }

    // 1. 从 MuseDAM 同步素材到本地数据库
    let assetObject: AssetObject;
    let musedamAsset: { parentIds: number[] };
    try {
      ({ assetObject, musedamAsset } = await syncSingleAssetFromMuseDAM({
        musedamAssetId,
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

    const settings = await getTaggingSettings(team.id);
    if (settings.applicationScope.scopeType !== "all") {
      // 检查 selectedFolders 和 parentIds 的 id 是否有交集
      const musedamFolderIds: number[] = settings.applicationScope.selectedFolders.map((folder) =>
        slugToId("assetFolder", folder.slug),
      );
      const hasIntersection = musedamAsset.parentIds.some((parentId) =>
        musedamFolderIds.includes(parentId),
      );
      if (!hasIntersection) {
        return NextResponse.json(
          {
            success: true,
            data: {
              message: `Asset ${musedamAssetId} is not in the selected folders`,
              queueItemId: null,
              status: "not_in_selected_folders",
            },
          },
          { status: 201 },
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
