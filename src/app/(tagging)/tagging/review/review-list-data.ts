import { Prisma, type TaggingQueueItem } from "@/prisma/client";

/** Review needs decisions and recommendations, never the embedded image/request payloads. */
export function reviewQueueItemsQuery(teamId: number, ids: number[]) {
  return Prisma.sql`
    SELECT "id", "teamId", "assetObjectId", "status", "taskType", "startsAt", "endsAt",
      "createdAt", "updatedAt",
      "extra" - 'input' - 'usage' AS "extra",
      "result" #- '{featureDecision,ocr,call}' #- '{featureDecision,decision,call}' #- '{featureDecision,decision,batches}' AS "result"
    FROM "TaggingQueueItem"
    WHERE "teamId" = ${teamId} AND "id" IN (${Prisma.join(ids)})
  `;
}

export function attachReviewQueues<
  T extends { taggingAuditItems: { queueItemId: number | null }[] },
>(
  assets: T[],
  queues: TaggingQueueItem[],
): Array<
  Omit<T, "taggingAuditItems"> & {
    taggingAuditItems: Array<
      T["taggingAuditItems"][number] & { queueItem: TaggingQueueItem | null }
    >;
  }
> {
  const byId = new Map(queues.map((queue) => [queue.id, queue]));
  return assets.map((asset) => ({
    ...asset,
    taggingAuditItems: asset.taggingAuditItems.map((audit) => ({
      ...audit,
      queueItem: audit.queueItemId === null ? null : (byId.get(audit.queueItemId) ?? null),
    })),
  }));
}
