import { pruneRejectionCountsForRemovedKeywords } from "@/app/(tagging)/keyword-feedback";
import { throwIfTagImportAborted } from "./tag-import-runtime";
import { assertTagImportOwnership } from "@/lib/tagging/tag-import-lock";
import type { AssetTagExtra, Prisma } from "@/prisma/client";
import { Prisma as PrismaSQL } from "@/prisma/client";
import "server-only";
import { bumpTagConfigVersion } from "./tag-config-version";

export type TagConfigImportUpdate = {
  importAncestorIds?: number[];
  tag: { id: number };
  record: {
    fields: {
      description?: string;
      keywords?: string[];
      negativeKeywords?: string[];
      siblingsExclusive?: boolean;
      requiredGroup?: boolean;
    };
  };
  autoDisabledRequiredGroup?: boolean;
  data: { name?: string; taggingEnabled?: boolean; extra?: AssetTagExtra };
};

/** 先按 ID 固定顺序锁行，再在最新 extra 上只合并用户给出的字段；不会覆盖后台刚写入的策略。 */
export async function applyTagConfigImportChunk(
  tx: Prisma.TransactionClient,
  teamId: number,
  items: TagConfigImportUpdate[],
  markImported = true,
) {
  if (!items.length) return [];
  await assertTagImportOwnership(tx);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${teamId}::int, 5521735::int)::text`;
  const lockIds = [
    ...new Set(items.flatMap((item) => [item.tag.id, ...(item.importAncestorIds ?? [])])),
  ];
  const rows = await tx.$queryRaw<Array<{ id: number; extra: Prisma.JsonValue }>>(PrismaSQL.sql`
    SELECT "id", "extra" FROM "AssetTag" WHERE "teamId" = ${teamId}
    AND "id" IN (${PrismaSQL.join(lockIds)}) ORDER BY "id" FOR UPDATE`);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const result = [];
  for (const item of items) {
    throwIfTagImportAborted();
    const current = byId.get(item.tag.id);
    if (!current) throw new Error(`Tag ${item.tag.id} no longer exists`);
    const extra: AssetTagExtra = {
      ...((current.extra ?? {}) as AssetTagExtra),
      ...(markImported ? { configurationSource: "import" as const } : {}),
    };
    const patch = item.record.fields;
    for (const key of ["description", "keywords", "siblingsExclusive", "requiredGroup"] as const) {
      if (patch[key] !== undefined) Object.assign(extra, { [key]: patch[key] });
    }
    if (patch.negativeKeywords !== undefined)
      Object.assign(extra, pruneRejectionCountsForRemovedKeywords(extra, patch.negativeKeywords));
    if (item.autoDisabledRequiredGroup) extra.requiredGroup = false;
    const saved = await tx.assetTag.update({
      where: { id: item.tag.id, teamId },
      data: {
        ...(item.data.name ? { name: item.data.name } : {}),
        ...(item.data.taggingEnabled !== undefined
          ? { taggingEnabled: item.data.taggingEnabled }
          : {}),
        extra,
      },
    });
    item.data.extra = extra;
    result.push(saved);
  }
  throwIfTagImportAborted();
  const ancestors = [...new Set(items.flatMap((item) => item.importAncestorIds ?? []))];
  if (markImported) await markImportedTagNodes(tx, teamId, ancestors);
  await bumpTagConfigVersion(tx, teamId);
  throwIfTagImportAborted();
  return result;
}

/** 只加来源标记，保留所有已写配置；隐式父级也不进入 AI 初始化。 */
export async function markImportedTagNodes(
  tx: Prisma.TransactionClient,
  teamId: number,
  ids: number[],
) {
  if (!ids.length) return;
  await tx.$executeRaw(PrismaSQL.sql`UPDATE "AssetTag"
    SET "extra" = (CASE WHEN jsonb_typeof("extra") = 'object' THEN "extra" ELSE '{}'::jsonb END) || '{"configurationSource":"import"}'::jsonb, "updatedAt" = now()
    WHERE "teamId" = ${teamId} AND "id" IN (${PrismaSQL.join([...new Set(ids)])})`);
}
