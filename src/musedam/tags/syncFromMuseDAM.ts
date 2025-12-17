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
  // 先删除当前团队的所有标签
  await prisma.assetTag.deleteMany({
    where: {
      teamId: team.id,
    },
  });

  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const musedamTeamId = slugToId("team", team.slug);

  // const url = `${process.env.MUSEDAM_API_BASE_URL}/api/muse/query-tag-tree`;
  // const requestHeaders = {
  //   "Content-Type": "application/json",
  //   "x-asm-prefer-tag": "version-env-06",
  //   Authorization: `Bearer ${musedamTeamApiKey}`,
  // };
  // const requestBody = JSON.stringify({
  //   orgId: musedamTeamId,
  // })

  // // 打印curl命令
  // const curlCommand = generateCurlCommand(url, "POST", requestHeaders, requestBody);
  // console.log("🔗 Curl Command:");
  // console.log(curlCommand);

  const result = await requestMuseDAMAPI("/api/muse/query-tag-tree", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: {
      orgId: musedamTeamId,
    },
  });
  // console.log("result", result);

  const teamId = team.id;
  const musedamTags = result as MuseDAMTagTree;
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
  }) {
    const where = parentId
      ? { teamId, parentId, name }
      : { teamId, name, parentId: { equals: null } };
    const assetTag = await prisma.$transaction(async (tx) => {
      let assetTag: AssetTag;
      const assetTags = await tx.assetTag.findMany({ where });
      if (assetTags[0]) {
        // 更新现有标签的 sort 字段
        assetTag = await tx.assetTag.update({
          where: { id: assetTags[0].id },
          data: { sort },
        });
      } else {
        assetTag = await tx.assetTag.create({
          data: { teamId, level, name, slug, parentId, sort },
        });
      }
      return assetTag;
    });
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
    // console.log(level1Tag, level1AssetTag);
    for (const level2Tag of level1Tag.children ?? []) {
      const level2AssetTag = await upsert({
        name: level2Tag.name,
        slug: idToSlug("assetTag", level2Tag.id),
        level: 2,
        parentId: level1AssetTag.id,
        sort: level2Tag.sort,
      });
      // console.log(level2Tag, level2AssetTag);
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
  return musedamTags;
}
