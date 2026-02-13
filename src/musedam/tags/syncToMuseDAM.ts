import "server-only";

import { TagNode } from "@/app/tags/types";
import { idToSlug, slugToId } from "@/lib/slug";
import { retrieveTeamCredentials } from "@/musedam/apiKey";
import { AssetTag } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { requestMuseDAMAPI } from "../lib";
import { MuseDAMID } from "../types";

interface MuseDAMTagRequest {
  id?: number;
  name: string;
  operation: 0 | 1 | 2 | 3; // 0不操作 1更新 2创建 3删除
  sort?: number;
  children?: MuseDAMTagRequest[];
}

interface MuseDAMTagResponse {
  id?: number;
  name: string;
  operation: 0 | 1 | 2 | 3;
  sort?: number;
  children?: MuseDAMTagResponse[];
}

/**
 * 将我们的 TagNode 转换为 MuseDAM API 格式
 */
function convertToMuseDAMFormat(
  node: TagNode,
  createdTagMapping: Map<string, MuseDAMID>,
): MuseDAMTagRequest | null {
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
      // 如果是创建操作且有 tempId，记录到映射中
      if (node.tempId) {
        // 这里暂时不设置 musedamId，等 API 返回后再设置
      }
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
    result.id = Number(musedamId.toString());
  }

  // 如果有 sort 字段，添加到请求中
  if (node.sort !== undefined) {
    result.sort = node.sort;
  }

  // 处理子标签
  if (node.children.length > 0) {
    const childrenRequests = node.children
      .map((child) => convertToMuseDAMFormat(child, createdTagMapping))
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
}): Promise<{
  tags: MuseDAMTagRequest[];
  createdTagMapping: Map<string, MuseDAMID>; // tempId -> MuseDAMID 的映射
}> {
  // 过滤出有操作的标签
  const hasOperations = (node: TagNode): boolean => {
    return !!node.verb || node.children.some(hasOperations);
  };

  const operationNodes = tagsTree.filter(hasOperations);

  if (operationNodes.length === 0) {
    return { tags: [], createdTagMapping: new Map() }; // 没有需要同步的操作
  }

  // 清空缓存
  assetTagCache.clear();

  // 预加载所有相关的 AssetTag 数据
  await preloadAssetTags(operationNodes, team.id);

  // 创建映射表
  const createdTagMapping = new Map<string, MuseDAMID>();

  // 转换为 MuseDAM 格式
  const musedamTags = operationNodes
    .map((node) => convertToMuseDAMFormat(node, createdTagMapping))
    .filter(Boolean) as MuseDAMTagRequest[];

  // 如果没有需要同步的标签，直接返回
  if (musedamTags.length === 0) {
    return { tags: [], createdTagMapping };
  }

  // 获取团队凭证
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });

  // 调用 MuseDAM API
  const res = await requestMuseDAMAPI<{ tags: MuseDAMTagResponse[] }>("/api/muse/merge-tags", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: {
      tags: musedamTags,
    },
  });

  // 更新 AssetTag 的 sort 字段
  const updateAssetTagSort = async (nodeId: number, sort: number) => {
    try {
      await prisma.assetTag.update({
        where: { id: nodeId },
        data: { sort },
      });
    } catch (error) {
      console.error(`Failed to update sort for AssetTag ${nodeId}:`, error);
    }
  };

  // 构建新创建标签的映射关系并更新 sort 字段
  const buildMapping = async (
    requestTags: MuseDAMTagRequest[],
    responseTags: MuseDAMTagResponse[],
    nodePath: TagNode[] = operationNodes,
  ) => {
    for (let i = 0; i < requestTags.length && i < responseTags.length; i++) {
      const requestTag = requestTags[i];
      const responseTag = responseTags[i];

      // 如果请求中没有 ID 但响应中有 ID，说明是新创建的标签
      if (!requestTag.id && responseTag.id) {
        // 在当前路径中查找匹配的节点
        const matchingNode = nodePath.find(
          (node) => node.verb === "create" && node.tempId && node.name === requestTag.name,
        );

        if (matchingNode && matchingNode.tempId) {
          createdTagMapping.set(matchingNode.tempId, MuseDAMID.from(responseTag.id));
        }
      }

      // 如果是创建或更新操作，且有 sort 字段返回，更新数据库中的 sort 字段
      if (
        (requestTag.operation === 1 || requestTag.operation === 2) &&
        responseTag.sort !== undefined
      ) {
        // 查找对应的节点
        const matchingNode = nodePath.find((node) => node.name === requestTag.name && node.id);

        if (matchingNode && matchingNode.id) {
          await updateAssetTagSort(matchingNode.id, responseTag.sort);
        }
      }

      // 递归处理子标签
      if (requestTag.children && responseTag.children) {
        // 找到对应的子节点路径
        const childNodePath =
          nodePath.find((node) => node.name === requestTag.name)?.children || [];

        await buildMapping(requestTag.children, responseTag.children, childNodePath);
      }
    }
  };

  await buildMapping(musedamTags, res.tags);

  return { tags: res.tags, createdTagMapping };
}

type MuseDAMTagTree = {
  id: MuseDAMID;
  name: string;
  sort: number;
  children: MuseDAMTagTree | null;
}[];

/**
 * 将数据库中的 AssetTag 转换为 TagNode
 */
function convertAssetTagToTagNode(tag: AssetTag & { children?: AssetTag[] }): TagNode {
  return {
    id: tag.id,
    slug: tag.slug,
    name: tag.name,
    sort: tag.sort,
    children: tag.children
      ? tag.children
          .sort((a, b) => {
            if (a.sort !== b.sort) {
              return b.sort - a.sort;
            }
            return a.id - b.id;
          })
          .map(convertAssetTagToTagNode)
      : [],
  };
}

