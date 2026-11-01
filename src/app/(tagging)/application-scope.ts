import { slugToId } from "@/lib/slug";
import { fetchMuseDAMFolderSubIds } from "@/musedam/assets";
import type { MuseDAMID } from "@/musedam/types";
import type { TaggingSettingsData } from "./types";

/**
 * 打标应用范围（设置页选中的文件夹）在两个入口的口径要一致：
 * 单素材实时接口一直会把选中文件夹的子文件夹一并纳入，批量接口之前只匹配直接父文件夹，
 * 导致定时/批量打标时子文件夹里的素材被判为"不在范围内"。这里抽成一处，两个接口共用。
 */

export type AllowedFolderIdSet = ReadonlySet<string> | null;

/**
 * 计算允许的文件夹 id 集合：选中目录 + 每个选中目录的所有子目录。
 * scopeType 为 all 时返回 null（不限制）。一次批量请求只算一次，避免对每个素材都请求 MuseDAM。
 */
export async function buildAllowedFolderIdSet({
  team,
  applicationScope,
}: {
  team: { id: number; slug: string };
  applicationScope: TaggingSettingsData["applicationScope"];
}): Promise<AllowedFolderIdSet> {
  if (applicationScope.scopeType === "all") return null;
  const selectedFolderIds = applicationScope.selectedFolders.map((folder) =>
    slugToId("assetFolder", folder.slug),
  );
  const allowed = new Set<string>(selectedFolderIds.map((id) => id.toString()));
  if (selectedFolderIds.length === 0) return allowed;

  const subIdsByFolder = await fetchMuseDAMFolderSubIds({
    team,
    musedamFolderIds: selectedFolderIds,
  });
  for (const [folderId, subIds] of Object.entries(subIdsByFolder ?? {})) {
    allowed.add(folderId);
    for (const subId of subIds ?? []) allowed.add(String(subId));
  }
  return allowed;
}

/** 素材任一父目录落在允许集合内即视为在范围内；allowed 为 null 表示不限制。 */
export function isAssetInApplicationScope(
  parentIds: ReadonlyArray<MuseDAMID | string | number>,
  allowed: AllowedFolderIdSet,
): boolean {
  if (allowed === null) return true;
  return parentIds.some((parentId) => allowed.has(String(parentId)));
}
