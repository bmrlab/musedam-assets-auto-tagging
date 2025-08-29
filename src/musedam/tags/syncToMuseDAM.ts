import "server-only";

import { TagNode } from "@/app/tags/types";
import { slugToId } from "@/lib/slug";
import { retrieveTeamCredentials } from "@/musedam/apiKey";
import { requestMuseDAMAPI } from "@/musedam/lib";
import { AssetTag } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { MuseDAMID } from "../types";

interface MuseDAMTagRequest {
  id?: MuseDAMID;
  name: string;
  operation: 0 | 1 | 2 | 3; // 0不操作 1更新 2创建 3删除
  children?: MuseDAMTagRequest[];
}

/**
 * 将我们的 TagNode 转换为 MuseDAM API 格式
 */
function convertToMuseDAMFormat(node: TagNode): MuseDAMTagRequest | null {
  let operation: 0 | 1 | 2 | 3 = 0; // 默认不操作
  let musedamId: MuseDAMID | undefined;

  // 如果有 id，说明在数据库中已存在，可以获取其对应的 MuseDAM ID
  if (node.id) {
    const assetTag = findAssetTagById(node.id);
    if (assetTag?.slug) {
      musedamId = slugToId("assetTag", assetTag.slug);
    }
  }

  // 根据 verb 设置 operation
  switch (node.verb) {
    case "create":
      operation = 2; // 创建
      break;
    case "update":
      operation = 1; // 更新
      break;
    case "delete":
      operation = 3; // 删除
      break;
    default:
      operation = 0; // 不操作
  }

  // 如果是删除操作，必须有 MuseDAM ID
  if (operation === 3 && !musedamId) {
    return null; // 无法删除不存在的标签
  }

  // 如果是更新操作，必须有 MuseDAM ID
  if (operation === 1 && !musedamId) {
    operation = 2; // 改为创建操作
  }

  const result: MuseDAMTagRequest = {
    name: node.name,
    operation,
  };

  if (musedamId) {
    result.id = musedamId;
  }

  // 处理子标签
  if (node.children.length > 0) {
    const childrenRequests = node.children
      .map(convertToMuseDAMFormat)
      .filter(Boolean) as MuseDAMTagRequest[];

    if (childrenRequests.length > 0) {
      result.children = childrenRequests;
    }
  }

  return result;
}

// 简单的内存缓存，避免重复查询
const assetTagCache = new Map<number, AssetTag | null>();

function findAssetTagById(id: number): AssetTag | null {
  return assetTagCache.get(id) || null;
}

/**
 * 预加载所有相关的 AssetTag 数据到缓存
 */
async function preloadAssetTags(nodes: TagNode[], teamId: number): Promise<void> {
  const ids: number[] = [];

  const collectIds = (node: TagNode) => {
    if (node.id) {
      ids.push(node.id);
    }
    node.children.forEach(collectIds);
  };

  nodes.forEach(collectIds);

  if (ids.length > 0) {
    const assetTags = await prisma.assetTag.findMany({
      where: {
        id: { in: ids },
        teamId,
      },
    });

    // 填充缓存
    assetTags.forEach((tag) => {
      assetTagCache.set(tag.id, tag);
    });

    // 对于没找到的 ID，也要标记为 null
    ids.forEach((id) => {
      if (!assetTagCache.has(id)) {
        assetTagCache.set(id, null);
      }
    });
  }
}

/**
 * 同步标签树到 MuseDAM
 */
export async function syncTagsToMuseDAM({
  team,
  tagsTree,
}: {
  team: {
    id: number;
    slug: string;
  };
  tagsTree: TagNode[];
}): Promise<void> {
  // 过滤出有操作的标签
  const hasOperations = (node: TagNode): boolean => {
    return !!node.verb || node.children.some(hasOperations);
  };

  const operationNodes = tagsTree.filter(hasOperations);

  if (operationNodes.length === 0) {
    return; // 没有需要同步的操作
  }

  // 清空缓存
  assetTagCache.clear();

  // 预加载所有相关的 AssetTag 数据
  await preloadAssetTags(operationNodes, team.id);

  // 转换为 MuseDAM 格式
  const musedamTags = operationNodes
    .map(convertToMuseDAMFormat)
    .filter(Boolean) as MuseDAMTagRequest[];

  // 如果没有需要同步的标签，直接返回
  if (musedamTags.length === 0) {
    return;
  }

  // 获取团队凭证
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });

  // 调用 MuseDAM API
  await requestMuseDAMAPI("/api/muse/merge-tags", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: {
      tags: musedamTags,
    },
  });
}