/**
 * 以当前系统为基准同步标签到 MuseDAM
 * 1. 获取当前系统的标签树
 * 2. 获取 MuseDAM 的标签树
 * 3. 对比并标记需要删除（MuseDAM 中存在但当前系统不存在的一级标签）和创建（当前系统没有 slug 的一级标签）的标签
 * 4. 同步到 MuseDAM
 * 5. 再次拉取 MuseDAM 标签树，更新当前系统的 slug 和 sort
 */
export async function syncTagsToMuseDAMWithCurrentSystemAsBase({
  team,
}: {
  team: {
    id: number;
    slug: string;
  };
}): Promise<void> {
  // 1. 获取当前系统中的标签树（一级标签）
  const currentTags = await prisma.assetTag.findMany({
    where: {
      teamId: team.id,
      parentId: null,
    },
    orderBy: [{ sort: "desc" }, { id: "asc" }],
    include: {
      children: {
        orderBy: [{ sort: "desc" }, { id: "asc" }],
        include: {
          children: {
            orderBy: [{ sort: "desc" }, { id: "asc" }],
          },
        },
      },
    },
  });

  const currentTagsTree: TagNode[] = currentTags.map(convertAssetTagToTagNode);

  // 2. 获取 MuseDAM 中的标签树
  const { apiKey: musedamTeamApiKey } = await retrieveTeamCredentials({ team });
  const musedamTeamId = slugToId("team", team.slug);

  const musedamTagsResult = await requestMuseDAMAPI<MuseDAMTagTree>("/api/muse/query-tag-tree", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${musedamTeamApiKey}`,
    },
    body: {
      orgId: musedamTeamId,
    },
  });

  // 3. 构建当前系统中一级标签的 slug 映射（slug -> TagNode）
  const currentSlugMap = new Map<string, TagNode>();
  currentTagsTree.forEach((tag) => {
    if (tag.slug) {
      currentSlugMap.set(tag.slug, tag);
    }
  });

  // 4. 标记需要创建的标签（当前系统没有 slug 的一级标签）
  currentTagsTree.forEach((tag) => {
    if (!tag.slug) {
      // 当前系统没有 slug，标记为创建
      tag.verb = "create";
    }
  });

  // 7. 为需要删除的标签构建 MuseDAM 格式的请求
  const deleteTags: MuseDAMTagRequest[] = [];
  musedamTagsResult.forEach((musedamTag) => {
    const slug = idToSlug("assetTag", musedamTag.id);
    if (!currentSlugMap.has(slug)) {
      deleteTags.push({
        id: Number(musedamTag.id.toString()),
        name: musedamTag.name,
        operation: 3, // 删除
        sort: musedamTag.sort,
      });
    }
  });

  // 8. 为需要创建的标签构建 TagNode（需要包含子标签）
  const createTags: TagNode[] = [];
  currentTagsTree.forEach((tag) => {
    if (!tag.slug && tag.verb === "create") {
      createTags.push(tag);
    }
  });

  // 9. 如果有需要同步的操作，调用同步 API
  if (deleteTags.length > 0 || createTags.length > 0) {
    // 清空缓存
    assetTagCache.clear();

    // 预加载所有相关的 AssetTag 数据
    await preloadAssetTags(currentTagsTree, team.id);

    // 构建同步请求
    const syncTags: MuseDAMTagRequest[] = [];

    // 添加删除操作
    syncTags.push(...deleteTags);

    // 添加创建操作
    const createdTagMapping = new Map<string, MuseDAMID>();
    createTags.forEach((tag) => {
      const musedamTag = convertToMuseDAMFormat(tag, createdTagMapping);
      if (musedamTag) {
        syncTags.push(musedamTag);
      }
    });

    if (syncTags.length > 0) {
      // 调用 MuseDAM API
      await requestMuseDAMAPI<{ tags: MuseDAMTagResponse[] }>("/api/muse/merge-tags", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${musedamTeamApiKey}`,
        },
        body: {
          tags: syncTags,
        },
      });
    }
  }

  // 10. 再次拉取 MuseDAM 标签树，更新当前系统的 slug 和 sort
  const updatedMusedamTagsResult = await requestMuseDAMAPI<MuseDAMTagTree>(
    "/api/muse/query-tag-tree",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${musedamTeamApiKey}`,
      },
      body: {
        orgId: musedamTeamId,
      },
    },
  );

  // 11. 更新当前系统的 slug 和 sort
  const updateTagSlugAndSort = async (
    musedamTags: MuseDAMTagTree,
    parentId: number | null = null,
  ) => {
    for (const musedamTag of musedamTags) {
      const slug = idToSlug("assetTag", musedamTag.id);

      // 查找当前系统中对应的标签（通过 name 和 parentId 匹配）
      const where = parentId
        ? { teamId: team.id, parentId, name: musedamTag.name }
        : { teamId: team.id, name: musedamTag.name, parentId: null };

      const existingTag = await prisma.assetTag.findFirst({ where });

      if (existingTag) {
        // 更新 slug 和 sort
        await prisma.assetTag.update({
          where: { id: existingTag.id },
          data: {
            slug,
            sort: musedamTag.sort,
          },
        });

        // 递归处理子标签
        if (
          musedamTag.children &&
          Array.isArray(musedamTag.children) &&
          musedamTag.children.length > 0
        ) {
          await updateTagSlugAndSort(musedamTag.children, existingTag.id);
        }
      }
    }
  };

  await updateTagSlugAndSort(updatedMusedamTagsResult);
}
