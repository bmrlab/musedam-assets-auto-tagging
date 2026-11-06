import { Prisma, type TaggingTaskType } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import "server-only";

export type QueueLane = "tree" | "test" | "production";
export type QueueCandidate = {
  id: number;
  teamId: number;
  taskType: TaggingTaskType;
  createdAt: Date;
};
// Keep this expression identical to the partial expression index in the migration.
export const QUEUE_LANE_SQL = Prisma.sql`CASE WHEN "extra"->>'jobKind' = 'tag-tree-generation' THEN 'tree'
  WHEN "taskType" = 'test' THEN 'test' ELSE 'production' END`;

/** Probe indexed heads per team, then fetch only a bounded number of candidates per eligible team. */
export async function loadFairQueueCandidates(
  lane: QueueLane,
  afterTeamId: number,
  perTeamLimit: number,
  limit = 200,
): Promise<QueueCandidate[]> {
  return prisma.$queryRaw<QueueCandidate[]>(Prisma.sql`
    WITH teams AS (
      SELECT t."id" AS "teamId" FROM "Team" t
      WHERE EXISTS (SELECT 1 FROM "TaggingQueueItem" q WHERE q."teamId" = t."id"
        AND q."status" = 'pending' AND (${QUEUE_LANE_SQL}) = ${lane})
      ORDER BY (t."id" > ${afterTeamId}) DESC, t."id" LIMIT ${limit}
    )
    SELECT q."id", q."teamId", q."taskType", q."createdAt"
    FROM teams t CROSS JOIN LATERAL (
      SELECT "id", "teamId", "taskType", "createdAt", row_number() OVER (ORDER BY "createdAt", "id") AS ordinal
      FROM "TaggingQueueItem" WHERE "teamId" = t."teamId" AND "status" = 'pending'
        AND (${QUEUE_LANE_SQL}) = ${lane}
      ORDER BY "createdAt", "id" LIMIT ${perTeamLimit}
    ) q
    ORDER BY q.ordinal, (q."teamId" > ${afterTeamId}) DESC, q."teamId" LIMIT ${limit}`);
}
