import "server-only";

import { getCDNUrl, setOssObjectAclPublicRead } from "@/lib/oss";
import { slugToId } from "@/lib/slug";
import prisma from "@/prisma/prisma";

import { saveFeatureToMuseDAM } from "./assets";
import type { MuseDAMSaveFeatureType } from "./save-feature-types";

export async function resolveMuseDAMTagIdsForAssetTags(
  teamId: number,
  assetTagIds: number[],
): Promise<number[]> {
  if (assetTagIds.length === 0) {
    return [];
  }

  const unique = [...new Set(assetTagIds)];
  const tags = await prisma.assetTag.findMany({
    where: {
      teamId,
      id: { in: unique },
    },
    select: { id: true, slug: true },
  });

  const byId = new Map(tags.map((row) => [row.id, row]));
  const musedamTagIds: number[] = [];

  for (const id of unique) {
    const tag = byId.get(id);
    if (!tag?.slug) {
      continue;
    }
    try {
      musedamTagIds.push(Number(slugToId("assetTag", tag.slug).toString()));
    } catch {
      // slug is not a MuseDAM assetTag slug (e.g. not yet synced)
    }
  }

  return musedamTagIds;
}

/**
 * Notify MuseDAM after a tagging feature is created or updated.
 * Runs asynchronously; failures are logged and do not affect the server action result.
 */
export function schedulePushFeatureToMuseDAM(payload: {
  team: { id: number; slug: string };
  featureType: MuseDAMSaveFeatureType;
  identifierId: string;
  identifierName: string;
  identifierTypeId: string;
  identifierTypeName: string;
  firstImageObjectKey: string | undefined;
  internalAssetTagIds: number[];
}): void {
  const {
    team,
    featureType,
    identifierId,
    identifierName,
    identifierTypeId,
    identifierTypeName,
    firstImageObjectKey,
    internalAssetTagIds,
  } = payload;

  if (!firstImageObjectKey) {
    return;
  }

  void (async () => {
    try {
      const tagIdList = await resolveMuseDAMTagIdsForAssetTags(team.id, internalAssetTagIds);
      await setOssObjectAclPublicRead({ objectKey: firstImageObjectKey });
      await saveFeatureToMuseDAM({
        team,
        featureType,
        identifierId,
        identifierName,
        identifierTypeId,
        identifierTypeName,
        identifierImagePath: getCDNUrl(firstImageObjectKey),
        tagIdList,
      });
    } catch (error) {
      console.warn("[MuseDAM] save-feature failed (non-blocking):", error);
    }
  })();
}
