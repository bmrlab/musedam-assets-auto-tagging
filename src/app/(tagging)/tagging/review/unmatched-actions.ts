"use server";

import { checkUserPermission } from "@/app/(auth)/lib";
import { withAuth } from "@/app/(auth)/withAuth";
import { getServerFeatureLibraryFeatures } from "@/lib/feature-library-server";
import { fetchMetadataContext } from "@/musedam/metadata";
import prisma from "@/prisma/prisma";
import { unmatchedQuery, type UnmatchedFilters } from "./unmatched-query";

export async function fetchUnmatchedReviewAssets(
  page: number,
  pageSize: number,
  filters: UnmatchedFilters,
) {
  return withAuth(async ({ team, user }) => {
    await checkUserPermission({ team, user });
    const [features, metadata] = await Promise.all([
      getServerFeatureLibraryFeatures(),
      filters.content === "all" || filters.content === "fields"
        ? fetchMetadataContext(team)
        : Promise.resolve({ enabled: false }),
    ]);
    const capabilities = {
      fields: metadata.enabled,
      brand: features.featureBrand,
      ip: features.featureIp,
      product: features.featureProduct,
      person: features.featurePerson,
    };
    const [rows, totals] = await Promise.all([
      prisma.$queryRaw<{ queueId: number; assetObjectId: number; createdAt: Date }[]>(
        unmatchedQuery(team.id, filters, capabilities, page, pageSize),
      ),
      prisma.$queryRaw<{ total: number }[]>(
        unmatchedQuery(team.id, filters, capabilities, page, pageSize, true),
      ),
    ]);
    const assets = await prisma.assetObject.findMany({
      where: { teamId: team.id, id: { in: rows.map((row) => row.assetObjectId) } },
      select: { id: true, name: true, slug: true, extra: true },
    });
    return {
      total: totals[0]?.total ?? 0,
      assets: rows.flatMap((row) => {
        const asset = assets.find((asset) => asset.id === row.assetObjectId);
        return asset ? [{ assetObject: asset, createdAt: row.createdAt }] : [];
      }),
    };
  });
}
