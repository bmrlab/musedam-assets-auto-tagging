import { slugToId } from "@/lib/slug";
import { AssetObject } from "@/prisma/client";
import "server-only";

async function fetchAssetObjectDetail(assetObject: AssetObject) {
  const musedamAssetId = slugToId("assetObject", assetObject.slug);
  // TODO: 获取详情
}
