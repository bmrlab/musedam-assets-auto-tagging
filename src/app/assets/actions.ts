"use server";
import { predictAssetTags } from "@/ai/tagging";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { AssetObject, Tag } from "@/prisma/client";
import prisma from "@/prisma/prisma";

interface TagWithChildren extends Tag {
  children?: TagWithChildren[];
}

interface TagPrediction {
  tagPath: string[];
  confidence: number;
  source: string[];
}

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

export async function predictAssetTagsAction(assetId: number): Promise<
  ServerActionResult<{
    predictions: TagPrediction[];
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 获取资产信息
      const asset = await prisma.assetObject.findFirst({
        where: { id: assetId, teamId },
      });

      if (!asset) {
        return {
          success: false,
          message: "资产不存在或无权限访问",
        };
      }

      // 获取团队的所有标签
      const tags = await prisma.tag.findMany({
        where: { teamId },
        orderBy: [{ level: "asc" }, { name: "asc" }],
        include: {
          parent: true,
          children: {
            orderBy: { name: "asc" },
            include: {
              children: {
                orderBy: { name: "asc" },
              },
            },
          },
        },
      });

      // 调用AI预测函数
      const predictions = await predictAssetTags(asset, tags as TagWithChildren[]);

      return {
        success: true,
        data: { predictions },
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
