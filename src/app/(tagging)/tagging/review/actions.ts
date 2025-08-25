"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { slugToId } from "@/lib/slug";
import { setAssetTagsToMuseDAM, syncSingleAssetFromMuseDAM } from "@/musedam/assets";
import { AssetObject, Prisma, TaggingAuditItem, TaggingAuditStatus } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export type AssetWithAuditItems = AssetObject & {
  taggingAuditItems: (Omit<TaggingAuditItem, "tagPath"> & { tagPath: string[] })[];
};

export async function fetchAssetsWithAuditItems(
  page: number = 1,
  limit: number = 10,
  statusFilter?: TaggingAuditStatus,
  confidenceFilter?: "high" | "medium" | "low",
  searchQuery?: string,
): Promise<
  ServerActionResult<{
    assets: AssetWithAuditItems[];
    total: number;
    hasMore: boolean;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const offset = (page - 1) * limit;

      const auditItemWhere: Prisma.TaggingAuditItemWhereInput = {
        teamId,
        assetObjectId: {
          not: null,
        },
      };

      if (statusFilter) {
        auditItemWhere.status = statusFilter;
      }

      if (confidenceFilter) {
        switch (confidenceFilter) {
          case "high":
            auditItemWhere.score = { gte: 80 };
          case "medium":
            auditItemWhere.score = { gte: 70, lt: 80 };
          case "low":
            auditItemWhere.score = { lt: 70 };
        }
      }

      if (searchQuery) {
        auditItemWhere.assetObject = {
          OR: [
            { name: { contains: searchQuery, mode: "insensitive" } },
            { description: { contains: searchQuery, mode: "insensitive" } },
            { materializedPath: { contains: searchQuery, mode: "insensitive" } },
          ],
        };
      }

      // 先获取有审核项的资产ID
      const assetIds = (
        await prisma.taggingAuditItem.findMany({
          where: auditItemWhere,
          select: {
            assetObjectId: true,
          },
          distinct: ["assetObjectId"],
          orderBy: {
            id: "desc",
          },
          skip: offset,
          take: limit,
        })
      ).map((item) => item.assetObjectId!);

      if (assetIds.length === 0) {
        return {
          success: true,
          data: {
            assets: [],
            total: 0,
            hasMore: false,
          },
        };
      }

      // assetIds 已经过滤好，也限制了数量，这里可以直接使用了
      const [assets, totalCount] = await Promise.all([
        prisma.assetObject.findMany({
          where: { teamId, id: { in: assetIds } },
          include: {
            taggingAuditItems: {
              orderBy: [{ score: "desc" }, { createdAt: "desc" }],
            },
          },
        }),
        prisma.assetObject.count({
          where: { teamId, id: { in: assetIds } },
        }),
      ]);

      const hasMore = offset + assets.length < totalCount;

      return {
        success: true,
        data: {
          assets: assets as AssetWithAuditItems[],
          total: totalCount,
          hasMore,
        },
      };
    } catch (error) {
      console.error("获取审核资产失败:", error);
      return {
        success: false,
        message: "获取审核数据失败",
      };
    }
  });
}

export async function approveAuditItemsAction({
  assetWithAuditItems,
  append = true,
}: {
  assetWithAuditItems: AssetWithAuditItems;
  append?: boolean;
}): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { id: true, slug: true },
    });

    const musedamAssetId = parseInt(slugToId("assetObject", assetWithAuditItems.slug));
    const assetTags = await prisma.assetTag.findMany({
      where: {
        id: {
          in: assetWithAuditItems.taggingAuditItems
            .filter((item) => item.leafTagId)
            .map((item) => item.leafTagId!),
        },
        slug: {
          not: null,
        },
      },
      select: { id: true, slug: true },
    });

    const musedamTagIds = assetTags.map((tag) => parseInt(slugToId("assetTag", tag.slug!)));

    await setAssetTagsToMuseDAM({
      musedamAssetId,
      musedamTagIds,
      team,
      append,
    });

    await syncSingleAssetFromMuseDAM({
      musedamAssetId,
      team,
    });

    return {
      success: true,
      data: undefined,
    };
  });
}
