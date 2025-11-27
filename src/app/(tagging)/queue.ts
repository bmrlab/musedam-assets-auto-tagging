import "server-only";

import { rootLogger } from "@/lib/logging";
import { idToSlug, slugToId } from "@/lib/slug";
import { retrieveTeamCredentials } from "@/musedam/apiKey";
import { setAssetTagsToMuseDAM } from "@/musedam/assets";
import { requestMuseDAMAPI } from "@/musedam/lib";
import { MuseDAMID } from "@/musedam/types";
import {
  AssetObject,
  AssetObjectTags,
  Prisma,
  TaggingAuditStatus,
  TaggingQueueItem,
  TaggingQueueItemExtra,
  TaggingQueueItemResult,
} from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { waitUntil } from "@vercel/functions";
import { predictAssetTags } from "./predict";
import { getTaggingSettings } from "./tagging/settings/lib";
import { SourceBasedTagPredictions, TagWithScore } from "./types";

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
    const {
      predictions,
      tagsWithScore,
      extra: newExtra,
    } = await predictAssetTags(assetObject, {
      matchingSources: extra?.matchingSources,
      recognitionAccuracy: extra?.recognitionAccuracy,
    });
    logger.info({
      msg: "processQueueItem completed",
      tagsWithScoreCount: tagsWithScore.length,
    });
    const updatedQueueItem = await prisma.taggingQueueItem.update({
      where: { id: queueItem.id },
      data: {
        status: "completed",
        endsAt: new Date(),
        result: {
          predictions,
          tagsWithScore,
        } as TaggingQueueItemResult,
        extra: {
          ...extra,
          ...newExtra,
        },
      },
    });
    // 如果是测试内容，不需要进入审核
    if (updatedQueueItem.taskType !== "test") {
      const teamSetting = await getTaggingSettings(queueItem.teamId);
      // 直接应用
      const isDirect = teamSetting.taggingMode === "direct";
      logger.info({
        msg: "Creating audit items",
        isDirect,
        tagsWithScoreCount: tagsWithScore.length,
        mode: isDirect ? "direct" : "review",
      });
      const createAuditResult = await createAuditItems({
        assetObject,
        taggingQueueItem: updatedQueueItem,
        predictions,
        tagsWithScore,
        status: isDirect ? "approved" : "pending",
      });

      if (!createAuditResult.success) {
        logger.error({
          msg: "createAuditItems failed",
          error: createAuditResult.error,
          mode: isDirect ? "direct" : "review",
        });
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

      if (isDirect) {
        logger.info({ msg: "Direct mode: starting tag application" });
        const team = await prisma.team.findUniqueOrThrow({
          where: { id: queueItem.teamId },
          select: { id: true, slug: true },
        });
        // 先查询对应的 AssetTag 获取 slug
        const approvedAssetTags = await prisma.assetTag.findMany({
          where: {
            id: {
              in: tagsWithScore.map((tag) => tag.leafTagId),
            },
            slug: {
              not: null,
            },
          },
          select: { id: true, slug: true },
        });

        logger.info({
          msg: "Direct mode: found asset tags",
          requestedTagIds: tagsWithScore.map((tag) => tag.leafTagId),
          foundAssetTagsCount: approvedAssetTags.length,
        });

        const musedamTagIds = approvedAssetTags.map((tag) => slugToId("assetTag", tag.slug!));

        // 如果没有有效的标签，跳过打标
        if (musedamTagIds.length === 0) {
          logger.warn({
            msg: "No valid tags found for direct tagging, skipping",
            requestedTagIds: tagsWithScore.map((tag) => tag.leafTagId),
            foundAssetTagsCount: approvedAssetTags.length,
          });
          return;
        }

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
  } catch (error) {
    logger.error(`processQueueItem failed: ${error}`);
    await prisma.taggingQueueItem.update({
      where: { id: queueItem.id },
      data: {
        status: "failed",
        endsAt: new Date(),
        result: { error } as TaggingQueueItemResult,
      },
    });
  }
}

export async function processPendingQueueItems(): Promise<{
  processing: number;
  skipped: number;
}> {
  rootLogger.info(`processPendingQueueItems`);

  const pendingItems = await prisma.taggingQueueItem.findMany({
    where: {
      status: "pending",
    },
    orderBy: {
      startsAt: "asc",
    },
    include: {
      assetObject: true,
    },
    take: 30,
  });

  let processing = 0;
  let skipped = 0;

  for (const queueItem of pendingItems) {
    try {
      const updatedItem = await prisma.taggingQueueItem.updateMany({
        where: {
          id: queueItem.id,
          status: "pending",
        },
        data: {
          status: "processing",
        },
      });

      if (updatedItem.count > 0) {
        waitUntil(
          Promise.any([
            processQueueItem({ ...queueItem, status: "processing" }),
            // new Promise((resolve) => setTimeout(resolve, 1000)),
          ]),
        );
        processing++;
      } else {
        skipped++;
      }
    } catch (error) {
      rootLogger.error({
        teamId: queueItem.teamId,
        assetObjectId: queueItem.assetObjectId,
        queueItemId: queueItem.id,
        msg: `Failed to update queue item (pending -> processing): ${error}`,
      });
      skipped++;
    }
  }

  rootLogger.info({
    msg: `processPendingQueueItems, processing: ${processing}, skipped: ${skipped}`,
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
        status: status ?? "pending",
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
      status: status ?? "pending",
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
