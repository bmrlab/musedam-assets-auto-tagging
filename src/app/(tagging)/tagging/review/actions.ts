"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { slugToId } from "@/lib/slug";
import { setAssetTagsToMuseDAM, syncSingleAssetFromMuseDAM } from "@/musedam/assets";
import {
  AssetObject,
  Prisma,
  TaggingAuditItem,
  TaggingAuditStatus,
  TaggingQueueItem,
} from "@/prisma/client";
import prisma from "@/prisma/prisma";

export type AssetWithAuditItemsBatch = {
  assetObject: AssetObject;
  batch: {
    queueItem: TaggingQueueItem;
    taggingAuditItems: (Omit<TaggingAuditItem, "tagPath"> & { tagPath: string[] })[];
  }[];
  onSuccess?: () => void;
};

export async function fetchAssetsWithAuditItems(
  page: number = 1,
  limit: number = 10,
  statusFilter?: TaggingAuditStatus,
  confidenceFilter?: "high" | "medium" | "low",
  searchQuery?: string,
  timeFilter?: "all" | "today" | "week" | "month",
): Promise<
  ServerActionResult<{
    assets: AssetWithAuditItemsBatch[];
    total: number;
    hasMore: boolean;
    currentPage: number;
    totalPages: number;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const offset = (page - 1) * limit;

      const auditItemWhere: Prisma.TaggingAuditItemWhereInput = {
        teamId,
        assetObjectId: { not: null },
        queueItemId: { not: null },
      };

      if (statusFilter) {
        auditItemWhere.status = statusFilter;
      }

      if (confidenceFilter) {
        switch (confidenceFilter) {
          case "high":
            auditItemWhere.score = { gte: 80 };
            break;
          case "medium":
            auditItemWhere.score = { gte: 70, lt: 80 };
            break;
          case "low":
            auditItemWhere.score = { lt: 70 };
            break;
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

      // 添加时间筛选逻辑
      if (timeFilter && timeFilter !== "all") {
        const now = new Date();
        let startDate: Date;

        switch (timeFilter) {
          case "today":
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case "week":
            startDate = new Date(now);
            startDate.setDate(now.getDate() - now.getDay());
            startDate.setHours(0, 0, 0, 0);
            break;
          case "month":
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          default:
            startDate = new Date(0); // 默认不限制
        }

        auditItemWhere.queueItem = {
          createdAt: {
            gte: startDate,
          },
        };
      }

      // 先获取总数 - 使用 findMany 然后计算去重后的数量
      const distinctAssetIds = await prisma.taggingAuditItem.findMany({
        where: auditItemWhere,
        select: {
          assetObjectId: true,
        },
        distinct: ["assetObjectId"],
      });
      const totalCount = distinctAssetIds.length;

      // 获取有审核项的资产ID
      const assetObjectIds = (
        await prisma.taggingAuditItem.findMany({
          where: auditItemWhere,
          select: {
            assetObjectId: true,
          },
          distinct: ["assetObjectId"],
          orderBy: {
            queueItem: { id: "desc" },
          },
          skip: offset,
          take: limit,
        })
      ).map((item) => item.assetObjectId!);

      const totalPages = Math.ceil(totalCount / limit);
      const hasMore = page < totalPages;

      if (assetObjectIds.length === 0) {
        return {
          success: true,
          data: {
            assets: [],
            total: totalCount,
            hasMore: false,
            currentPage: page,
            totalPages,
          },
        };
      }

      // assetIds 已经过滤好，也限制了数量，这里可以直接使用了
      const assetObjects = await prisma.assetObject.findMany({
        where: { teamId, id: { in: assetObjectIds } },
        include: {
          taggingAuditItems: {
            include: {
              queueItem: true,
            },
            orderBy: [{ score: "desc" }, { createdAt: "desc" }],
          },
        },
      });

      const results: AssetWithAuditItemsBatch[] = [];

      for (const assetObjectId of assetObjectIds) {
        const assetObject = assetObjects.find(({ id }) => id === assetObjectId);
        if (!assetObject) continue;
        const batch: AssetWithAuditItemsBatch["batch"] = [];
        for (const { queueItem, tagPath, ...taggingAuditItem } of assetObject.taggingAuditItems) {
          if (!queueItem) continue;
          let group = batch.find((group) => group.queueItem.id === queueItem.id);
          if (!group) {
            group = { queueItem, taggingAuditItems: [] };
            batch.push(group);
          }
          group.taggingAuditItems.push({
            tagPath: tagPath as string[],
            ...taggingAuditItem,
          });
        }
        results.push({
          assetObject,
          batch,
        });
      }

      return {
        success: true,
        data: {
          assets: results,
          total: totalCount,
          hasMore,
          currentPage: page,
          totalPages,
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
  assetObject,
  auditItems,
  append = true,
}: {
  assetObject: AssetObject;
  auditItems: {
    id: number;
    leafTagId: number | null;
    status: TaggingAuditStatus;
  }[];
  append?: boolean;
}): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { id: true, slug: true },
    });

    const musedamAssetId = slugToId("assetObject", assetObject.slug);
    const approvedAsetTags = await prisma.assetTag.findMany({
      where: {
        id: {
          in: auditItems
            .filter(({ leafTagId, status }) => leafTagId && status === "approved")
            .map(({ leafTagId }) => leafTagId!),
        },
        slug: {
          not: null,
        },
      },
      select: { id: true, slug: true },
    });
    const musedamTagIds = approvedAsetTags.map((tag) => slugToId("assetTag", tag.slug!));
    await setAssetTagsToMuseDAM({
      musedamAssetId,
      musedamTagIds,
      team,
      append,
    });

    await prisma.$transaction(async (tx) => {
      for (const { id, status } of auditItems) {
        await tx.taggingAuditItem.update({
          where: { id },
          data: { status },
        });
      }
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
