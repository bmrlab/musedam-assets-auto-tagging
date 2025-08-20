import "server-only";

import { rootLogger } from "@/lib/logging";
import { AssetObject, Prisma, TaggingQueueItem } from "@/prisma/client";
import { InputJsonObject, InputJsonValue, JsonObject } from "@/prisma/client/runtime/library";
import prisma from "@/prisma/prisma";
import { waitUntil } from "@vercel/functions";
import { predictAssetTags } from "./predict";
import { SourceBasedTagPredictions } from "./types";
import { fetchTagsTree } from "./utils";

export async function enqueueTaggingTask({
  assetObject,
}: {
  assetObject: AssetObject;
}): Promise<TaggingQueueItem> {
  const teamId = assetObject.teamId;

  // 获取团队的所有标签
  const tagsTree = await fetchTagsTree({ teamId });

  const taggingQueueItem = await prisma.taggingQueueItem.create({
    data: {
      teamId: teamId,
      assetObjectId: assetObject.id,
      status: "processing",
      startsAt: new Date(),
    },
  });

  waitUntil(
    (async () => {
      try {
        const { predictions, extra } = await predictAssetTags(assetObject, tagsTree);
        const updatedQueueItem = await prisma.taggingQueueItem.update({
          where: { id: taggingQueueItem.id },
          data: {
            status: "completed",
            endsAt: new Date(),
            result: { predictions: predictions as unknown as InputJsonObject },
            extra: { ...(taggingQueueItem.extra as JsonObject), ...extra },
          },
        });
        await createAuditItems({
          assetObject,
          taggingQueueItem: updatedQueueItem,
          predictions,
        }).catch(() => {
          // 忽略 error，createAuditItems 里自己会处理
        });
      } catch (error) {
        rootLogger.error({
          teamId: teamId,
          assetObjectId: assetObject.id,
          msg: `predictAssetTags failed: ${error}`,
        });
        await prisma.taggingQueueItem.update({
          where: { id: taggingQueueItem.id },
          data: {
            status: "failed",
            endsAt: new Date(),
            result: { error: error as InputJsonValue },
          },
        });
      }
    })(),
  );

  return taggingQueueItem;
}

async function createAuditItems({
  assetObject,
  taggingQueueItem,
  predictions,
}: {
  assetObject: AssetObject;
  taggingQueueItem: TaggingQueueItem;
  predictions: SourceBasedTagPredictions;
}) {
  try {
    const data: Prisma.TaggingAuditItemCreateManyInput[] = [];
    // TODO: 要做一下加权，暂时先跳过
    for (const prediction of predictions) {
      for (const tagPrediction of prediction.tags) {
        data.push({
          assetObjectId: assetObject.id,
          teamId: assetObject.teamId,
          status: "pending",
          confidence: tagPrediction.confidence,
          queueItemId: taggingQueueItem.id,
          leafTagId: tagPrediction.leafTagId,
        });
      }
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
