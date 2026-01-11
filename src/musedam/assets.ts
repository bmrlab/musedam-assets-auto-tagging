import { idToSlug } from "@/lib/slug";
import { AssetObjectTags } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { retrieveTeamCredentials } from "./apiKey";
import { requestMuseDAMAPI } from "./lib";
import { MuseDAMID } from "./types";

/**
 * 获取文件夹路径
 * @param param0
 * @returns
 */
async function fetchMuseDAMFolderPath({
  team,
  musedamFolderId,
}: {
  team: {
    id: number;
    slug: string;
  };
  musedamFolderId: MuseDAMID;
}) {
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const result: {
    [_id: string]: string;
  } = await requestMuseDAMAPI("/api/muse/folder-path", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: [musedamFolderId],
  });

  return result[musedamFolderId.toString()];
}

/**
 * 获取文件夹下的子文件夹id
 * @param param0
 * @returns
 */
export async function fetchMuseDAMFolderSubIds({
  team,
  musedamFolderIds,
}: {
  team: {
    id: number;
    slug: string;
  };
  musedamFolderIds: MuseDAMID[];
}) {
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const result: {
    [_id: string]: string;
  } = await requestMuseDAMAPI("/api/muse/get-sub-folder-ids", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: musedamFolderIds,
  });

  return result;
}

async function fetchContentAnalysisFromMuseDAM({
  team,
  musedamAssetId,
}: {
  team: {
    id: number;
    slug: string;
  };
  musedamAssetId: MuseDAMID;
}) {
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const result: {
    [_id: string]: string;
  } = await requestMuseDAMAPI("/api/muse/get-asset-analysis-result", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: [musedamAssetId],
  });
  return result[musedamAssetId.toString()];
}

// build AssetObjectTags from tags response from musedam
async function buildAssetObjectTags(
  musedamTags: { id: MuseDAMID; name: string }[],
): Promise<AssetObjectTags> {
  const tagSlugs = musedamTags.map(({ id: musedamTagId }) => idToSlug("assetTag", musedamTagId));
  const fields = { id: true, slug: true, name: true };
  const assetTags = await prisma.assetTag.findMany({
    where: {
      slug: { in: tagSlugs },
    },
    select: {
      ...fields,
      parent: {
        select: {
          ...fields,
          parent: {
            select: { ...fields },
          },
        },
      },
    },
  });
  return assetTags.map((tag) => ({
    tagId: tag.id,
    tagSlug: tag.slug!, // 因为有 where { slug }，这里不可能为空
    tagPath: [tag.parent?.parent?.name, tag.parent?.name, tag.name].filter(
      (item) => item !== undefined,
    ),
  }));
}

/**
 * 根据单个 MuseDAM asset ID 获取素材详情并同步到数据库
 */
export async function syncSingleAssetFromMuseDAM({
  musedamAssetId,
  team,
}: {
  musedamAssetId: MuseDAMID;
  team: {
    id: number;
    slug: string;
  };
}) {
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });

  // 调用 assets-by-ids API 获取单个素材
  const assets = await requestMuseDAMAPI<{ id: MuseDAMID }[]>("/api/muse/assets-by-ids", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: [musedamAssetId],
  });

  if (!assets || assets.length === 0) {
    throw new Error(`Asset not found`);
  }

  const musedamAsset = assets[0] as {
    id: MuseDAMID;
    name: string;
    parentIds: MuseDAMID[];
    description: string | null;
    tags: { id: MuseDAMID; name: string }[] | null;
    thumbnailAccessUrl: string;
  };

  const musedamFolderId = musedamAsset.parentIds[0];
  const [folderPath, contentAnalysis, tags] = await Promise.all([
    musedamFolderId ? fetchMuseDAMFolderPath({ team, musedamFolderId }) : Promise.resolve(""),
    fetchContentAnalysisFromMuseDAM({ team, musedamAssetId }),
    buildAssetObjectTags(musedamAsset.tags ?? []),
  ]);
  const assetSlug = idToSlug("assetObject", musedamAsset.id);
  // 更新或创建 asset 记录
  const assetObject = await prisma.assetObject.upsert({
    where: {
      teamId: team.id,
      slug: assetSlug,
    },
    create: {
      teamId: team.id,
      slug: assetSlug,
      name: musedamAsset.name,
      description: musedamAsset.description || "",
      materializedPath: folderPath,
      content: contentAnalysis,
      tags,
      extra: musedamAsset,
    },
    update: {
      name: musedamAsset.name,
      description: musedamAsset.description || "",
      materializedPath: folderPath,
      content: contentAnalysis,
      tags,
      extra: musedamAsset,
    },
  });

  return { assetObject, musedamAsset };
}

