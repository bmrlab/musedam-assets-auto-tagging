"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { getBrandRecommendationFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { recordContentOnlyRejectionFeedbackBatch } from "@/app/(tagging)/evidence-policy-server";
import { getIpRecommendationFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import { recordKeywordRejectionFeedbackBatch } from "@/app/(tagging)/keyword-feedback";
import { getPersonRecommendationFromQueueResult } from "@/app/(tagging)/person-recommendation";
import { getProductRecommendationFromQueueResult } from "@/app/(tagging)/product-recommendation";
import {
  FeatureLibraryFeatures,
  filterFeatureLibraryRecommendations,
  isFeatureTypeEnabled,
} from "@/lib/feature-library";
import { getServerFeatureLibraryFeatures } from "@/lib/feature-library-server";
import { ServerActionResult } from "@/lib/serverAction";
import { idToSlug, slugToId } from "@/lib/slug";
import { retrieveTeamCredentials } from "@/musedam/apiKey";
import {
  batchSyncAssetThumbnails,
  bindFeatureMaterialToMuseDAM,
  getFeatureByAssetFromMuseDAM,
  setAssetTagsToMuseDAM,
  syncSingleAssetFromMuseDAM,
} from "@/musedam/assets";
import { requestMuseDAMAPI } from "@/musedam/lib";
import type { MuseDAMMaterialFeatureSnapshot } from "@/musedam/query-features-by-materials-types";
import { MuseDAMID } from "@/musedam/types";
import {
  AssetObject,
  AssetObjectTags,
  Prisma,
  TaggingAuditItem,
  TaggingAuditStatus,
  TaggingQueueItem,
  TaggingQueueItemResult,
} from "@/prisma/client";
import prisma from "@/prisma/prisma";
import {
  createFeatureReviewSnapshot,
  FEATURE_REVIEW_CHANGED,
  getFeatureReviewVersion,
  getReviewedFeatureResult,
  hydrateReviewFeatures,
  selectReviewFeatures,
  type FeatureReviewVersions,
} from "./feature-review";
import { loadReviewFeatureLibrary } from "./feature-review-server";

export type ReviewAvailableFeatureIds = {
  brand: string[];
  ip: string[];
  product: string[];
  person: string[];
};

function hasEnabledFeatureRecommendation(
  result: Prisma.JsonValue,
  features: FeatureLibraryFeatures,
) {
  return Boolean(
    (features.featureBrand && getBrandRecommendationFromQueueResult(result)) ||
      (features.featureIp && getIpRecommendationFromQueueResult(result)) ||
      (features.featureProduct && getProductRecommendationFromQueueResult(result)) ||
      (features.featurePerson && getPersonRecommendationFromQueueResult(result)),
  );
}

// 辅助函数：从 MuseDAM 标签构建 AssetObjectTags
async function buildAssetObjectTags(
  musedamTags: { id: MuseDAMID; name: string }[],
): Promise<AssetObjectTags> {
  const tagSlugs = musedamTags.map(({ id: musedamTagId }) => idToSlug("assetTag", musedamTagId));
  const fields = { id: true, slug: true, name: true };
  const assetTags = await prisma.assetTag.findMany({
    where: {
      slug: { in: tagSlugs },
    },
    select: {
      ...fields,
      parent: {
        select: {
          ...fields,
          parent: {
            select: { ...fields },
          },
        },
      },
    },
  });
  return assetTags.map((tag) => ({
    tagId: tag.id,
    tagSlug: tag.slug!, // 因为有 where { slug }，这里不可能为空
    tagPath: [tag.parent?.parent?.name, tag.parent?.name, tag.name].filter(
      (item) => item !== undefined,
    ),
  }));
}

export type AssetWithAuditItemsBatch = {
  assetObject: AssetObject;
  existingFeatures: MuseDAMMaterialFeatureSnapshot[];
  availableFeatureIds: ReviewAvailableFeatureIds;
  batch: {
    queueItem: TaggingQueueItem;
    taggingAuditItems: (Omit<TaggingAuditItem, "tagPath"> & { tagPath: string[] })[];
  }[];
  onSuccess?: () => void;
};

type BatchApproveAssetRef = Pick<AssetObject, "id" | "slug"> & {
  featureReviewVersions: FeatureReviewVersions;
  rejectedFeatureKeys: string[];
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
  return withAuth(async ({ team: { id: teamId, slug: teamSlug } }) => {
    try {
      const featureLibraryFeatures = await getServerFeatureLibraryFeatures();
      const hasEnabledFeatures =
        featureLibraryFeatures.featureBrand ||
        featureLibraryFeatures.featureIp ||
        featureLibraryFeatures.featureProduct ||
        featureLibraryFeatures.featurePerson;
      const offset = (page - 1) * limit;

      const auditItemWhere: Prisma.TaggingAuditItemWhereInput = {
        teamId,
        assetObjectId: { not: null },
        queueItemId: { not: null },
      };
      if (!hasEnabledFeatures) {
        auditItemWhere.leafTagId = { not: null };
      }

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

      // 批量同步资产缩略图URL（防止签名过期）
      const team = { id: teamId, slug: teamSlug };
      const musedamAssetIds = assetObjects
        .map((assetObject) => {
          try {
            return slugToId("assetObject", assetObject.slug);
          } catch {
            return null;
          }
        })
        .filter((id): id is NonNullable<typeof id> => id !== null);

      if (musedamAssetIds.length > 0) {
        await batchSyncAssetThumbnails({
          musedamAssetIds,
          team,
        }).catch((error) => {
          // 同步失败不影响主流程，只记录错误
          console.error("批量同步资产缩略图失败:", error);
        });
      }

      // 重新查询更新后的资产列表，保持原有顺序
      const updatedAssetObjectsMap = new Map(
        (
          await prisma.assetObject.findMany({
            where: { teamId, id: { in: assetObjectIds } },
            include: {
              taggingAuditItems: {
                include: {
                  queueItem: true,
                },
                orderBy: [{ score: "desc" }, { createdAt: "desc" }],
              },
            },
          })
        ).map((assetObject) => [assetObject.id, assetObject]),
      );

      // 按照原来的顺序重新组装资产列表
      const updatedAssetObjects = assetObjectIds
        .map((id) => updatedAssetObjectsMap.get(id))
        .filter(
          (assetObject): assetObject is NonNullable<typeof assetObject> =>
            assetObject !== undefined,
        );

      const featureLibrary = await loadReviewFeatureLibrary(
        teamId,
        updatedAssetObjects.flatMap((asset) =>
          asset.taggingAuditItems.flatMap(({ queueItem }) => (queueItem ? [queueItem.result] : [])),
        ),
        featureLibraryFeatures,
      );
      const availableFeatureIds: ReviewAvailableFeatureIds = {
        brand: [],
        ip: [],
        product: [],
        person: [],
      };
      for (const feature of featureLibrary.values())
        availableFeatureIds[feature.featureType].push(feature.id);

      const materialIdByAssetObjectId = new Map<number, MuseDAMID>();
      if (hasEnabledFeatures) {
        for (const assetObject of updatedAssetObjects) {
          try {
            materialIdByAssetObjectId.set(
              assetObject.id,
              slugToId("assetObject", assetObject.slug),
            );
          } catch {
            // skip assets without a valid MuseDAM slug
          }
        }
      }

      const featuresByMaterialId = new Map<number, MuseDAMMaterialFeatureSnapshot[]>();
      const materialIdsForFeatures = [...materialIdByAssetObjectId.values()];
      if (hasEnabledFeatures && materialIdsForFeatures.length > 0) {
        try {
          const featureEntries = await getFeatureByAssetFromMuseDAM({
            team,
            materialIds: materialIdsForFeatures,
          });
          for (const entry of featureEntries) {
            featuresByMaterialId.set(
              entry.materialId,
              (entry.features ?? []).filter((feature) =>
                isFeatureTypeEnabled(featureLibraryFeatures, feature.featureType),
              ),
            );
          }
        } catch (error) {
          console.error("批量获取资产已有特征失败:", error);
        }
      }

      const results: AssetWithAuditItemsBatch[] = [];

      for (const assetObjectId of assetObjectIds) {
        const assetObject = updatedAssetObjects.find(({ id }) => id === assetObjectId);
        if (!assetObject) continue;
        const batch: AssetWithAuditItemsBatch["batch"] = [];
        for (const { queueItem, tagPath, ...taggingAuditItem } of assetObject.taggingAuditItems) {
          if (!queueItem) continue;
          if (
            !taggingAuditItem.leafTagId &&
            !hasEnabledFeatureRecommendation(queueItem.result, featureLibraryFeatures)
          ) {
            continue;
          }

          let group = batch.find((group) => group.queueItem.id === queueItem.id);
          if (!group) {
            group = {
              queueItem: {
                ...queueItem,
                result: filterFeatureLibraryRecommendations(
                  assetObject.taggingAuditItems.some(
                    (item) => item.queueItem?.id === queueItem.id && item.status === "pending",
                  )
                    ? hydrateReviewFeatures(queueItem.result, featureLibrary)
                    : getReviewedFeatureResult(queueItem.result, queueItem.extra),
                  featureLibraryFeatures,
                ) as Prisma.JsonObject,
              },
              taggingAuditItems: [],
            };
            batch.push(group);
          }
          group.taggingAuditItems.push({
            tagPath: tagPath as string[],
            ...taggingAuditItem,
          });
        }
        // rejected 审核项的取舍：这一批还有 pending 项（尚未应用）时保留，前端以虚线展示、可点对勾恢复；
        // 这一批已经应用过（没有 pending 项）时剔除，避免历史上早已拒绝的标签再冒出来。
        for (const group of batch) {
          const hasPending = group.taggingAuditItems.some((item) => item.status === "pending");
          if (!hasPending) {
            group.taggingAuditItems = group.taggingAuditItems.filter(
              (item) => item.status !== "rejected",
            );
          }
        }
        // 过滤掉没有审核项的 batch（所有审核项都被过滤掉了）
        const filteredBatch = batch.filter((group) => group.taggingAuditItems.length > 0);

        // 将同一资产内的不同队列分组按创建时间降序排序（最新在前）
        filteredBatch.sort((a, b) => {
          const ta = new Date(a.queueItem.createdAt).getTime();
          const tb = new Date(b.queueItem.createdAt).getTime();
          return tb - ta;
        });

        // const finalBatch = filteredBatch;

        // 只有当有有效的 batch 时才添加到结果中
        if (filteredBatch.length > 0) {
          const materialId = materialIdByAssetObjectId.get(assetObject.id);
          const existingFeatures =
            hasEnabledFeatures && materialId !== undefined
              ? (featuresByMaterialId.get(Number(materialId.toString())) ?? [])
              : [];

          results.push({
            assetObject,
            existingFeatures,
            availableFeatureIds,
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
  assetSlug,
  auditItems,
  featureReviewVersions,
  rejectedFeatureKeys = [],
  append = true,
}: {
  assetSlug: string;
  auditItems: { id: number; leafTagId: number | null; status: TaggingAuditStatus }[];
  featureReviewVersions: FeatureReviewVersions;
  rejectedFeatureKeys?: string[];
  append?: boolean;
}): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const featureLibraryFeatures = await getServerFeatureLibraryFeatures();
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { id: true, slug: true },
    });

    const musedamAssetId = slugToId("assetObject", assetSlug);

    // 判断素材是否还在素材库
    await syncSingleAssetFromMuseDAM({
      musedamAssetId,
      team,
    });

    // Resolve tags on the server from current, team-owned features. Client tag IDs
    // and the classifier's historical tag associations are never approval inputs.
    const storedAuditItems = await prisma.taggingAuditItem.findMany({
      where: {
        id: { in: auditItems.map(({ id }) => id) },
        teamId,
        assetObject: { slug: assetSlug },
      },
      include: { queueItem: true },
    });
    if (storedAuditItems.length !== new Set(auditItems.map(({ id }) => id)).size) {
      return { success: false, message: "Invalid review items" };
    }
    const queueResults = [
      ...new Map(
        storedAuditItems.flatMap(({ queueItem }) =>
          queueItem ? [[queueItem.id, queueItem] as const] : [],
        ),
      ).values(),
    ].filter((queueItem) => featureReviewVersions[queueItem.id] !== undefined);
    const featureLibrary = await loadReviewFeatureLibrary(
      teamId,
      queueResults.map(({ result }) => result),
      featureLibraryFeatures,
    );
    const currentResults = queueResults.map((queueItem) => ({
      ...queueItem,
      result: hydrateReviewFeatures(queueItem.result, featureLibrary),
    }));
    if (
      currentResults.some(
        ({ id, result }) => getFeatureReviewVersion(result) !== featureReviewVersions[id],
      )
    ) {
      return { success: false, message: FEATURE_REVIEW_CHANGED };
    }
    const selectedFeatures = selectReviewFeatures(
      currentResults.map(({ result }) => result),
      rejectedFeatureKeys,
    );
    const requestedStatus = new Map(auditItems.map(({ id, status }) => [id, status]));
    const combinedApprovedTagIds = Array.from(
      new Set([
        ...storedAuditItems.flatMap(({ id, leafTagId }) =>
          requestedStatus.get(id) === "approved" && leafTagId ? [leafTagId] : [],
        ),
        ...selectedFeatures.flatMap((feature) => feature.tags.map((tag) => tag.assetTagId)),
      ]),
    );

    const approvedAsetTags = await prisma.assetTag.findMany({
      where: {
        teamId,
        id: {
          in: combinedApprovedTagIds,
        },
        slug: {
          not: null,
        },
      },
      select: { id: true, slug: true },
    });

    const musedamTagIds = Array.from(
      new Set(approvedAsetTags.map((tag) => slugToId("assetTag", tag.slug!))),
    );

    if (musedamTagIds.length > 0 || !append) {
      await setAssetTagsToMuseDAM({ musedamAssetId, musedamTagIds, team, append });
    }
    for (const feature of selectedFeatures) {
      const bound = await bindFeatureMaterialToMuseDAM({
        team,
        materialId: Number(musedamAssetId.toString()),
        identifierId: feature.id,
      });
      if (!bound) throw new Error("Failed to bind feature to asset");
    }

    // 从 MuseDAM 获取更新后的素材标签并同步到本地数据库
    const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
    const assets = await requestMuseDAMAPI<{ id: MuseDAMID }[]>("/api/muse/assets-by-ids", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${musedamTeamApiKey}`,
      },
      body: [musedamAssetId],
    });

    if (assets && assets.length > 0) {
      const musedamAsset = assets[0] as {
        id: MuseDAMID;
        tags: { id: MuseDAMID; name: string }[] | null;
      };
      const tags = await buildAssetObjectTags(musedamAsset.tags ?? []);

      // 更新本地素材的 tags 字段
      await prisma.assetObject.update({
        where: { slug: assetSlug },
        data: { tags },
      });
    }

    // 只对"本次才变成 rejected"的审核项跑反馈闭环：点 x 时已经即时持久化并跑过反馈的项，
    // 这里再收到 rejected 状态属于重复提交，不能再计一次数。
    const previousStatusById = new Map(
      (
        await prisma.taggingAuditItem.findMany({
          where: { id: { in: auditItems.map(({ id }) => id) }, teamId },
          select: { id: true, status: true },
        })
      ).map(({ id, status }) => [id, status]),
    );
    const newlyRejectedAuditItemIds = auditItems
      .filter(
        ({ id, status }) => status === "rejected" && previousStatusById.get(id) !== "rejected",
      )
      .map(({ id }) => id);

    await prisma.$transaction(async (tx) => {
      for (const { id, status } of auditItems) {
        await tx.taggingAuditItem.update({
          where: { id, teamId },
          data: { status },
        });
      }
      for (const queueItem of currentResults) {
        await tx.taggingQueueItem.update({
          where: { id: queueItem.id, teamId },
          data: {
            extra: {
              ...(queueItem.extra as Prisma.JsonObject),
              featureReview: createFeatureReviewSnapshot(queueItem.result, selectedFeatures),
            },
          },
        });
      }
    });

    await recordRejectionFeedbackForAuditItems({ teamId, auditItemIds: newlyRejectedAuditItemIds });

    return {
      success: true,
      data: undefined,
    };
  });
}

/**
 * 审核反馈闭环，对一批"刚刚被人工拒绝"的审核项执行（失败不影响审核主流程）：
 * 1) 关键词负反馈：反推是否由自动拆词关键词硬匹配触发，累计拒绝次数，达到阈值后自动加入该标签的排除关键词；
 * 2) 证据策略反馈：如果这条推荐只有 contentAnalysis 一个来源在支撑，累计到阈值后把该标签降级为"字面型"。
 */
async function recordRejectionFeedbackForAuditItems({
  teamId,
  auditItemIds,
}: {
  teamId: number;
  auditItemIds: number[];
}): Promise<void> {
  if (auditItemIds.length === 0) return;
  try {
    const rejectedAuditItems = await prisma.taggingAuditItem.findMany({
      where: { id: { in: auditItemIds }, teamId, leafTagId: { not: null } },
      select: {
        leafTagId: true,
        assetObject: { select: { materializedPath: true, name: true } },
        queueItem: { select: { result: true } },
      },
    });

    await recordKeywordRejectionFeedbackBatch(
      rejectedAuditItems.flatMap(({ leafTagId, assetObject }) =>
        leafTagId && assetObject
          ? [
              {
                teamId,
                leafTagId,
                materializedPath: assetObject.materializedPath,
                assetName: assetObject.name,
              },
            ]
          : [],
      ),
    );

    await recordContentOnlyRejectionFeedbackBatch(
      rejectedAuditItems.flatMap(({ leafTagId, queueItem }) => {
        if (!leafTagId) return [];
        const tagsWithScore = (queueItem?.result as TaggingQueueItemResult | null)?.tagsWithScore;
        const scored = Array.isArray(tagsWithScore)
          ? tagsWithScore.find((tag) => tag.leafTagId === leafTagId)
          : undefined;
        // 必打兜底 / 画幅确定性标签不是模型"仅凭画面推测"的结果，被拒绝不应计入 literal 降级反馈
        if (scored?.origin) return [];
        return [{ teamId, leafTagId, confidenceBySources: scored?.confidenceBySources }];
      }),
    );
  } catch (error) {
    console.error("审核拒绝反馈闭环执行失败:", error);
  }
}

/**
 * 审核页点击标签上的 x（或再次点击恢复）时调用：立刻把这些审核项在数据库里标为 rejected / 恢复为 pending。
 * 之前 x 只是页面内存状态，只有点该卡片的"应用"才会落库；用户改用顶部"批量应用"时服务端看不到 x，
 * 会把 x 掉的标签也应用上。现在 x 即时持久化，批量应用与刷新页面都能看到正确状态。
 * - rejected=true：只把 pending 的项改为 rejected，并跑一次反馈闭环；
 * - rejected=false：只把 rejected 的项改回 pending（限定传入的 id，不会把历史上早已拒绝的项复活）。
 */
export async function setAuditItemsRejectedAction({
  assetSlug,
  auditItemIds,
  rejected,
}: {
  assetSlug: string;
  auditItemIds: number[];
  rejected: boolean;
}): Promise<ServerActionResult<{ updatedCount: number }>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      if (auditItemIds.length === 0) {
        return { success: true, data: { updatedCount: 0 } };
      }
      const where: Prisma.TaggingAuditItemWhereInput = {
        id: { in: auditItemIds },
        teamId,
        assetObject: { slug: assetSlug },
        status: rejected ? "pending" : "rejected",
      };
      const targets = await prisma.taggingAuditItem.findMany({ where, select: { id: true } });
      const targetIds = targets.map(({ id }) => id);
      if (targetIds.length === 0) {
        return { success: true, data: { updatedCount: 0 } };
      }
      const updated = await prisma.taggingAuditItem.updateMany({
        where: { id: { in: targetIds } },
        data: { status: rejected ? "rejected" : "pending" },
      });
      if (rejected) {
        await recordRejectionFeedbackForAuditItems({ teamId, auditItemIds: targetIds });
      }
      return { success: true, data: { updatedCount: updated.count } };
    } catch (error) {
      console.error("更新审核项拒绝状态失败:", error);
      return { success: false, data: undefined, message: "更新审核项拒绝状态失败" };
    }
  });
}

export async function rejectAuditItemsAction({
  assetSlug,
}: {
  assetSlug: string;
}): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const assetObject = await prisma.assetObject.findUniqueOrThrow({
        where: { slug: assetSlug },
        select: { id: true },
      });

      await prisma.$transaction(async (tx) => {
        // 将该素材的所有待审核 的 AI 推荐标签都标记为 rejected
        await tx.taggingAuditItem.updateMany({
          where: {
            teamId,
            assetObjectId: assetObject.id,
            // status: {
            //   in: ["pending","approved"],
            // },
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
        data: undefined,
        message: "删除 AI 打标记录失败",
      };
    }
  });
}

export async function batchApproveAuditItemsAction({
  assetObjects,
  append = true,
}: {
  assetObjects: BatchApproveAssetRef[];
  append?: boolean;
}): Promise<
  ServerActionResult<{ failedCount: number; deletedCount: number; changedCount: number }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const team = await prisma.team.findUniqueOrThrow({
        where: { id: teamId },
        select: { id: true, slug: true },
      });
      const featureLibraryFeatures = await getServerFeatureLibraryFeatures();
      const hasEnabledFeatures =
        featureLibraryFeatures.featureBrand ||
        featureLibraryFeatures.featureIp ||
        featureLibraryFeatures.featureProduct ||
        featureLibraryFeatures.featurePerson;

      let failedCount = 0;
      let deletedCount = 0;
      let changedCount = 0;
      const assetRefs = assetObjects
        .map((assetObject) => {
          try {
            return {
              ...assetObject,
              musedamAssetId: slugToId("assetObject", assetObject.slug),
            };
          } catch {
            failedCount++;
            return null;
          }
        })
        .filter(
          (assetRef): assetRef is BatchApproveAssetRef & { musedamAssetId: MuseDAMID } =>
            assetRef !== null,
        );

      const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
      const existingMuseDAMAssets = await requestMuseDAMAPI<Array<{ id: MuseDAMID }>>(
        "/api/muse/assets-by-ids",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${musedamTeamApiKey}`,
          },
          body: assetRefs.map(({ musedamAssetId }) => musedamAssetId),
        },
      );
      const existingMuseDAMAssetIds = new Set(
        existingMuseDAMAssets.map((asset) => asset.id.toString()),
      );
      const approvedAssetRefs: typeof assetRefs = [];

      // 获取所有待审核的审核项
      const auditItems = await prisma.taggingAuditItem.findMany({
        where: {
          teamId,
          assetObjectId: { in: assetRefs.map((a) => a.id) },
          status: "pending",
        },
        include: {
          assetObject: true,
          queueItem: true,
        },
      });
      const featureLibrary = await loadReviewFeatureLibrary(
        teamId,
        auditItems.flatMap(({ queueItem }) => (queueItem ? [queueItem.result] : [])),
        featureLibraryFeatures,
      );
      // 按资产分组处理
      for (const assetObject of assetRefs) {
        const assetAuditItems = auditItems.filter(
          (item) =>
            item.assetObjectId === assetObject.id &&
            item.assetObject?.slug === assetObject.slug &&
            (item.leafTagId !== null ||
              (hasEnabledFeatures &&
                item.queueItem &&
                hasEnabledFeatureRecommendation(item.queueItem.result, featureLibraryFeatures))),
        );

        // 参考 fetchAssetsWithAuditItems 的 batch 分组逻辑
        const batch: {
          queueItem: NonNullable<(typeof assetAuditItems)[number]["queueItem"]>;
          taggingAuditItems: typeof assetAuditItems;
        }[] = [];

        for (const auditItem of assetAuditItems) {
          const { queueItem } = auditItem;
          if (!queueItem) continue;

          let group = batch.find((g) => g.queueItem.id === queueItem.id);
          if (!group) {
            group = { queueItem, taggingAuditItems: [] };
            batch.push(group);
          }
          group.taggingAuditItems.push(auditItem);
        }

        // 按创建时间降序排序（最新在前）
        batch.sort((a, b) => {
          const ta = new Date(a.queueItem.createdAt).getTime();
          const tb = new Date(b.queueItem.createdAt).getTime();
          return tb - ta;
        });

        // 过滤掉旧的 default 类型的 batch，只保留最新的一个
        let hasDefaultBatch = false;
        const filteredOutAuditItems: typeof assetAuditItems = [];
        const finalAuditItems: typeof assetAuditItems = [];
        const finalGroups: typeof batch = [];

        batch.forEach((group) => {
          if (group.queueItem.taskType === "default") {
            if (hasDefaultBatch) {
              // 已经保留了一个 default batch，这个是旧的，标记为 rejected
              filteredOutAuditItems.push(...group.taggingAuditItems);
            } else {
              hasDefaultBatch = true;
              finalAuditItems.push(...group.taggingAuditItems);
              finalGroups.push(group);
            }
          } else {
            // 非 default 类型的都保留
            finalAuditItems.push(...group.taggingAuditItems);
            finalGroups.push(group);
          }
        });

        const currentGroups = finalGroups.map((group) => ({
          ...group,
          queueItem: {
            ...group.queueItem,
            result: hydrateReviewFeatures(group.queueItem.result, featureLibrary),
          },
        }));
        if (
          currentGroups.some(
            ({ queueItem }) =>
              getFeatureReviewVersion(queueItem.result) !==
              assetObject.featureReviewVersions[queueItem.id],
          )
        ) {
          changedCount++;
          continue;
        }
        const selectedFeatures = selectReviewFeatures(
          currentGroups.map(({ queueItem }) => queueItem.result),
          assetObject.rejectedFeatureKeys,
        );
        const finalAssetAuditItems = finalAuditItems;
        const featureTagIds = selectedFeatures.flatMap((feature) =>
          feature.tags.map((tag) => tag.assetTagId),
        );

        if (finalAssetAuditItems.length === 0 && selectedFeatures.length === 0) {
          failedCount++;
          continue;
        }
        const { musedamAssetId } = assetObject;

        if (!existingMuseDAMAssetIds.has(musedamAssetId.toString())) {
          await rejectAuditItemsAction({ assetSlug: assetObject.slug });
          deletedCount++;
          continue;
        }
        const combinedApprovedTagIds = Array.from(
          new Set([
            ...finalAssetAuditItems
              .map((item) => item.leafTagId)
              .filter((leafTagId): leafTagId is number => leafTagId !== null),
            ...featureTagIds,
          ]),
        );

        const approvedAssetTags = await prisma.assetTag.findMany({
          where: {
            teamId,
            id: {
              in: combinedApprovedTagIds,
            },
            slug: {
              not: null,
            },
          },
          select: { id: true, slug: true },
        });

        const musedamTagIds = Array.from(
          new Set(approvedAssetTags.map((tag) => slugToId("assetTag", tag.slug!))),
        );

        try {
          if (musedamTagIds.length > 0 || !append) {
            await setAssetTagsToMuseDAM({ musedamAssetId, musedamTagIds, team, append });
          }
          for (const feature of selectedFeatures) {
            const bound = await bindFeatureMaterialToMuseDAM({
              team,
              materialId: Number(musedamAssetId.toString()),
              identifierId: feature.id,
            });
            if (!bound) throw new Error("Failed to bind feature to asset");
          }

          // 从 MuseDAM 获取更新后的素材标签并同步到本地数据库
          const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
          const assets = await requestMuseDAMAPI<{ id: MuseDAMID }[]>("/api/muse/assets-by-ids", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${musedamTeamApiKey}`,
            },
            body: [musedamAssetId],
          });

          if (assets && assets.length > 0) {
            const musedamAsset = assets[0] as {
              id: MuseDAMID;
              tags: { id: MuseDAMID; name: string }[] | null;
            };
            const tags = await buildAssetObjectTags(musedamAsset.tags ?? []);

            // 更新本地素材的 tags 字段
            await prisma.assetObject.update({
              where: { id: assetObject.id },
              data: { tags },
            });
          }
        } catch (error) {
          console.error("设置素材标签或绑定素材特征失败:", error);
          failedCount++;
          continue;
        }

        await prisma.$transaction(async (tx) => {
          await tx.taggingAuditItem.updateMany({
            where: { teamId, id: { in: finalAssetAuditItems.map((item) => item.id) } },
            data: { status: "approved" },
          });
          await tx.taggingAuditItem.updateMany({
            where: { teamId, id: { in: filteredOutAuditItems.map((item) => item.id) } },
            data: { status: "rejected" },
          });
          for (const { queueItem } of currentGroups) {
            await tx.taggingQueueItem.update({
              where: { id: queueItem.id, teamId },
              data: {
                extra: {
                  ...(queueItem.extra as Prisma.JsonObject),
                  featureReview: createFeatureReviewSnapshot(queueItem.result, selectedFeatures),
                },
              },
            });
          }
        });
        approvedAssetRefs.push(assetObject);
      }

      // 从 MuseDAM 批量获取更新后的素材标签并同步到本地数据库
      if (approvedAssetRefs.length > 0) {
        try {
          const assets = await requestMuseDAMAPI<
            Array<{ id: MuseDAMID; tags: { id: MuseDAMID; name: string }[] | null }>
          >("/api/muse/assets-by-ids", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${musedamTeamApiKey}`,
            },
            body: approvedAssetRefs.map(({ musedamAssetId }) => musedamAssetId),
          });

          const assetRefByMuseDAMId = new Map(
            approvedAssetRefs.map((assetRef) => [assetRef.musedamAssetId.toString(), assetRef]),
          );

          await Promise.all(
            assets.map(async (musedamAsset) => {
              const assetRef = assetRefByMuseDAMId.get(musedamAsset.id.toString());
              if (!assetRef) return;

              const tags = await buildAssetObjectTags(musedamAsset.tags ?? []);
              await prisma.assetObject.update({
                where: { id: assetRef.id },
                data: { tags },
              });
            }),
          );
        } catch (error) {
          console.error("批量更新素材标签失败:", error);
          // 不影响主流程，审核状态已经更新成功
        }
      }

      return {
        success: true,
        data: { failedCount, deletedCount, changedCount },
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
            assetObjectId: { in: assetObjects.map((a) => a.id) },
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
        data: undefined,
        message: "批量删除 AI 打标记录失败",
      };
    }
  });
}
