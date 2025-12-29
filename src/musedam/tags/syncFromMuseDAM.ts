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

  // 获取本地现有的标签树
  const localTags = await prisma.assetTag.findMany({
    where: { teamId },
    include: {
      children: {
        include: {
          children: true,
        },
      },
    },
  });

  // 按层级和父级组织本地标签
  const localTagsByLevel = {
    1: localTags.filter((tag) => tag.level === 1 && tag.parentId === null),
    2: localTags.filter((tag) => tag.level === 2),
    3: localTags.filter((tag) => tag.level === 3),
  };

  // 同步第一级标签
  const musedamLevel1Names = new Set(musedamTags.map((tag) => tag.name));

  // 删除本地存在但 MuseDAM 不存在的第一级标签（需要先删除所有子标签）
  const toDeleteLevel1 = localTagsByLevel[1].filter((tag) => !musedamLevel1Names.has(tag.name));
  if (toDeleteLevel1.length > 0) {
    const toDeleteLevel1Ids = toDeleteLevel1.map((tag) => tag.id);
    // 找到所有属于这些第一级标签的第二级标签
    const toDeleteLevel2Ids = localTagsByLevel[2]
      .filter((tag) => tag.parentId && toDeleteLevel1Ids.includes(tag.parentId))
      .map((tag) => tag.id);
    // 先删除所有第三级子标签
    if (toDeleteLevel2Ids.length > 0) {
      await prisma.assetTag.deleteMany({
        where: {
          level: 3,
          parentId: { in: toDeleteLevel2Ids },
        },
      });
    }
    // 再删除所有第二级子标签
    if (toDeleteLevel2Ids.length > 0) {
      await prisma.assetTag.deleteMany({
        where: {
          id: { in: toDeleteLevel2Ids },
        },
      });
    }
    // 最后删除第一级标签
    await prisma.assetTag.deleteMany({
      where: {
        id: { in: toDeleteLevel1Ids },
      },
    });
  }

  // 同步所有层级的标签（在一个循环中完成）
  const level1Mapping = new Map<string, AssetTag>(); // name -> AssetTag

  for (const level1Tag of musedamTags) {
    // 同步第一级标签
    const existingLevel1Tag = localTagsByLevel[1].find((tag) => tag.name === level1Tag.name);

    let level1AssetTag: AssetTag;
    if (existingLevel1Tag) {
      // 更新现有标签的 sort 和 slug
      level1AssetTag = await prisma.assetTag.update({
        where: { id: existingLevel1Tag.id },
        data: {
          sort: level1Tag.sort,
          slug: idToSlug("assetTag", level1Tag.id),
        },
      });
    } else {
      // 新增标签
      level1AssetTag = await prisma.assetTag.create({
        data: {
          teamId,
          name: level1Tag.name,
          slug: idToSlug("assetTag", level1Tag.id),
          level: 1,
          parentId: null,
          sort: level1Tag.sort,
        },
      });
    }
    level1Mapping.set(level1Tag.name, level1AssetTag);

    // 同步第二级标签
    const musedamLevel2Tags = level1Tag.children ?? [];
    const musedamLevel2Names = new Set(musedamLevel2Tags.map((tag) => tag.name));
    const localLevel2Tags = localTagsByLevel[2].filter((tag) => tag.parentId === level1AssetTag.id);

    // 删除本地存在但 MuseDAM 不存在的第二级标签（需要先删除所有子标签）
    const toDeleteLevel2 = localLevel2Tags.filter((tag) => !musedamLevel2Names.has(tag.name));
    if (toDeleteLevel2.length > 0) {
      const toDeleteLevel2Ids = toDeleteLevel2.map((tag) => tag.id);
      // 先删除所有第三级子标签
      await prisma.assetTag.deleteMany({
        where: {
          level: 3,
          parentId: { in: toDeleteLevel2Ids },
        },
      });
      // 再删除第二级标签
      await prisma.assetTag.deleteMany({
        where: {
          id: { in: toDeleteLevel2Ids },
        },
      });
    }

    // 同步第二级标签
    const level2Mapping = new Map<string, AssetTag>(); // name -> AssetTag

    for (const level2Tag of musedamLevel2Tags) {
      const existingLevel2Tag = localLevel2Tags.find((tag) => tag.name === level2Tag.name);

      let level2AssetTag: AssetTag;
      if (existingLevel2Tag) {
        // 更新现有标签的 sort 和 slug
        level2AssetTag = await prisma.assetTag.update({
          where: { id: existingLevel2Tag.id },
          data: {
            sort: level2Tag.sort,
            slug: idToSlug("assetTag", level2Tag.id),
          },
        });
      } else {
        // 新增标签
        level2AssetTag = await prisma.assetTag.create({
          data: {
            teamId,
            name: level2Tag.name,
            slug: idToSlug("assetTag", level2Tag.id),
            level: 2,
            parentId: level1AssetTag.id,
            sort: level2Tag.sort,
          },
        });
      }
      level2Mapping.set(level2Tag.name, level2AssetTag);

      // 同步第三级标签
      const musedamLevel3Tags = level2Tag.children ?? [];
      const musedamLevel3Names = new Set(musedamLevel3Tags.map((tag) => tag.name));
      const localLevel3Tags = localTagsByLevel[3].filter(
        (tag) => tag.parentId === level2AssetTag.id,
      );

      // 删除本地存在但 MuseDAM 不存在的第三级标签
      const toDeleteLevel3 = localLevel3Tags.filter((tag) => !musedamLevel3Names.has(tag.name));
      if (toDeleteLevel3.length > 0) {
        await prisma.assetTag.deleteMany({
          where: {
            id: { in: toDeleteLevel3.map((tag) => tag.id) },
          },
        });
      }

      // 同步第三级标签
      for (const level3Tag of musedamLevel3Tags) {
        const existingLevel3Tag = localLevel3Tags.find((tag) => tag.name === level3Tag.name);

        if (existingLevel3Tag) {
          // 更新现有标签的 sort 和 slug
          await prisma.assetTag.update({
            where: { id: existingLevel3Tag.id },
            data: {
              sort: level3Tag.sort,
              slug: idToSlug("assetTag", level3Tag.id),
            },
          });
        } else {
          // 新增标签
          await prisma.assetTag.create({
            data: {
              teamId,
              name: level3Tag.name,
              slug: idToSlug("assetTag", level3Tag.id),
              level: 3,
              parentId: level2AssetTag.id,
              sort: level3Tag.sort,
            },
          });
        }
      }
    }
  }

  return musedamTags;
}
