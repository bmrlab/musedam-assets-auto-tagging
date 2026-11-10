import "server-only";

import { Prisma, type TaggingQueueItemExtra } from "@/prisma/client";
import prisma from "@/prisma/prisma";

/**
 * Re-run only untouched review batches. Reviewed history and test tasks are deliberately excluded.
 * The caller starts queue processing after the database transaction commits.
 */
export async function requeuePendingBrandReviewResults(teamId: number) {
  const candidates = await prisma.taggingQueueItem.findMany({
    where: {
      teamId,
      status: "completed",
      taskType: { not: "test" },
      assetObjectId: { not: null },
      taggingAuditItems: {
        some: { status: "pending" },
        none: { status: { not: "pending" } },
      },
    },
    select: { id: true, extra: true },
  });
  const queueItemIds = candidates
    .filter(({ extra }) => {
      const options = (extra ?? {}) as TaggingQueueItemExtra;
      // Missing child flags are legacy queue data, where all feature types were enabled.
      return options.featureClassify === true && options.featureBrand !== false;
    })
    .map(({ id }) => id);

  if (queueItemIds.length === 0) return 0;

  return prisma.$transaction(async (tx) => {
    // Lock and re-check immediately before mutating. A reviewer may have approved/rejected an
    // item between the initial JSON filtering above and this transaction; that history must win.
    const lockedQueueItems = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT q."id"
      FROM "TaggingQueueItem" q
      WHERE q."id" IN (${Prisma.join(queueItemIds)})
        AND q."teamId" = ${teamId}
        AND q."status" = 'completed'
        AND q."taskType" <> 'test'
      FOR UPDATE
    `);
    const lockedQueueItemIds = lockedQueueItems.map(({ id }) => id);
    if (lockedQueueItemIds.length === 0) return 0;

    const lockedAuditItems = await tx.$queryRaw<
      Array<{ queueItemId: number; status: "pending" | "approved" | "rejected" }>
    >(Prisma.sql`
      SELECT a."queueItemId", a."status"
      FROM "TaggingAuditItem" a
      WHERE a."queueItemId" IN (${Prisma.join(lockedQueueItemIds)})
      FOR UPDATE
    `);
    const statusesByQueueItem = new Map<number, string[]>();
    for (const auditItem of lockedAuditItems) {
      const statuses = statusesByQueueItem.get(auditItem.queueItemId) ?? [];
      statuses.push(auditItem.status);
      statusesByQueueItem.set(auditItem.queueItemId, statuses);
    }
    const untouchedQueueItemIds = lockedQueueItemIds.filter((id) => {
      const statuses = statusesByQueueItem.get(id) ?? [];
      return statuses.length > 0 && statuses.every((status) => status === "pending");
    });
    if (untouchedQueueItemIds.length === 0) return 0;

    await tx.taggingAuditItem.deleteMany({
      where: { queueItemId: { in: untouchedQueueItemIds }, status: "pending" },
    });
    await tx.taggingQueueItem.updateMany({
      where: { id: { in: untouchedQueueItemIds }, teamId, status: "completed" },
      data: {
        status: "pending",
        startsAt: null,
        endsAt: null,
        result: {},
      },
    });
    return untouchedQueueItemIds.length;
  });
}
