import "server-only";

import { isTagTreeJob, processTagTreeQueueItem } from "@/app/tags/tagTreeQueue";
import { classifyAssetBrandRecommendation } from "@/lib/brand/tagging-brand-classification";
import { classifyAssetIpRecommendation } from "@/lib/ip/tagging-ip-classification";
import { rootLogger } from "@/lib/logging";
import { classifyAssetPersonRecommendation } from "@/lib/person/tagging-person-classification";
import { idToSlug, slugToId } from "@/lib/slug";
import { retrieveTeamCredentials } from "@/musedam/apiKey";
import { setAssetTagsToMuseDAM } from "@/musedam/assets";
import { requestMuseDAMAPI } from "@/musedam/lib";
import { MuseDAMID } from "@/musedam/types";
import {
  AssetObject,
  AssetObjectExtra,
  AssetObjectTags,
  Prisma,
  TaggingAuditStatus,
  TaggingBrandRecommendation,
  TaggingIpRecommendation,
  TaggingPersonRecommendation,
  TaggingQueueItem,
  TaggingQueueItemExtra,
  TaggingQueueItemResult,
} from "@/prisma/client";
import prisma from "@/prisma/prisma";
import pLimit from "p-limit";
import { predictAssetTags } from "./predict";
import { getTaggingSettings } from "./tagging/settings/lib";
import { SourceBasedTagPredictions, TagWithScore } from "./types";

function normalizeTaggingErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const maybeCode = (error as { code?: unknown }).code;
    if (typeof maybeCode === "string" && maybeCode.length > 0) return maybeCode;
  }
  if (typeof error === "string" && error.length > 0) return error;
  return "UNKNOWN";
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

function hasConfidentBrandRecommendedTags(
  brandRecommendation: TaggingBrandRecommendation | null,
): brandRecommendation is TaggingBrandRecommendation {
  return Boolean(
    brandRecommendation &&
      !brandRecommendation.noConfidentMatch &&
      Array.isArray(brandRecommendation.recommendedTags) &&
      brandRecommendation.recommendedTags.length > 0,
  );
}

function hasConfidentIpRecommendedTags(
  ipRecommendation: TaggingIpRecommendation | null,
): ipRecommendation is TaggingIpRecommendation {
  return Boolean(
    ipRecommendation &&
      !ipRecommendation.noConfidentMatch &&
      Array.isArray(ipRecommendation.recommendedTags) &&
      ipRecommendation.recommendedTags.length > 0,
  );
}

function hasConfidentPersonRecommendedTags(
  personRecommendation: TaggingPersonRecommendation | null,
): personRecommendation is TaggingPersonRecommendation {
  return Boolean(
    personRecommendation &&
      !personRecommendation.noConfidentMatch &&
      Array.isArray(personRecommendation.recommendedTags) &&
      personRecommendation.recommendedTags.length > 0,
  );
}

function getBestPersonRecommendationConfidence(
  personRecommendation: TaggingPersonRecommendation | null,
) {
  return Math.max(
    0,
    ...(personRecommendation?.faces.map((face) => face.bestMatch?.confidence ?? 0) ?? []),
  );
}

export async function enqueueTaggingTask({
  assetObject,
  matchingSources,
  recognitionAccuracy,
  taskType = "default",
}: {
  assetObject: AssetObject;
  matchingSources?: {
    basicInfo: boolean;
    materializedPath: boolean;
    contentAnalysis: boolean;
    tagKeywords: boolean;
  };
  recognitionAccuracy?: "precise" | "balanced" | "broad";
  taskType?: "default" | "test" | "manual" | "scheduled";
}): Promise<TaggingQueueItem> {
  const teamId = assetObject.teamId;

  const taggingQueueItem = await prisma.taggingQueueItem.create({
    data: {
      teamId: teamId,
      assetObjectId: assetObject.id,
      status: "pending",
      taskType,
      startsAt: new Date(),
      extra: {
        matchingSources,
        recognitionAccuracy,
      } as TaggingQueueItemExtra,
    },
  });

  return taggingQueueItem;
}

