import "server-only";

import prisma from "@/prisma/prisma";

export type BatchImportTagLookup = Map<
  string,
  {
    assetTagId: number;
    tagPath: string[];
  }
>;

export function normalizeBatchImportTagPath(value: string) {
  return value
    .split(">")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join(">");
}

function splitTagPath(value: string) {
  return value
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function findMissingBatchImportTagPaths({
  tagPathValues,
  tagLookup,
}: {
  tagPathValues: string[];
  tagLookup: BatchImportTagLookup;
}) {
  const missingPaths = new Map<string, string>();

  for (const value of tagPathValues) {
    const path = splitTagPath(value);
    const normalizedPath = normalizeBatchImportTagPath(path.join(" > "));

    if (!normalizedPath || tagLookup.has(normalizedPath) || missingPaths.has(normalizedPath)) {
      continue;
    }

    missingPaths.set(normalizedPath, path.join(" > "));
  }

  return Array.from(missingPaths.values());
}

/** Shared prefixes are resolved once; inserts are bounded and grouped by tree depth. */
export async function createMissingBatchImportTagTrees({
  teamId,
  tagPaths,
}: {
  teamId: number;
  tagPaths: string[];
}) {
  const paths = tagPaths.map(splitTagPath).filter((path) => path.length);
  if (paths.some((path) => path.length > 4)) throw new Error("标签层级不能超过 4 级");
  if (!paths.length) return;
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${teamId}::int, 5521735::int)::text`;
      const key = (parentId: number | null, name: string) =>
        JSON.stringify([parentId, name.toLowerCase()]);
      const load = async () =>
        new Map(
          (
            await tx.assetTag.findMany({
              where: { teamId, deletedAt: null },
              select: { id: true, parentId: true, name: true },
              orderBy: { id: "asc" },
            })
          ).map((tag) => [key(tag.parentId, tag.name), tag]),
        );
      let index = await load();
      let level = paths.map((names) => ({ names, parentId: null as number | null }));
      let depth = 1;
      while (level.length) {
        const missing = new Map<
          string,
          { teamId: number; parentId: number | null; name: string; level: number }
        >();
        for (const { names, parentId } of level) {
          const k = key(parentId, names[0]);
          if (!index.has(k) && !missing.has(k))
            missing.set(k, { teamId, parentId, name: names[0], level: depth });
        }
        const data = [...missing.values()];
        for (let offset = 0; offset < data.length; offset += 500) {
          const chunk = data.slice(offset, offset + 500);
          const created = await tx.assetTag.createManyAndReturn({
            data: chunk,
            skipDuplicates: true,
            select: { id: true, parentId: true, name: true },
          });
          for (const tag of created) index.set(key(tag.parentId, tag.name), tag);
          if (created.length < chunk.length) index = await load();
        }
        level = level.flatMap(({ names, parentId }) => {
          const tag = index.get(key(parentId, names[0]));
          if (!tag) throw new Error("标签创建冲突，请刷新后重试");
          return names.length > 1 ? [{ names: names.slice(1), parentId: tag.id }] : [];
        });
        depth++;
      }
    },
    { timeout: 60_000 },
  );
}
