import "server-only";

import { rootLogger } from "@/lib/logging";
import {
  AssetObject,
  Prisma,
  TaggingQueueItem,
  TaggingQueueItemExtra,
  TaggingQueueItemResult,
} from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { waitUntil } from "@vercel/functions";
import { predictAssetTags } from "./predict";
import { SourceBasedTagPredictions, TagWithScore } from "./types";

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
    logger.info("processQueueItem completed");
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

    if (updatedQueueItem.taskType !== "test") {
      // 如果是测试内容，不需要进入审核
      await createAuditItems({
        assetObject,
        taggingQueueItem: updatedQueueItem,
        predictions,
        tagsWithScore,
      }).catch(() => {
        // 忽略 error，createAuditItems 里自己会处理
      });
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
}: {
  assetObject: AssetObject;
  taggingQueueItem: TaggingQueueItem;
  predictions: SourceBasedTagPredictions;
  tagsWithScore: TagWithScore[];
}) {
  try {
    const data: Prisma.TaggingAuditItemCreateManyInput[] = [];
    // TODO: 要做一下加权，暂时先跳过
    for (const { leafTagId, tagPath, score } of tagsWithScore) {
      data.push({
        queueItemId: taggingQueueItem.id,
        assetObjectId: assetObject.id,
        teamId: assetObject.teamId,
        status: "pending",
        score,
        tagPath,
        leafTagId,
      });
    }
    await prisma.taggingAuditItem.createMany({
      data,
    });
  } catch (error) {
    rootLogger.error({
      teamId: assetObject.teamId,
      assetObjectId: assetObject.id,
      msg: `createAuditItems failed: ${error}`,
    });
  }
}
