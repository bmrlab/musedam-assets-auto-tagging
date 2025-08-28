import "server-only";

import { rootLogger } from "@/lib/logging";
import { AssetObject, Prisma, TaggingQueueItem } from "@/prisma/client";
import { InputJsonObject, InputJsonValue, JsonObject } from "@/prisma/client/runtime/library";
import prisma from "@/prisma/prisma";
import { waitUntil } from "@vercel/functions";
import { predictAssetTags } from "./predict";
import { SourceBasedTagPredictions, TagWithScore } from "./types";
import { fetchTagsTree } from "./utils";

export async function enqueueTaggingTask({
  assetObject,
  matchingSources,
  recognitionAccuracy,
}: {
  assetObject: AssetObject;
  matchingSources?: {
    basicInfo: boolean;
    materializedPath: boolean;
    contentAnalysis: boolean;
    tagKeywords: boolean;
  };
  recognitionAccuracy?: "precise" | "balanced" | "broad";
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
      extra: {
        matchingSources,
        recognitionAccuracy,
      },
    },
  });

  waitUntil(
    (async () => {
      try {
        const { predictions, tagsWithScore, extra } = await predictAssetTags(
          assetObject,
          tagsTree,
          { matchingSources, recognitionAccuracy },
        );
        const updatedQueueItem = await prisma.taggingQueueItem.update({
          where: { id: taggingQueueItem.id },
          data: {
            status: "completed",
            endsAt: new Date(),
            result: {
              predictions: predictions as unknown as InputJsonObject,
              tagsWithScore: tagsWithScore as unknown as InputJsonObject,
            },
            extra: {
              ...(taggingQueueItem.extra as JsonObject),
              ...extra,
            },
          },
        });
        await createAuditItems({
          assetObject,
          taggingQueueItem: updatedQueueItem,
          predictions,
          tagsWithScore,
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
