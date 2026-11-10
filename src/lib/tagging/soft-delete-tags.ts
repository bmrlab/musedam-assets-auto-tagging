import type { Prisma } from "@/prisma/client";

/** Keep tombstones and all historical FKs. The recursive query is always team scoped. */
export async function softDeleteTagSubtree(
  tx: Prisma.TransactionClient,
  teamId: number,
  tagId: number,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${teamId}::int, 5521735::int)::text`;
  const count = await tx.$executeRaw`WITH RECURSIVE subtree AS (
    SELECT "id" FROM "AssetTag" WHERE "teamId" = ${teamId} AND "id" = ${tagId} AND "deletedAt" IS NULL
    UNION
    SELECT child."id" FROM "AssetTag" child JOIN subtree ON child."parentId" = subtree."id"
    WHERE child."teamId" = ${teamId} AND child."deletedAt" IS NULL
  ) UPDATE "AssetTag" SET "deletedAt" = now(), "updatedAt" = now()
    WHERE "teamId" = ${teamId} AND "id" IN (SELECT "id" FROM subtree)`;
  if (!count) return 0;
  await cancelPendingTagImports(tx, teamId);
  return count;
}

/** Superseded remote receipts are evidence, never instructions to restore an older tree. */
export async function cancelPendingTagImports(
  tx: Prisma.TransactionClient,
  teamId: number,
  exceptKey: string | null = null,
) {
  await tx.$executeRaw`UPDATE "TeamConfig" SET "value" = jsonb_set("value", '{state}', '"cancelled"'::jsonb), "updatedAt" = now()
    WHERE "teamId" = ${teamId} AND "key" LIKE 'tag-tree-import:%'
    AND (${exceptKey}::text IS NULL OR "key" <> ${exceptKey})
    AND "value"->>'state' IN ('pending', 'remoteCommitted')`;
}
