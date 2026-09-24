import "server-only";

import { idToSlug, slugToId } from "@/lib/slug";
import { retrieveTeamCredentials } from "@/musedam/apiKey";
import { requestMuseDAMAPI } from "@/musedam/lib";
import { AssetTag } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { MuseDAMID } from "../types";

type MuseDAMTagTree = {
  id: MuseDAMID;
  name: string;
  sort: number;
  children: MuseDAMTagTree | null;
}[];

/**
 * 以 MuseDAM 标签树为准收敛本地 AssetTag，但**不改动已存在标签的 id**：
 * - 两边都有（同父节点下同名）：保留原行，只回填 slug / sort；
 * - MuseDAM 有、本地没有：新增；
 * - 本地有、MuseDAM 没有：删除（连同其子孙）。
 *
 * 之前的实现是先 deleteMany 全部标签再重建，会让所有 id 变化，进而把审核项、特征库推荐标签
 * 等指向 AssetTag 的外键全部置空。
 */
export async function syncTagsFromMuseDAM({
  team,
}: {
  team: {
    id: number;
    slug: string;
  };
}) {
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const musedamTeamId = slugToId("team", team.slug);

  const result = await requestMuseDAMAPI("/api/muse/query-tag-tree", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: {
      orgId: musedamTeamId,
    },
  });

  const teamId = team.id;
  const musedamTags = result as MuseDAMTagTree;

  // 本地现有标签按「父 id + 名称」索引，一次查全，避免逐个 findMany
  const existingTags = await prisma.assetTag.findMany({ where: { teamId } });
  const existingByKey = new Map<string, AssetTag>();
  const keyOf = (parentId: number | null, name: string) => `${parentId ?? "root"}\u0000${name}`;
  for (const tag of existingTags) {
    existingByKey.set(keyOf(tag.parentId, tag.name), tag);
  }

  // MuseDAM 树里出现过的本地标签 id；不在这个集合里的最后统一删除
  const keptIds = new Set<number>();

  const upsert = async function ({
    name,
    slug,
    level,
    parentId,
    sort,
  }: {
    name: string;
    slug: string;
    level: 1 | 2 | 3;
    parentId: number | null;
    sort: number;
  }): Promise<AssetTag> {
    const existing = existingByKey.get(keyOf(parentId, name));
    let assetTag: AssetTag;
    if (existing) {
      // 两边都有：保留 id，只在 slug / sort 有变化时更新
      if (existing.slug !== slug || existing.sort !== sort) {
        assetTag = await prisma.assetTag.update({
          where: { id: existing.id },
          data: { slug, sort },
        });
      } else {
        assetTag = existing;
      }
    } else {
      assetTag = await prisma.assetTag.create({
        data: { teamId, level, name, slug, parentId, sort },
      });
      existingByKey.set(keyOf(parentId, name), assetTag);
    }
    keptIds.add(assetTag.id);
    return assetTag;
  };

  for (const level1Tag of musedamTags) {
    const level1AssetTag = await upsert({
      name: level1Tag.name,
      slug: idToSlug("assetTag", level1Tag.id),
      level: 1,
      parentId: null,
      sort: level1Tag.sort,
    });
    for (const level2Tag of level1Tag.children ?? []) {
      const level2AssetTag = await upsert({
        name: level2Tag.name,
        slug: idToSlug("assetTag", level2Tag.id),
        level: 2,
        parentId: level1AssetTag.id,
        sort: level2Tag.sort,
      });
      for (const level3Tag of level2Tag.children ?? []) {
        await upsert({
          name: level3Tag.name,
          slug: idToSlug("assetTag", level3Tag.id),
          level: 3,
          parentId: level2AssetTag.id,
          sort: level3Tag.sort,
        });
      }
    }
  }

  // 本地有、MuseDAM 没有：删除。父节点被删时子孙也不在 keptIds 里，一并删掉，不会留孤儿。
  const staleIds = existingTags.map((tag) => tag.id).filter((id) => !keptIds.has(id));
  if (staleIds.length > 0) {
    await prisma.assetTag.deleteMany({ where: { teamId, id: { in: staleIds } } });
  }

  return musedamTags;
}
