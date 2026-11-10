import { Prisma, TaggingQueueStatus } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import type { DashboardTaskListItem } from "./dashboard-list-data";

type DashboardTaskRow = {
  id: number;
  status: TaggingQueueStatus;
  startsAt: Date | null;
  endsAt: Date | null;
  result: Prisma.JsonValue;
  assetObjectId: number;
  assetName: string;
  assetSlug: string;
  assetExtra: Prisma.JsonValue;
};

/**
 * 按已排好序的 id 列表回表，只投影看板展示字段。
 * 避免 include 整行 result / assetObject.extra（主站素材快照）。
 */
export async function loadDashboardTaskListItems(
  teamId: number,
  ids: number[],
): Promise<DashboardTaskListItem[]> {
  if (ids.length === 0) return [];

  const rows = await prisma.$queryRaw<DashboardTaskRow[]>(
    Prisma.sql`
      SELECT
        q."id",
        q."status",
        q."startsAt",
        q."endsAt",
        CASE
          WHEN q."status" = 'failed' THEN jsonb_build_object('error', q."result" -> 'error')
          ELSE '{}'::jsonb
        END AS "result",
        a."id" AS "assetObjectId",
        a."name" AS "assetName",
        a."slug" AS "assetSlug",
        jsonb_strip_nulls(
          jsonb_build_object(
            'thumbnailAccessUrl', a."extra" -> 'thumbnailAccessUrl',
            'extension', a."extra" -> 'extension',
            'size', a."extra" -> 'size'
          )
        ) AS "assetExtra"
      FROM "TaggingQueueItem" q
      INNER JOIN "AssetObject" a ON a."id" = q."assetObjectId"
      WHERE q."teamId" = ${teamId}
        AND q."id" IN (${Prisma.join(ids)})
    `,
  );

  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [
      {
        id: row.id,
        status: row.status,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        result: (row.result ?? {}) as DashboardTaskListItem["result"],
        assetObject: {
          id: row.assetObjectId,
          name: row.assetName,
          slug: row.assetSlug,
          extra: (row.assetExtra ?? {}) as DashboardTaskListItem["assetObject"]["extra"],
        },
      },
    ];
  });
}
