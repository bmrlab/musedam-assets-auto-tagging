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

      // 先获取总数 - 需要排除 rejected 状态的审核项
      const totalAuditItemWhere: Prisma.TaggingAuditItemWhereInput = {
        ...auditItemWhere,
      };
      
      // 如果没有指定状态过滤，则排除 rejected 状态
      if (!statusFilter) {
        totalAuditItemWhere.status = { not: "rejected" };
      }
      
      const distinctAssetIds = await prisma.taggingAuditItem.findMany({
        where: totalAuditItemWhere,
        select: {
          assetObjectId: true,
        },
        distinct: ["assetObjectId"],
      });
      const totalCount = distinctAssetIds.length;

      // 获取有审核项的资产ID - 也需要排除 rejected 状态
      const assetObjectIds = (
        await prisma.taggingAuditItem.findMany({
          where: totalAuditItemWhere,
          select: {
            assetObjectId: true,
          },
          distinct: ["assetObjectId"],
          orderBy: {
            queueItem: { createdAt: "desc" },
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
          // 过滤掉状态为 rejected 的审核项
          if (taggingAuditItem.status === "rejected") continue;

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
        // 过滤掉没有审核项的 batch（所有审核项都被过滤掉了）
        const filteredBatch = batch.filter((group) => group.taggingAuditItems.length > 0);

        // 将同一资产内的不同队列分组按创建时间降序排序（最新在前）
        filteredBatch.sort((a, b) => {
          const ta = new Date(a.queueItem.createdAt).getTime();
          const tb = new Date(b.queueItem.createdAt).getTime();
          return tb - ta;
        });

        // 只有当有有效的 batch 时才添加到结果中
        if (filteredBatch.length > 0) {
          results.push({
            assetObject,
            batch: filteredBatch,
          });
        }
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
  
    // 判断素材是否还在素材库
   await syncSingleAssetFromMuseDAM({
      musedamAssetId,
      team,
    });

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

    return {
      success: true,
      data: undefined,
    };
  });
}

export async function rejectAuditItemsAction({
  assetObject,
}: {
  assetObject: AssetObject;
}): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      await prisma.$transaction(async (tx) => {
        // 将该素材的所有待审核 的 AI 推荐标签都标记为 rejected
        await tx.taggingAuditItem.updateMany({
          where: {
            teamId,
            assetObjectId: assetObject.id,
            status: {
              in: ["pending"],
            },
          },
          data: {
            status: "rejected",
          },
        });
      });

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      console.error("删除 AI 打标记录失败:", error);
      return {
        success: false,
        message: "删除 AI 打标记录失败",
      };
    }
  });
}

export async function batchApproveAuditItemsAction({
  assetObjects,
  append = true,
}: {
  assetObjects: AssetObject[];
  append?: boolean;
}): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const team = await prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { id: true, slug: true },
      });

      // 获取所有待审核的审核项
      const auditItems = await prisma.taggingAuditItem.findMany({
        where: {
          teamId,
          assetObjectId: { in: assetObjects.map(a => a.id) },
          status: "pending",
          leafTagId: { not: null },
        },
        include: {
          assetObject: true,
        },
      });
      // 按资产分组处理
      for (const assetObject of assetObjects) {
        const assetAuditItems = auditItems.filter(item => item.assetObjectId === assetObject.id);
        
        if (assetAuditItems.length === 0) continue;
        const musedamAssetId = slugToId("assetObject", assetObject.slug);

        try{
          await syncSingleAssetFromMuseDAM({
            musedamAssetId,
            team,
          });
        }catch(error){
          if(error instanceof Error && error.message === 'Asset not found'){
            await rejectAuditItemsAction({ assetObject });
            continue;
          }
          // 如果是其他错误，重新抛出
          throw error;
        }
        const approvedAssetTags = await prisma.assetTag.findMany({
          where: {
            id: {
              in: assetAuditItems.map(item => item.leafTagId!),
            },
            slug: {
              not: null,
            },
          },
          select: { id: true, slug: true },
        });
        const musedamTagIds = approvedAssetTags.map((tag) => slugToId("assetTag", tag.slug!));
       
        await setAssetTagsToMuseDAM({
          musedamAssetId,
          musedamTagIds,
          team,
          append,
        });

        await prisma.$transaction(async (tx) => {
          await tx.taggingAuditItem.updateMany({
            where: {
              id: { in: assetAuditItems.map(item => item.id) },
            },
            data: { status: "approved" },
          });
        });
      }

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      console.error("批量添加失败:", error);
      return {
        success: false,
        message: "批量添加失败",
      };
    }
  });
}

export async function batchRejectAuditItemsAction({
  assetObjects,
}: {
  assetObjects: AssetObject[];
}): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      await prisma.$transaction(async (tx) => {
        // 将选中素材的所有待审核的 AI 推荐标签都标记为 rejected
        await tx.taggingAuditItem.updateMany({
          where: {
            teamId,
            assetObjectId: { in: assetObjects.map(a => a.id) },
            status: {
              in: ["pending"],
            },
          },
          data: {
            status: "rejected",
          },
        });
      });

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      console.error("批量删除 AI 打标记录失败:", error);
      return {
        success: false,
        message: "批量删除 AI 打标记录失败",
      };
    }
  });
}
