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

export interface AssetWithAuditItems extends AssetObject {
  TaggingAuditItem: (TaggingAuditItem & {
    leafTag: {
      id: number;
      name: string;
      level: number;
      parent?: {
        id: number;
        name: string;
        parent?: {
          id: number;
          name: string;
        };
      } | null;
    };
  })[];
}

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
      const auditItemWhere: any = {
        teamId,
      };

      if (statusFilter) {
        auditItemWhere.status = statusFilter;
      }

      if (confidenceFilter) {
        switch (confidenceFilter) {
          case "high":
            auditItemWhere.confidence = { gte: 0.8 };
            break;
          case "medium":
            auditItemWhere.confidence = { gte: 0.6, lt: 0.8 };
            break;
          case "low":
            auditItemWhere.confidence = { lt: 0.6 };
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
      const assetWhere: any = {
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
            TaggingAuditItem: {
              where: auditItemWhere,
              include: {
                leafTag: {
                  include: {
                    parent: {
                      include: {
                        parent: true,
                      },
                    },
                  },
                },
              },
              orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
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
): Promise<ServerActionResult<{}>> {
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
): Promise<ServerActionResult<{}>> {
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
