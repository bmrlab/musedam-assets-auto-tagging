import "server-only";
import { syncSingleAssetFromMuseDAM } from "@/musedam/assets";
import { slugToId } from "@/lib/slug";
import prisma from "@/prisma/prisma";
import type { AssetObject } from "@/prisma/client";

/** A queued row is a reference to the asset, not a fresh OCR/URL/path snapshot. */
export async function refreshQueuedAsset(teamId: number, asset: AssetObject): Promise<AssetObject> {
  if (asset.teamId !== teamId) throw new Error("Queued asset belongs to another team");
  const extra = asset.extra as { localTest?: boolean } | null;
  if (asset.slug.startsWith("local-test-") && extra?.localTest === true) return asset;
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { id: true, slug: true } });
  const { assetObject } = await syncSingleAssetFromMuseDAM({ team, musedamAssetId: slugToId("assetObject", asset.slug) });
  if (assetObject.id !== asset.id || assetObject.teamId !== teamId) throw new Error("Refreshed asset identity changed");
  return assetObject;
}
