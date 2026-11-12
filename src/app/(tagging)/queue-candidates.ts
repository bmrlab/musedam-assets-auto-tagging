import { VIDEO_EXTENSIONS } from "@/lib/feature-library";
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
  deferVideo = false,
): Promise<QueueCandidate[]> {
  // Filter before limiting the per-team candidates so waiting videos cannot hide image jobs.
  const eligible = deferVideo && lane !== "tree" ? Prisma.sql`
    AND NOT (
      COALESCE(q."extra"->'featureClassify' = 'true'::jsonb, false)
      AND (
        q."extra"->'featureBrand' IS DISTINCT FROM 'false'::jsonb
        OR q."extra"->'featureProduct' IS DISTINCT FROM 'false'::jsonb
        OR q."extra"->'featureIp' IS DISTINCT FROM 'false'::jsonb
      )
      AND EXISTS (
        SELECT 1 FROM "AssetObject" a WHERE a."id" = q."assetObjectId"
          AND lower(regexp_replace(btrim(a."extra"->>'extension'), '^\\.', ''))
            IN (${Prisma.join([...VIDEO_EXTENSIONS])})
      )
    )` : Prisma.empty;
  return prisma.$queryRaw<QueueCandidate[]>(Prisma.sql`
    WITH teams AS (
      SELECT t."id" AS "teamId" FROM "Team" t
      WHERE EXISTS (SELECT 1 FROM "TaggingQueueItem" q WHERE q."teamId" = t."id"
        AND q."status" = 'pending' AND (${QUEUE_LANE_SQL}) = ${lane} ${eligible})
      ORDER BY (t."id" > ${afterTeamId}) DESC, t."id" LIMIT ${limit}
    )
    SELECT candidate."id", candidate."teamId", candidate."taskType", candidate."createdAt"
    FROM teams t CROSS JOIN LATERAL (
      SELECT "id", "teamId", "taskType", "createdAt", row_number() OVER (ORDER BY "createdAt", "id") AS ordinal
      FROM "TaggingQueueItem" q WHERE "teamId" = t."teamId" AND "status" = 'pending'
        AND (${QUEUE_LANE_SQL}) = ${lane} ${eligible}
      ORDER BY "createdAt", "id" LIMIT ${perTeamLimit}
    ) candidate
    ORDER BY candidate.ordinal, (candidate."teamId" > ${afterTeamId}) DESC, candidate."teamId" LIMIT ${limit}`);
}
