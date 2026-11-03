import "server-only";

import { retrieveTeamCredentials } from "@/musedam/apiKey";
import { requestMuseDAMAPI } from "@/musedam/lib";
import { Prisma } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export async function restoreDeletedAssets(input: {
  musedamTeamId: string;
  dryRun: boolean;
  afterId: number;
  limit: number;
  assetIds?: string[];
}) {
  const team = await prisma.team.findUnique({
    where: { slug: `t/${input.musedamTeamId}` },
    select: { id: true, slug: true },
  });
  if (!team) return null;
  const candidates = await prisma.assetObject.findMany({
    where: {
      teamId: team.id,
      id: { gt: input.afterId },
      extra: { path: ["reviewAssetDeleted"], equals: true },
      ...(input.assetIds ? { slug: { in: input.assetIds.map((id) => `a/${id}`) } } : {}),
    },
    select: { id: true, slug: true, name: true },
    orderBy: { id: "asc" },
    take: input.limit + 1,
  });
  const hasMore = candidates.length > input.limit;
  const batch = candidates.slice(0, input.limit);
  const available = new Set<string>();
  if (batch.length) {
    const { apiKey } = await retrieveTeamCredentials({ team });
    const assets = await requestMuseDAMAPI<{ id: string | number }[]>("/api/muse/assets-by-ids", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: batch.map(({ slug }) => slug.slice(2)),
    });
    if (!Array.isArray(assets) || assets.some((asset) => asset?.id == null)) {
      throw new Error("Invalid MuseDAM asset response");
    }
    assets.forEach(({ id }) => available.add(String(id)));
  }
  const results = [];
  for (const asset of batch) {
    if (!available.has(asset.slug.slice(2))) {
      results.push({ ...asset, outcome: "unavailable", auditItems: 0 });
      continue;
    }
    const count = await prisma.$transaction(async (tx) => {
      // Lock before rereading JSON so concurrent review/sync cannot be overwritten.
      await tx.$queryRaw`SELECT "id" FROM "AssetObject" WHERE "id" = ${asset.id} AND "teamId" = ${team.id} FOR UPDATE`;
      const current = await tx.assetObject.findUniqueOrThrow({
        where: { id: asset.id, teamId: team.id },
        select: { extra: true },
      });
      const extra = { ...(current.extra as Prisma.JsonObject) };
      if (extra.reviewAssetDeleted !== true) return null;
      const where = { teamId: team.id, assetObjectId: asset.id, status: "rejected" as const };
      if (input.dryRun) return tx.taggingAuditItem.count({ where });
      delete extra.reviewAssetDeleted;
      const updated = await tx.taggingAuditItem.updateMany({ where, data: { status: "pending" } });
      await tx.assetObject.update({ where: { id: asset.id, teamId: team.id }, data: { extra } });
      return updated.count;
    });
    results.push({
      ...asset,
      outcome: count === null ? "changed" : input.dryRun ? "eligible" : "restored",
      auditItems: count ?? 0,
    });
  }
  return {
    teamSlug: team.slug,
    dryRun: input.dryRun,
    previousStatusesUnavailable: true,
    results,
    hasMore,
    nextAfterId: hasMore ? batch[batch.length - 1].id : null,
  };
}
