"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { AssetObject, TaggingAuditItem } from "@/prisma/client";
import prisma from "@/prisma/prisma";

type TaggingAuditStatus = "pending" | "approved" | "rejected";

export interface ReviewStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export type AssetWithAuditItems = AssetObject & {
  taggingAuditItems: (Omit<TaggingAuditItem, "tagPath"> & { tagPath: string[] })[];
};

export async function fetchReviewStats(): Promise<
  ServerActionResult<{
    stats: ReviewStats;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const [total, pending, approved, rejected] = await Promise.all([
        prisma.taggingAuditItem.count({
          where: { teamId },
        }),
        prisma.taggingAuditItem.count({
          where: { teamId, status: "pending" },
        }),
        prisma.taggingAuditItem.count({
          where: { teamId, status: "approved" },
        }),
        prisma.taggingAuditItem.count({
          where: { teamId, status: "rejected" },
        }),
      ]);

      const stats: ReviewStats = {
        total,
        pending,
        approved,
        rejected,
      };

      return {
        success: true,
        data: { stats },
      };
    } catch (error) {
      console.error("获取审核统计失败:", error);
      return {
        success: false,
        message: "获取统计数据失败",
      };
    }
  });
}

export async function fetchAssetsWithAuditItems(
  page: number = 1,
  limit: number = 20,
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

      // 构建查询条件
      const auditItemWhere: Record<string, unknown> = {
        teamId,
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
            auditItemWhere.score = { gte: 60, lt: 80 };
            break;
          case "low":
            auditItemWhere.score = { lt: 60 };
            break;
        }
      }

      // 先获取有审核项的资产ID
      const auditItems = await prisma.taggingAuditItem.findMany({
        where: auditItemWhere,
        select: {
          assetObjectId: true,
        },
        distinct: ["assetObjectId"],
      });

      const assetIds = auditItems.map((item) => item.assetObjectId);

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

      // 构建资产查询条件
      const assetWhere: Record<string, unknown> = {
        teamId,
        id: { in: assetIds },
      };

      if (searchQuery) {
        assetWhere.OR = [
          { name: { contains: searchQuery, mode: "insensitive" } },
          { description: { contains: searchQuery, mode: "insensitive" } },
          { materializedPath: { contains: searchQuery, mode: "insensitive" } },
        ];
      }

      const [assets, totalCount] = await Promise.all([
        prisma.assetObject.findMany({
          where: assetWhere,
          include: {
            taggingAuditItems: {
              orderBy: [{ score: "desc" }, { createdAt: "desc" }],
            },
          },
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
        }),
        prisma.assetObject.count({
          where: assetWhere,
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

export async function updateAuditItemStatus(
  auditItemId: number,
  status: TaggingAuditStatus,
): Promise<ServerActionResult<object>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const auditItem = await prisma.taggingAuditItem.findFirst({
        where: { id: auditItemId, teamId },
      });

      if (!auditItem) {
        return {
          success: false,
          message: "审核项不存在或无权限操作",
        };
      }

      await prisma.taggingAuditItem.update({
        where: { id: auditItemId },
        data: { status },
      });

      return {
        success: true,
        data: {},
      };
    } catch (error) {
      console.error("更新审核状态失败:", error);
      return {
        success: false,
        message: "更新状态失败",
      };
    }
  });
}

export async function batchUpdateAuditItemStatus(
  auditItemIds: number[],
  status: TaggingAuditStatus,
): Promise<ServerActionResult<object>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      await prisma.taggingAuditItem.updateMany({
        where: {
          id: { in: auditItemIds },
          teamId,
        },
        data: { status },
      });

      return {
        success: true,
        data: {},
      };
    } catch (error) {
      console.error("批量更新审核状态失败:", error);
      return {
        success: false,
        message: "批量更新状态失败",
      };
    }
  });
}
