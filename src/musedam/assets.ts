import { idToSlug } from "@/lib/slug";
import prisma from "@/prisma/prisma";
import { retrieveTeamCredentials } from "./apiKey";
import { requestMuseDAMAPI } from "./lib";

async function fetchMuseDAMFolderPath({
  team,
  musedamFolderId,
}: {
  team: {
    id: number;
    slug: string;
  };
  musedamFolderId: number;
}) {
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const result: {
    [musedamFolderId]: string;
  } = await requestMuseDAMAPI("/api/muse/folder-path", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: [musedamFolderId],
  });
  return result[musedamFolderId];
}

/**
 * For testing purposes.
 */
export async function syncAssetsFromMuseDAM({
  musedamFolderId,
  team,
}: {
  musedamFolderId?: number;
  team: {
    id: number;
    slug: string;
  };
}) {
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const result = await requestMuseDAMAPI("/api/muse/search-assets", {
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
  });
  const assets = result.assets as {
    id: number;
    name: string;
    parentIds: number[];
    description: string | null;
    tags: { id: number; name: string }[];
  }[];
  for (const asset of assets) {
    const musedamFolderId = asset.parentIds[0];
    const folderPath = await fetchMuseDAMFolderPath({
      team,
      musedamFolderId,
    });
    // console.log(`Asset ${asset.id} is in folder ${folderPath}`);
    const assetSlug = idToSlug("assetObject", asset.id.toString());
    await prisma.assetObject.upsert({
      where: {
        teamId: team.id,
        slug: assetSlug,
      },
      create: {
        teamId: team.id,
        slug: assetSlug,
        name: asset.name,
        description: asset.description || "",
        materializedPath: folderPath,
        tags: asset.tags.map((tag) => tag.name),
      },
      update: {
        name: asset.name,
        description: asset.description || "",
        materializedPath: folderPath,
        tags: asset.tags.map((tag) => tag.name),
      },
    });
  }
  return result;
}