/**
 * 批量同步资产的 thumbnailAccessUrl（轻量级，只更新缩略图URL，防止签名过期）
 */
export async function batchSyncAssetThumbnails({
  musedamAssetIds,
  team,
}: {
  musedamAssetIds: MuseDAMID[];
  team: {
    id: number;
    slug: string;
  };
}): Promise<void> {
  if (musedamAssetIds.length === 0) return;

  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });

  // 批量调用 assets-by-ids API 获取所有资产的基本信息
  const assets = await requestMuseDAMAPI<
    Array<{
      id: MuseDAMID;
      thumbnailAccessUrl: string;
    }>
  >("/api/muse/assets-by-ids", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: musedamAssetIds,
  });

  if (!assets || assets.length === 0) return;

  // 批量更新数据库中的 thumbnailAccessUrl
  await Promise.all(
    assets.map(async (musedamAsset) => {
      try {
        const assetSlug = idToSlug("assetObject", musedamAsset.id);
        const existingAsset = await prisma.assetObject.findUnique({
          where: {
            teamId: team.id,
            slug: assetSlug,
          },
          select: { id: true, extra: true },
        });

        if (existingAsset) {
          // 只更新 extra 中的 thumbnailAccessUrl，保留其他字段
          const extra = (existingAsset.extra as Record<string, unknown>) || {};
          await prisma.assetObject.update({
            where: { id: existingAsset.id },
            data: {
              extra: {
                ...extra,
                thumbnailAccessUrl: musedamAsset.thumbnailAccessUrl,
              },
            },
          });
        }
      } catch (error) {
        // 单个资产更新失败不影响其他资产
        console.error(`更新资产缩略图失败 (assetId: ${musedamAsset.id}):`, error);
      }
    }),
  );
}

export async function setAssetTagsToMuseDAM({
  musedamAssetId,
  musedamTagIds,
  append,
  team,
}: {
  musedamAssetId: MuseDAMID;
  musedamTagIds: MuseDAMID[];
  append: boolean;
  team: {
    id: number;
    slug: string;
  };
}) {
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const result = await requestMuseDAMAPI("/api/muse/set-assets-tags", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: {
      assetIds: [musedamAssetId],
      tagIds: musedamTagIds,
      remove: !append,
    },
  });
  console.log("set-assets-tags", result);
  return result;
}

// setting-assets-tags

/**
 * For testing purposes.
 */
export async function syncAssetsFromMuseDAM({
  musedamFolderId,
  team,
}: {
  musedamFolderId?: MuseDAMID;
  team: {
    id: number;
    slug: string;
  };
}) {
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const result = await requestMuseDAMAPI<{ assets: { id: MuseDAMID }[] }>(
    "/api/muse/search-assets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${musedamTeamApiKey}`,
      },
      body: {
        parentId: musedamFolderId,
        sort: {
          sortName: "CREATE_TIME",
          sortType: "DESC",
        },
        startPoint: 0,
        endPoint: 40,
      },
    },
  );
  await Promise.all(
    result.assets.map(async (asset: { id: MuseDAMID }) => {
      const waitTime = Math.floor(Math.random() * 10000) + 1000; // 1-10 seconds in milliseconds
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      await syncSingleAssetFromMuseDAM({
        musedamAssetId: asset.id,
        team,
      });
    }),
  );

  return result;
}