export async function processQueueItem({
  assetObject,
  ...queueItem
}: TaggingQueueItem & {
  assetObject: AssetObject | null;
}): Promise<void> {
  const logger = rootLogger.child({
    teamId: queueItem.teamId,
    assetObjectId: queueItem.assetObjectId,
    queueItemId: queueItem.id,
  });
  if (!assetObject) {
    logger.warn("assetObject is missing, skip processQueueItem");
    return;
  }

  logger.info("processQueueItem started");

  try {
    const extra = queueItem.extra as TaggingQueueItemExtra;
    const thumbnailUrl = (assetObject.extra as AssetObjectExtra | null)?.thumbnailAccessUrl;
    // console.log("thumbnailUrl", thumbnailUrl);
    const predictTagsPromise = predictAssetTags(assetObject, {
      matchingSources: extra?.matchingSources,
      recognitionAccuracy: extra?.recognitionAccuracy,
    });
    const brandRecommendationPromise = classifyAssetBrandRecommendation({
      teamId: queueItem.teamId,
      imageUrl: thumbnailUrl,
    }).catch((error) => {
      logger.warn({
        msg: "brand classification failed, continuing without brand recommendation",
        error: String(error),
      });
      return null;
    });
    const ipRecommendationPromise = classifyAssetIpRecommendation({
      teamId: queueItem.teamId,
      imageUrl: thumbnailUrl,
    }).catch((error) => {
      logger.warn({
        msg: "ip classification failed, continuing without ip recommendation",
        error: String(error),
      });
      return null;
    });
    const personRecommendationPromise = classifyAssetPersonRecommendation({
      teamId: queueItem.teamId,
      imageUrl: thumbnailUrl,
    }).catch((error) => {
      logger.warn({
        msg: "person classification failed, continuing without person recommendation",
        error: String(error),
      });
      return null;
    });

    const [
      { predictions, tagsWithScore, extra: newExtra },
      brandRecommendation,
      ipRecommendation,
      personRecommendation,
    ] = await Promise.all([
      predictTagsPromise,
      brandRecommendationPromise,
      ipRecommendationPromise,
      personRecommendationPromise,
    ]);
    const hasAiTags = tagsWithScore.length > 0;
    const confidentBrandRecommendation = hasConfidentBrandRecommendedTags(brandRecommendation)
      ? brandRecommendation
      : null;
    const confidentIpRecommendation = hasConfidentIpRecommendedTags(ipRecommendation)
      ? ipRecommendation
      : null;
    const confidentPersonRecommendation = hasConfidentPersonRecommendedTags(personRecommendation)
      ? personRecommendation
      : null;
    const hasBrandTags = confidentBrandRecommendation !== null;
    const hasIpTags = confidentIpRecommendation !== null;
    const hasPersonTags = confidentPersonRecommendation !== null;

    if (!hasAiTags && !hasBrandTags && !hasIpTags && !hasPersonTags) {
      throw Object.assign(new Error("No valid tags predicted"), { code: "NO_VALID_TAGS" });
    }
    logger.info({
      msg: "processQueueItem completed",
      tagsWithScoreCount: tagsWithScore.length,
      hasBrandTags,
      hasIpTags,
      hasPersonTags,
    });

    // 如果是测试内容，不需要进入审核
    if (queueItem.taskType !== "test") {
      const teamSetting = await getTaggingSettings(queueItem.teamId);
      const isDirect = teamSetting.taggingMode === "direct";

      logger.info({
        msg: "Creating review items",
        isDirect,
        tagsWithScoreCount: tagsWithScore.length,
        hasBrandTags,
        hasIpTags,
        hasPersonTags,
        mode: isDirect ? "direct" : "review",
      });

      const createAuditResult = hasAiTags
        ? await createAuditItems({
            assetObject,
            taggingQueueItem: queueItem,
            predictions,
            tagsWithScore,
            status: isDirect ? "approved" : "pending",
          })
        : null;

      if (createAuditResult) {
        if (!createAuditResult.success) {
          logger.error({
            msg: "createAuditItems failed",
            error: createAuditResult.error,
            mode: isDirect ? "direct" : "review",
          });
          // 审核模式依赖 review items；创建失败则标记任务失败，避免出现“任务完成但审核列表为空”
          if (!isDirect) {
            throw new Error("createAuditItems failed");
          }
        } else if (createAuditResult.createdCount === 0) {
          logger.warn({
            msg: "createAuditItems: no audit items created",
            tagsWithScoreCount: tagsWithScore.length,
            mode: isDirect ? "direct" : "review",
          });
        } else {
          logger.info({
            msg: "createAuditItems completed successfully",
            createdCount: createAuditResult.createdCount,
            mode: isDirect ? "direct" : "review",
          });
        }
      }

      if (!isDirect) {
        const hasCreatedAiAuditItems =
          createAuditResult?.success === true && createAuditResult.createdCount > 0;

        if (!hasCreatedAiAuditItems && (hasBrandTags || hasIpTags || hasPersonTags)) {
          const recommendationOnlyReviewResult = await createRecommendationOnlyReviewItem({
            assetObject,
            taggingQueueItem: queueItem,
            brandRecommendation: confidentBrandRecommendation,
            ipRecommendation: confidentIpRecommendation,
            personRecommendation: confidentPersonRecommendation,
          });

          if (!recommendationOnlyReviewResult.success) {
            logger.error({
              msg: "createRecommendationOnlyReviewItem failed",
              error: recommendationOnlyReviewResult.error,
            });
            throw new Error("createRecommendationOnlyReviewItem failed");
          }

          logger.info({
            msg: "createRecommendationOnlyReviewItem completed successfully",
            createdCount: recommendationOnlyReviewResult.createdCount,
          });
        } else if (!hasCreatedAiAuditItems) {
          throw new Error("No review items created");
        }
      }

      if (isDirect) {
        logger.info({ msg: "Direct mode: starting tag application" });
        const team = await prisma.team.findUniqueOrThrow({
          where: { id: queueItem.teamId },
          select: { id: true, slug: true },
        });
        const combinedLeafTagIds = Array.from(
          new Set([
            ...tagsWithScore.map((tag) => tag.leafTagId),
            ...(brandRecommendation?.recommendedTags ?? []).map((tag) => tag.assetTagId),
            ...(ipRecommendation?.recommendedTags ?? []).map((tag) => tag.assetTagId),
            ...(personRecommendation?.recommendedTags ?? []).map((tag) => tag.assetTagId),
          ]),
        );
        // 先查询对应的 AssetTag 获取 slug
        const approvedAssetTags = await prisma.assetTag.findMany({
          where: {
            id: {
              in: combinedLeafTagIds,
            },
            slug: {
              not: null,
            },
          },
          select: { id: true, slug: true },
        });

        logger.info({
          msg: "Direct mode: found asset tags",
          requestedTagIds: combinedLeafTagIds,
          foundAssetTagsCount: approvedAssetTags.length,
        });

        const musedamTagIds = Array.from(
          new Set(approvedAssetTags.map((tag) => slugToId("assetTag", tag.slug!))),
        );

        // 如果没有有效的标签，跳过打标
        if (musedamTagIds.length === 0) {
          logger.warn({
            msg: "No valid tags found for direct tagging, skipping",
            requestedTagIds: combinedLeafTagIds,
            foundAssetTagsCount: approvedAssetTags.length,
          });
        } else {
          const musedamAssetId = slugToId("assetObject", assetObject.slug);
          logger.info({
            msg: "Direct mode: setting tags to MuseDAM",
            musedamAssetId,
            musedamTagIdsCount: musedamTagIds.length,
          });
          await setAssetTagsToMuseDAM({
            musedamAssetId,
            musedamTagIds,
            team,
            append: true,
          });
          logger.info({ msg: "Direct mode: tags set to MuseDAM successfully" });

          // 从 MuseDAM 获取更新后的素材标签并同步到本地数据库
          const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
          logger.info({ msg: "Direct mode: fetching updated asset from MuseDAM" });
          const assets = await requestMuseDAMAPI<{ id: MuseDAMID }[]>("/api/muse/assets-by-ids", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${musedamTeamApiKey}`,
            },
            body: [musedamAssetId],
          });

          logger.info({
            msg: "Direct mode: received assets from MuseDAM",
            assetsCount: assets?.length ?? 0,
            hasAssets: !!(assets && assets.length > 0),
          });

          if (assets && assets.length > 0) {
            const musedamAsset = assets[0] as {
              id: MuseDAMID;
              tags: { id: MuseDAMID; name: string }[] | null;
            };
            const tags = await buildAssetObjectTags(musedamAsset.tags ?? []);

            await prisma.assetObject.update({
              where: { id: assetObject.id },
              data: { tags },
            });
            logger.info({ msg: "Direct mode: local asset tags updated successfully" });
          } else {
            logger.warn({
              msg: "Direct mode: assets array is empty or null, skipping local update",
              assets: assets,
            });
          }
        }
      }
    }

    await prisma.taggingQueueItem.update({
      where: { id: queueItem.id },
      data: {
        status: "completed",
        endsAt: new Date(),
        result: {
          predictions,
          tagsWithScore,
          brandRecommendation,
          ipRecommendation,
          personRecommendation,
        } as TaggingQueueItemResult,
        extra: {
          ...extra,
          ...newExtra,
        },
      },
    });
  } catch (error) {
    const errorCode = normalizeTaggingErrorCode(error);
    if (errorCode === "NO_VALID_TAGS" || errorCode === "NO_TAG_TREE") {
      logger.warn({
        msg: "processQueueItem failed (expected)",
        errorCode,
      });
    } else {
      logger.error({
        msg: "processQueueItem failed",
        errorCode,
        error: String(error),
      });
    }
    await prisma.taggingQueueItem.update({
      where: { id: queueItem.id },
      data: {
        status: "failed",
        endsAt: new Date(),
        result: { error: errorCode } as TaggingQueueItemResult,
      },
    });
  }
}

// 总并发槽数：其中至少 TAG_TREE_RESERVED_CONCURRENCY 个保留给标签树任务
const TOTAL_CONCURRENCY = 3;
const TAG_TREE_RESERVED_CONCURRENCY = 1;
const PROCESSING_STALE_TIMEOUT_MS = Number(
  process.env.QUEUE_PROCESSING_STALE_TIMEOUT_MS ?? 15 * 60 * 1000,
);

async function recoverStaleProcessingItems(): Promise<number> {
  const staleBefore = new Date(Date.now() - PROCESSING_STALE_TIMEOUT_MS);
  const now = new Date();

  const updated = await prisma.taggingQueueItem.updateMany({
    where: {
      status: "processing",
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: "failed",
      endsAt: now,
      result: {
        error: "PROCESSING_STALE_TIMEOUT",
        message: `processing 超时超过 ${PROCESSING_STALE_TIMEOUT_MS}ms，自动标记失败`,
      } as TaggingQueueItemResult,
    },
  });

  if (updated.count > 0) {
    rootLogger.warn({
      msg: "recoverStaleProcessingItems: stale processing items recovered",
      recovered: updated.count,
      staleBefore,
      timeoutMs: PROCESSING_STALE_TIMEOUT_MS,
    });
  }

  return updated.count;
}

async function tryClaimAndProcess(
  queueItem: TaggingQueueItem & { assetObject?: AssetObject | null },
  onSuccess: () => void,
  onSkip: () => void,
): Promise<void> {
  try {
    const updated = await prisma.taggingQueueItem.updateMany({
      where: { id: queueItem.id, status: "pending" },
      data: { status: "processing" },
    });
    if (updated.count > 0) {
      if (isTagTreeJob(queueItem)) {
        await processTagTreeQueueItem({ ...queueItem, status: "processing" });
      } else {
        await processQueueItem({
          ...(queueItem as TaggingQueueItem & { assetObject: AssetObject | null }),
          status: "processing",
        });
      }
      onSuccess();
    } else {
      onSkip();
    }
  } catch (error) {
    rootLogger.error({
      teamId: queueItem.teamId,
      assetObjectId: queueItem.assetObjectId,
      queueItemId: queueItem.id,
      msg: `Failed to process queue item: ${error}`,
    });
    onSkip();
  }
}

export async function processPendingQueueItems(): Promise<{
  processing: number;
  skipped: number;
}> {
  rootLogger.info(`processPendingQueueItems`);
  await recoverStaleProcessingItems();

  // 一次性捞出足够多的 pending 记录，内存内分流（避免 Prisma JSON path 过滤器的兼容性问题）
  const candidateItems = await prisma.taggingQueueItem.findMany({
    where: { status: "pending" },
    orderBy: { startsAt: "asc" },
    include: { assetObject: true },
    // 多拉一些，保证两类任务都能填满各自的槽位
    take: TOTAL_CONCURRENCY * 4,
  });

  const tagTreeItems = candidateItems.filter(isTagTreeJob).slice(0, TAG_TREE_RESERVED_CONCURRENCY);

  const normalItems = candidateItems
    .filter((item) => !isTagTreeJob(item))
    .slice(0, TOTAL_CONCURRENCY - TAG_TREE_RESERVED_CONCURRENCY);

  const allItems = [...tagTreeItems, ...normalItems];

  let processing = 0;
  let skipped = 0;

  const limit = pLimit(TOTAL_CONCURRENCY);

  const processTasks = allItems.map((queueItem) =>
    limit(() =>
      tryClaimAndProcess(
        queueItem,
        () => {
          processing++;
        },
        () => {
          skipped++;
        },
      ),
    ),
  );

  await Promise.all(processTasks);

  rootLogger.info({
    msg: `processPendingQueueItems`,
    processing,
    skipped,
    tagTreePicked: tagTreeItems.length,
    normalPicked: normalItems.length,
  });

  return { processing, skipped };
}

async function createAuditItems({
  assetObject,
  taggingQueueItem,
  // predictions,
  tagsWithScore,
  status,
}: {
  assetObject: AssetObject;
  taggingQueueItem: TaggingQueueItem;
  predictions: SourceBasedTagPredictions;
  tagsWithScore: TagWithScore[];
  status?: TaggingAuditStatus;
}): Promise<{ success: boolean; createdCount: number; error?: unknown }> {
  const logger = rootLogger.child({
    teamId: assetObject.teamId,
    assetObjectId: assetObject.id,
    queueItemId: taggingQueueItem.id,
  });

  try {
    const finalStatus = status ?? "pending";

    // 检查 tagsWithScore 是否为空
    if (tagsWithScore.length === 0) {
      logger.warn({
        msg: "createAuditItems: tagsWithScore is empty, no audit items will be created",
      });
      return { success: true, createdCount: 0 };
    }

    const data: Prisma.TaggingAuditItemCreateManyInput[] = [];
    // TODO: 要做一下加权，暂时先跳过
    for (const { leafTagId, tagPath, score } of tagsWithScore) {
      // 验证必要字段
      if (!leafTagId) {
        logger.warn({
          msg: "createAuditItems: skipping tag with missing leafTagId",
          tagPath,
          score,
        });
        continue;
      }
      if (!tagPath || !Array.isArray(tagPath) || tagPath.length === 0) {
        logger.warn({
          msg: "createAuditItems: skipping tag with invalid tagPath",
          leafTagId,
          tagPath,
          score,
        });
        continue;
      }
      data.push({
        queueItemId: taggingQueueItem.id,
        assetObjectId: assetObject.id,
        teamId: assetObject.teamId,
        status: finalStatus,
        score,
        tagPath,
        leafTagId,
      });
    }

    if (data.length === 0) {
      logger.warn({
        msg: "createAuditItems: no valid data after validation, no audit items will be created",
        originalTagsCount: tagsWithScore.length,
      });
      return { success: true, createdCount: 0 };
    }

    logger.info({
      msg: "createAuditItems: creating audit items",
      dataCount: data.length,
      status: finalStatus,
    });

    const result = await prisma.taggingAuditItem.createMany({
      data,
    });

    logger.info({
      msg: "createAuditItems: audit items created successfully",
      createdCount: result.count,
      expectedCount: data.length,
    });

    if (result.count !== data.length) {
      logger.warn({
        msg: "createAuditItems: created count mismatch",
        createdCount: result.count,
        expectedCount: data.length,
      });
    }

    return { success: true, createdCount: result.count };
  } catch (error) {
    logger.error({
      msg: `createAuditItems failed: ${error}`,
      error,
      tagsWithScoreCount: tagsWithScore.length,
      status: status ?? "pending",
    });
    return { success: false, createdCount: 0, error };
  }
}

async function createRecommendationOnlyReviewItem({
  assetObject,
  taggingQueueItem,
  brandRecommendation,
  ipRecommendation,
  personRecommendation,
  status = "pending",
}: {
  assetObject: AssetObject;
  taggingQueueItem: TaggingQueueItem;
  brandRecommendation: TaggingBrandRecommendation | null;
  ipRecommendation: TaggingIpRecommendation | null;
  personRecommendation: TaggingPersonRecommendation | null;
  status?: TaggingAuditStatus;
}): Promise<{ success: boolean; createdCount: number; error?: unknown }> {
  const logger = rootLogger.child({
    teamId: assetObject.teamId,
    assetObjectId: assetObject.id,
    queueItemId: taggingQueueItem.id,
  });

  try {
    const hasBrandRecommendation = hasConfidentBrandRecommendedTags(brandRecommendation);
    const hasIpRecommendation = hasConfidentIpRecommendedTags(ipRecommendation);
    const hasPersonRecommendation = hasConfidentPersonRecommendedTags(personRecommendation);

    if (!hasBrandRecommendation && !hasIpRecommendation && !hasPersonRecommendation) {
      logger.warn({
        msg: "createRecommendationOnlyReviewItem: no confident recommendation available",
      });
      return { success: true, createdCount: 0 };
    }

    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          Math.max(
            hasBrandRecommendation ? (brandRecommendation.bestMatch?.confidence ?? 0) : 0,
            hasIpRecommendation ? (ipRecommendation.bestMatch?.confidence ?? 0) : 0,
            hasPersonRecommendation
              ? getBestPersonRecommendationConfidence(personRecommendation)
              : 0,
          ),
        ),
      ),
    );

    await prisma.taggingAuditItem.create({
      data: {
        queueItemId: taggingQueueItem.id,
        assetObjectId: assetObject.id,
        teamId: assetObject.teamId,
        status,
        score,
        tagPath: [],
        leafTagId: null,
      },
    });

    logger.info({
      msg: "createRecommendationOnlyReviewItem: placeholder created",
      score,
      status,
    });

    return { success: true, createdCount: 1 };
  } catch (error) {
    logger.error({
      msg: `createRecommendationOnlyReviewItem failed: ${error}`,
      error,
      status,
    });
    return { success: false, createdCount: 0, error };
  }
}
