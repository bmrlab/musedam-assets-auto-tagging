import "server-only";

import { AssetObject, TaggingQueueItem } from "@/prisma/client";
import { InputJsonObject, InputJsonValue, JsonObject } from "@/prisma/client/runtime/library";
import prisma from "@/prisma/prisma";
import { waitUntil } from "@vercel/functions";
import { predictAssetTags } from "./predict";
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
        await prisma.taggingQueueItem.update({
          where: { id: taggingQueueItem.id },
          data: {
            status: "completed",
            endsAt: new Date(),
            result: { predictions: predictions as unknown as InputJsonObject },
            extra: { ...(taggingQueueItem.extra as JsonObject), ...extra },
          },
        });
      } catch (error) {
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
