import "server-only";
import type { Prisma } from "@/prisma/client";
import type { SavedTagSort } from "./tagSort";

/** 一次参数化 UPDATE 保存同级排序，避免大同级列表在事务内逐条往返数据库。 */
export async function saveTagSortInTransaction(
  tx: Prisma.TransactionClient,
  teamId: number,
  sorts: SavedTagSort[],
) {
  if (!sorts.length) return;
  const ids = sorts.map(item => item.id);
  const values = sorts.map(item => item.sort);
  const count = await tx.$executeRaw`
    UPDATE "AssetTag" AS tag SET "sort" = saved.sort, "updatedAt" = now()
    FROM unnest(${ids}::int[], ${values}::int[]) AS saved(id, sort)
    WHERE tag."teamId" = ${teamId} AND tag."deletedAt" IS NULL AND tag."id" = saved.id`;
  if (count !== sorts.length) throw new Error("标签已变化，请刷新后核对排序");
}
