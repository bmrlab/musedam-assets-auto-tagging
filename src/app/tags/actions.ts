"use server";

import { llm } from "@/ai/provider";
import { withAuth } from "@/app/(auth)/withAuth";
import { Locale, getLanguageConfig } from "@/i18n/routing";
import { rootLogger } from "@/lib/logging";
import { ServerActionResult } from "@/lib/serverAction";
import { idToSlug } from "@/lib/slug";
import { syncTagsFromMuseDAM } from "@/musedam/tags/syncFromMuseDAM";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";
import { MuseDAMID } from "@/musedam/types";
import type { AssetTagExtra } from "@/prisma/client";
import { AssetTag } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import type { Prisma } from "@prisma/client";
import { generateObject } from "ai";
import { z } from "zod";
import { TagNode } from "./types";

// 定义 MuseDAM 标签请求的类型（与 syncToMuseDAM 返回的类型匹配）
type MuseDAMTagRequest = {
  id?: number;
  name: string;
  operation: 0 | 1 | 2 | 3;
  sort?: number;
  children?: MuseDAMTagRequest[];
};

// 定义 MuseDAM 标签响应的类型（API 返回的数据，包含 sort）
type MuseDAMTagResponse = {
  id?: number;
  name: string;
  operation: 0 | 1 | 2 | 3;
  sort?: number;
  children?: MuseDAMTagResponse[];
};

// 定义同步结果的类型
type SyncResult = {
  tags: MuseDAMTagResponse[]; // 使用响应类型，确保包含 API 返回的 sort
  createdTagMapping: Map<string, MuseDAMID>;
};

// 根据 MuseDAM 返回的标签树构建 musedamId -> sort 的映射
function buildMuseDAMSortMap(tags: MuseDAMTagResponse[]): Map<number, number> {
  const map = new Map<number, number>();
  const walk = (nodes: MuseDAMTagResponse[]) => {
    for (const node of nodes) {
      if (typeof node.id === "number" && typeof node.sort === "number") {
        map.set(node.id, node.sort);
      }
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(tags);
  return map;
}

// 通过 tempId 路径在 syncResult.tags 中回溯 sort（当 createdTagMapping 命中失败时）
function getSortByTempIdPath(tags: MuseDAMTagResponse[], tempId: string): number | undefined {
  // 期望形如 batch_<ts>_0_1_2
  const parts = tempId.split("_");
  if (parts.length < 3) return undefined;
  // 去掉前两段 ["batch", "<ts>"]，剩下的都是层级索引
  const indexParts = parts.slice(2);
  let currentLevel: MuseDAMTagResponse[] | undefined = tags;
  let currentNode: MuseDAMTagResponse | undefined;
  for (const idxStr of indexParts) {
    if (!currentLevel || currentLevel.length === 0) return undefined;
    const idx = Number(idxStr);
    if (Number.isNaN(idx) || idx < 0 || idx >= currentLevel.length) return undefined;
    currentNode = currentLevel[idx];
    currentLevel = currentNode?.children ?? undefined;
  }
  return typeof currentNode?.sort === "number" ? currentNode?.sort : undefined;
}

export async function getTeamHasTags(): Promise<
  ServerActionResult<{
    hasTags: boolean;
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const tags = await prisma.assetTag.findMany({
      where: {
        teamId,
        parentId: {
          equals: null,
        },
      },
      take: 1,
    });

    return {
      success: true,
      data: { hasTags: tags.length > 0 },
    };
  });
}

export async function fetchTeamTags(): Promise<
  ServerActionResult<{
    tags: (AssetTag & {
      parent?: AssetTag | null;
      children?: (AssetTag & {
        children?: AssetTag[];
      })[];
    })[];
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const tags = await prisma.assetTag.findMany({
      where: {
        teamId,
        parentId: {
          equals: null,
        },
      },
      orderBy: [{ level: "asc" }, { sort: "desc" }, { name: "asc" }],
      include: {
        parent: true,
        children: {
          orderBy: [{ sort: "desc" }, { name: "asc" }],
          include: {
            children: {
              orderBy: [{ sort: "desc" }, { name: "asc" }],
            },
          },
        },
      },
    });

    return {
      success: true,
      data: { tags },
    };
  });
}

export async function syncTagsFromMuseDAMAction(): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 获取团队信息
      const team = await prisma.team.findUniqueOrThrow({
        where: { id: teamId },
      });

      await syncTagsFromMuseDAM({ team: { id: teamId, slug: team.slug } });

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      console.error("Sync from MuseDAM error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "从 MuseDAM 同步标签时发生未知错误",
      };
    }
  });
}

export async function saveTagsTreeToMuseDAM(
  tagsTree: TagNode[],
): Promise<ServerActionResult<SyncResult>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 获取团队信息
      const team = await prisma.team.findUniqueOrThrow({
        where: { id: teamId },
      });

      const syncResult = await syncTagsToMuseDAM({
        team: { id: teamId, slug: team.slug },
        tagsTree,
      });

      return {
        success: true,
        data: syncResult,
      };
    } catch (error) {
      console.error("Sync to MuseDAM error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "同步到 MuseDAM 时发生未知错误",
      };
    }
  });
}
export async function saveTagsTree(tagsTree: TagNode[]): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 在数据库操作前先同步到 MuseDAM（此时数据库中的数据还是完整的）
      let syncResult: SyncResult | null = null;
      try {
        const syncResponse = await saveTagsTreeToMuseDAM(tagsTree);
        if (syncResponse.success) {
          syncResult = syncResponse.data;
        } else {
          console.error("Sync to MuseDAM failed:", syncResponse.message);
        }
      } catch (error) {
        console.error("Sync to MuseDAM error:", error);
        // MuseDAM 同步失败不影响本地保存结果
      }

      // 构建 musedamId -> sort 的映射
      const musedamSortMap = syncResult ? buildMuseDAMSortMap(syncResult.tags) : null;

      await prisma.$transaction(async (tx) => {
        // 递归处理标签节点
        const processNodes = async (
          nodes: TagNode[],
          parentId: number | null = null,
          level: number = 1,
        ) => {
          for (const node of nodes) {
            if (node.verb === "delete" && node.id) {
              // 删除标签（级联删除子标签）
              await tx.assetTag.delete({
                where: {
                  id: node.id,
                  teamId,
                },
              });
            } else if (node.verb === "create") {
              // 创建新标签
              if (!node.name.trim()) {
                throw new Error("标签名不能为空");
              }

              // 检查同级标签名是否重复
              const existingTag = await tx.assetTag.findFirst({
                where: {
                  teamId,
                  parentId,
                  name: node.name.trim(),
                },
              });

              let targetTagId: number;

              if (existingTag) {
                // 标签已存在，使用现有标签的ID
                targetTagId = existingTag.id;
              } else {
                // 标签不存在，创建新标签
                // 计算 slug 和 sort
                let slug: string | null = null;
                let sortValue: number | undefined = undefined;

                if (node.tempId && syncResult && syncResult.createdTagMapping) {
                  const musedamId = syncResult.createdTagMapping.get(node.tempId);
                  if (musedamId) {
                    slug = idToSlug("assetTag", musedamId);

                    // 尝试从 musedamSortMap 获取 sort
                    if (musedamSortMap) {
                      const idNum = Number(musedamId as unknown as number);
                      if (!Number.isNaN(idNum)) {
                        const s = musedamSortMap.get(idNum);
                        if (typeof s === "number") sortValue = s;
                      }
                    }
                  }

                  // 如果通过 musedamId 获取 sort 失败，尝试通过 tempId 路径获取
                  if (sortValue === undefined && syncResult.tags && syncResult.tags.length > 0) {
                    sortValue = getSortByTempIdPath(syncResult.tags, node.tempId);
                  }
                }

                const createdTag = await tx.assetTag.create({
                  data: {
                    teamId,
                    name: node.name.trim(),
                    level,
                    slug,
                    parentId,
                    ...(sortValue !== undefined ? { sort: sortValue } : {}),
                  },
                });
                targetTagId = createdTag.id;
              }

              // 递归处理子标签
              if (node.children.length > 0) {
                await processNodes(node.children, targetTagId, level + 1);
              }
            } else if (node.verb === "update" && node.id) {
              // 更新标签
              if (!node.name.trim()) {
                throw new Error("标签名不能为空");
              }

              // 检查同级标签名是否重复（排除自己）
              const existingTag = await tx.assetTag.findFirst({
                where: {
                  teamId,
                  parentId,
                  name: node.name.trim(),
                  id: {
                    not: node.id,
                  },
                },
              });

              if (existingTag) {
                throw new Error(`标签名 "${node.name}" 在同级中已存在`);
              }

              await tx.assetTag.update({
                where: {
                  id: node.id,
                  teamId,
                },
                data: {
                  name: node.name.trim(),
                },
              });

              // 递归处理子标签
              if (node.children.length > 0) {
                await processNodes(node.children, node.id, level + 1);
              }
            } else if (!node.verb && node.id) {
              // 无变更，但需要处理子标签
              if (node.children.length > 0) {
                await processNodes(node.children, node.id, level + 1);
              }
            }
          }
        };

        await processNodes(tagsTree);
      });

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      console.error("Save tags tree error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "保存标签树时发生未知错误",
      };
    }
  });
}

// 批量创建标签的数据结构
export interface BatchCreateTagData {
  name: string;
  sort?: number;
  nameChildList?: BatchCreateTagData[];
}

export async function checkExistingTags(): Promise<
  ServerActionResult<{ hasExistingTags: boolean; count: number }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const count = await prisma.assetTag.count({
        where: { teamId },
      });

      return {
        success: true,
        data: {
          hasExistingTags: count > 0,
          count,
        },
      };
    } catch (error) {
      console.error("Check existing tags error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "检查现有标签时发生未知错误",
      };
    }
  });
}

export async function batchCreateTags(
  nameChildList: BatchCreateTagData[],
  addType: 1 | 2, // 1: 仅保留新建标签树, 2: 合并到现有标签系统
): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      const baseTs = Date.now();
      // 转换为 TagNode 格式用于同步
      const convertToTagNodes = (
        data: BatchCreateTagData[],
        parentPath: string = "",
      ): TagNode[] => {
        return data.map((item, index) => {
          const currentPath = parentPath ? `${parentPath}_${index}` : `batch_${baseTs}_${index}`;
          return {
            id: undefined,
            slug: null,
            name: item.name,
            originalName: item.name,
            children: item.nameChildList ? convertToTagNodes(item.nameChildList, currentPath) : [],
            verb: "create" as const,
            tempId: currentPath,
          };
        });
      };

      const tagsTree = convertToTagNodes(nameChildList);

      let syncResult: SyncResult | null = null;

      // 先同步到 MuseDAM（在事务外执行，避免长时间事务）
      try {
        let finalTagsTree = tagsTree;

        // 如果是替换模式（addType === 1），需要先获取现有的一级标签并标记为删除
        if (addType === 1) {
          const existingRootTags = await prisma.assetTag.findMany({
            where: {
              teamId,
              parentId: null,
            },
            orderBy: [{ sort: "desc" }, { name: "asc" }],
          });

          // 将现有标签转换为 TagNode 格式并标记为删除
          const deleteTagNodes: TagNode[] = existingRootTags.map((tag) => ({
            id: tag.id,
            slug: tag.slug,
            name: tag.name,
            originalName: tag.name,
            children: [],
            verb: "delete" as const,
          }));

          // 合并删除标签和新建标签
          finalTagsTree = [...deleteTagNodes, ...tagsTree];
        }

        const syncResponse = await saveTagsTreeToMuseDAM(finalTagsTree);
        if (syncResponse.success) {
          syncResult = syncResponse.data;
        } else {
          console.error("Sync to MuseDAM failed:", syncResponse.message);
        }
      } catch (error) {
        console.error("Sync to MuseDAM error:", error);
        // MuseDAM 同步失败不影响本地保存结果
      }
      // console.log("syncResult------", syncResult);
      if (addType === 1) {
        // 仅保留新建标签树：删除所有现有标签，然后批量创建新标签
        await prisma.$transaction(
          async (tx) => {
            // 1. 删除所有现有标签（级联删除子标签）
            await tx.assetTag.deleteMany({
              where: { teamId },
            });

            // 2. 批量创建新标签
            await createTagsBatch(tx, nameChildList, teamId, syncResult, null, 1, "", baseTs);
          },
          {
            timeout: 60000, // 60秒超时
            isolationLevel: "ReadCommitted",
          },
        );
      } else {
        // 合并到现有标签系统：获取现有标签，然后批量创建
        await prisma.$transaction(
          async (tx) => {
            // 获取所有现有标签用于去重检查
            const existingTags = await tx.assetTag.findMany({
              where: { teamId },
              select: { id: true, name: true, parentId: true, level: true },
            });

            // 创建标签映射用于快速查找
            const existingTagMap = new Map<string, number>();
            existingTags.forEach((tag) => {
              const key = `${tag.parentId || "root"}_${tag.name}_${tag.level}`;
              existingTagMap.set(key, tag.id);
            });

            // 批量创建新标签
            await createTagsBatchWithExistingCheck(
              tx,
              nameChildList,
              teamId,
              existingTagMap,
              syncResult,
              null,
              1,
              "",
              baseTs,
            );
          },
          {
            timeout: 60000, // 60秒超时
            isolationLevel: "ReadCommitted",
          },
        );
      }

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      console.error("Batch create tags error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "批量创建标签时发生未知错误",
      };
    }
  });
}

// 批量创建标签的辅助函数（用于 addType === 1）
async function createTagsBatch(
  tx: Prisma.TransactionClient,
  nameChildList: BatchCreateTagData[],
  teamId: number,
  syncResult: SyncResult | null,
  parentId: number | null = null,
  level: number = 1,
  tempIdPrefix: string = "",
  baseTs?: number,
): Promise<Map<string, number>> {
  const tagIdMap = new Map<string, number>();
  const musedamSortMap = syncResult ? buildMuseDAMSortMap(syncResult.tags) : null;

  // 准备批量创建的数据
  const createData = nameChildList.map((item, index) => {
    const currentTempId = tempIdPrefix
      ? `${tempIdPrefix}_${index}`
      : `batch_${baseTs ?? Date.now()}_${index}`;

    let sortValue: number | undefined = undefined;
    if (syncResult && syncResult.createdTagMapping && musedamSortMap) {
      const musedamId = syncResult.createdTagMapping.get(currentTempId);
      const idNum = Number(musedamId as unknown as number);
      if (!Number.isNaN(idNum)) {
        const s = musedamSortMap.get(idNum);
        if (typeof s === "number") sortValue = s;
      }
      if (sortValue === undefined && syncResult.tags && syncResult.tags.length > 0) {
        sortValue = getSortByTempIdPath(syncResult.tags, currentTempId);
      }
    }

    return {
      data: {
        teamId,
        name: item.name.trim(),
        level,
        parentId,
        ...(sortValue !== undefined ? { sort: sortValue } : {}),
      },
      tempId: currentTempId,
      nameChildList: item.nameChildList || [],
    };
  });

  // 批量创建标签
  const createdTags = await Promise.all(
    createData.map(async ({ data, tempId, nameChildList }) => {
      const createdTag = await tx.assetTag.create({ data });
      tagIdMap.set(tempId, createdTag.id);
      return { createdTag, tempId, nameChildList };
    }),
  );

  // 批量更新 slug（如果有同步结果）
  if (syncResult && syncResult.createdTagMapping) {
    const updatePromises = createdTags
      .filter(({ tempId }) => syncResult.createdTagMapping.has(tempId))
      .map(async ({ createdTag, tempId }) => {
        const musedamId = syncResult.createdTagMapping.get(tempId);
        if (musedamId) {
          const slug = idToSlug("assetTag", musedamId);
          return tx.assetTag.update({
            where: { id: createdTag.id },
            data: { slug },
          });
        }
      });

    await Promise.all(updatePromises.filter(Boolean));
  }

  // 递归处理子标签
  for (const { createdTag, tempId, nameChildList } of createdTags) {
    if (nameChildList.length > 0) {
      const childMap = await createTagsBatch(
        tx,
        nameChildList,
        teamId,
        syncResult,
        createdTag.id,
        level + 1,
        tempId,
        baseTs,
      );
      // 合并子标签映射
      childMap.forEach((id, key) => tagIdMap.set(key, id));
    }
  }

  return tagIdMap;
}

// 批量创建标签的辅助函数（用于 addType === 2，带重复检查）
type CreateTagData = {
  teamId: number;
  name: string;
  level: number;
  parentId: number | null;
  sort?: number;
};

async function createTagsBatchWithExistingCheck(
  tx: Prisma.TransactionClient,
  nameChildList: BatchCreateTagData[],
  teamId: number,
  existingTagMap: Map<string, number>,
  syncResult: SyncResult | null,
  parentId: number | null = null,
  level: number = 1,
  tempIdPrefix: string = "",
  baseTs?: number,
): Promise<Map<string, number>> {
  const tagIdMap = new Map<string, number>();
  const musedamSortMap = syncResult ? buildMuseDAMSortMap(syncResult.tags) : null;
  const createData: Array<{
    data: CreateTagData;
    tempId: string;
    nameChildList: BatchCreateTagData[];
    isNew: boolean;
  }> = [];

  // 准备创建数据并检查重复
  for (let i = 0; i < nameChildList.length; i++) {
    const item = nameChildList[i];
    const currentTempId = tempIdPrefix
      ? `${tempIdPrefix}_${i}`
      : `batch_${baseTs ?? Date.now()}_${i}`;

    const key = `${parentId || "root"}_${item.name.trim()}_${level}`;
    const existingId = existingTagMap.get(key);

    if (existingId) {
      // 标签已存在，使用现有ID
      tagIdMap.set(currentTempId, existingId);
    } else {
      // 需要创建新标签
      let sortValue: number | undefined = undefined;
      if (syncResult && syncResult.createdTagMapping && musedamSortMap) {
        const musedamId = syncResult.createdTagMapping.get(currentTempId);
        const idNum = Number(musedamId as unknown as number);
        if (!Number.isNaN(idNum)) {
          const s = musedamSortMap.get(idNum);
          if (typeof s === "number") sortValue = s;
        }
        if (sortValue === undefined && syncResult.tags && syncResult.tags.length > 0) {
          sortValue = getSortByTempIdPath(syncResult.tags, currentTempId);
        }
      }
      createData.push({
        data: {
          teamId,
          name: item.name.trim(),
          level,
          parentId,
          ...(sortValue !== undefined ? { sort: sortValue } : {}),
        },
        tempId: currentTempId,
        nameChildList: item.nameChildList || [],
        isNew: true,
      });
    }
  }

  // 批量创建新标签
  if (createData.length > 0) {
    const createdTags = await Promise.all(
      createData.map(async ({ data, tempId, nameChildList, isNew }) => {
        if (isNew) {
          const createdTag = await tx.assetTag.create({ data });
          tagIdMap.set(tempId, createdTag.id);
          return { createdTag, tempId, nameChildList };
        }
        return null;
      }),
    );

    // 批量更新 slug
    if (syncResult && syncResult.createdTagMapping) {
      const updatePromises = createdTags
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .filter(({ tempId }) => syncResult.createdTagMapping.has(tempId))
        .map(async ({ createdTag, tempId }) => {
          const musedamId = syncResult.createdTagMapping.get(tempId);
          if (musedamId) {
            const slug = idToSlug("assetTag", musedamId);
            return tx.assetTag.update({
              where: { id: createdTag.id },
              data: { slug },
            });
          }
        });

      await Promise.all(updatePromises.filter(Boolean));
    }

    // 递归处理子标签
    for (const item of createdTags.filter(Boolean)) {
      if (item && item.nameChildList.length > 0) {
        const childMap = await createTagsBatchWithExistingCheck(
          tx,
          item.nameChildList,
          teamId,
          existingTagMap,
          syncResult,
          item.createdTag.id,
          level + 1,
          item.tempId,
          baseTs,
        );
        childMap.forEach((id, key) => tagIdMap.set(key, id));
      }
    }
  }

  return tagIdMap;
}

// 保存单个标签的变更（支持 create、update、delete）
export async function saveSingleTagChange(
  node: TagNode,
  parentId: number | null = null,
  level: number = 1,
): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 在数据库操作前先同步到 MuseDAM（此时数据库中的数据还是完整的）
      let syncResult: SyncResult | null = null;
      try {
        // 获取团队信息
        const team = await prisma.team.findUniqueOrThrow({
          where: { id: teamId },
        });

        // 构建单个节点的标签树用于同步
        const singleNodeTree: TagNode[] = [node];
        const syncResponse = await saveTagsTreeToMuseDAM(singleNodeTree);

        if (syncResponse.success) {
          syncResult = syncResponse.data;
        } else {
          console.error("Sync to MuseDAM failed:", syncResponse.message);
        }
      } catch (error) {
        console.error("Sync to MuseDAM error:", error);
        // MuseDAM 同步失败不影响本地保存结果
      }

      // 构建 musedamId -> sort 的映射
      const musedamSortMap = syncResult ? buildMuseDAMSortMap(syncResult.tags) : null;

      await prisma.$transaction(async (tx) => {
        if (node.verb === "delete" && node.id) {
          // 删除标签（级联删除子标签）
          await tx.assetTag.delete({
            where: {
              id: node.id,
              teamId,
            },
          });
        } else if (node.verb === "create") {
          // 创建新标签
          if (!node.name.trim()) {
            throw new Error("标签名不能为空");
          }

          // 检查同级标签名是否重复
          const existingTag = await tx.assetTag.findFirst({
            where: {
              teamId,
              parentId,
              name: node.name.trim(),
            },
          });

          let targetTagId: number;

          if (existingTag) {
            // 标签已存在，使用现有标签的ID
            targetTagId = existingTag.id;
          } else {
            // 标签不存在，创建新标签
            // 计算 slug 和 sort
            let slug: string | null = null;
            let sortValue: number | undefined = undefined;

            if (node.tempId && syncResult && syncResult.createdTagMapping) {
              const musedamId = syncResult.createdTagMapping.get(node.tempId);
              if (musedamId) {
                slug = idToSlug("assetTag", musedamId);

                // 尝试从 musedamSortMap 获取 sort
                if (musedamSortMap) {
                  const idNum = Number(musedamId as unknown as number);
                  if (!Number.isNaN(idNum)) {
                    const s = musedamSortMap.get(idNum);
                    if (typeof s === "number") sortValue = s;
                  }
                }
              }

              // 如果通过 musedamId 获取 sort 失败，尝试通过 tempId 路径获取
              if (sortValue === undefined && syncResult.tags && syncResult.tags.length > 0) {
                sortValue = getSortByTempIdPath(syncResult.tags, node.tempId);
              }
            }

            const createdTag = await tx.assetTag.create({
              data: {
                teamId,
                name: node.name.trim(),
                level,
                slug,
                parentId,
                ...(sortValue !== undefined ? { sort: sortValue } : {}),
              },
            });
            targetTagId = createdTag.id;
          }

          // 递归处理子标签
          if (node.children.length > 0) {
            for (const child of node.children) {
              await saveSingleTagChange(child, targetTagId, level + 1);
            }
          }
        } else if (node.verb === "update" && node.id) {
          // 更新标签
          if (!node.name.trim()) {
            throw new Error("标签名不能为空");
          }

          // 检查同级标签名是否重复（排除自己）
          const existingTag = await tx.assetTag.findFirst({
            where: {
              teamId,
              parentId,
              name: node.name.trim(),
              id: {
                not: node.id,
              },
            },
          });

          if (existingTag) {
            throw new Error(`标签名 "${node.name}" 在同级中已存在`);
          }

          await tx.assetTag.update({
            where: {
              id: node.id,
              teamId,
            },
            data: {
              name: node.name.trim(),
            },
          });

          // 递归处理子标签
          if (node.children.length > 0) {
            for (const child of node.children) {
              await saveSingleTagChange(child, node.id, level + 1);
            }
          }
        } else if (!node.verb && node.id) {
          // 无变更，但需要处理子标签
          if (node.children.length > 0) {
            for (const child of node.children) {
              await saveSingleTagChange(child, node.id, level + 1);
            }
          }
        }
      });

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      console.error("Save single tag change error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "保存标签修改时发生未知错误",
      };
    }
  });
}

// 更新标签排序
export async function updateTagSort(
  tagSortData: { id: number; sort: number }[],
): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      await prisma.$transaction(async (tx) => {
        // 批量更新标签排序
        for (const { id, sort } of tagSortData) {
          await tx.assetTag.update({
            where: {
              id,
              teamId,
            },
            data: {
              sort,
            },
          });
        }
      });

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      console.error("Update tag sort error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "更新标签排序时发生未知错误",
      };
    }
  });
}

export async function updateTagExtra(
  tagId: number,
  data: {
    name?: string;
    description?: string;
    keywords?: string[];
    negativeKeywords?: string[];
    taggingEnabled?: boolean;
  },
): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 获取现有标签
      const existingTag = await prisma.assetTag.findFirst({
        where: {
          id: tagId,
          teamId,
        },
      });

      if (!existingTag) {
        return {
          success: false,
          message: "标签不存在",
        };
      }

      // 准备更新数据
      const updateData: { name?: string; extra?: AssetTagExtra; taggingEnabled?: boolean } = {};

      // 处理名称更新
      if (data.name && data.name.trim() !== existingTag.name) {
        // 检查同级标签名是否重复
        const duplicateTag = await prisma.assetTag.findFirst({
          where: {
            teamId,
            parentId: existingTag.parentId,
            name: data.name.trim(),
            id: {
              not: tagId,
            },
          },
        });

        if (duplicateTag) {
          return {
            success: false,
            message: `标签名 "${data.name}" 在同级中已存在`,
          };
        }

        updateData.name = data.name.trim();
      }

      // 处理taggingEnabled更新
      if (data.taggingEnabled !== undefined) {
        updateData.taggingEnabled = data.taggingEnabled;
      }

      // 处理extra字段更新
      const currentExtra = (existingTag.extra as AssetTagExtra) || {};
      const newExtra: AssetTagExtra = { ...currentExtra };

      if (data.description !== undefined) {
        newExtra.description = data.description;
      }
      if (data.keywords !== undefined) {
        newExtra.keywords = data.keywords;
      }
      if (data.negativeKeywords !== undefined) {
        newExtra.negativeKeywords = data.negativeKeywords;
      }

      updateData.extra = newExtra;

      // 更新标签
      await prisma.assetTag.update({
        where: {
          id: tagId,
          teamId,
        },
        data: updateData,
      });

      return {
        success: true,
        data: undefined,
      };
    } catch (error) {
      console.error("Update tag extra error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "更新标签信息时发生未知错误",
      };
    }
  });
}

// 定义标签树的 schema（三层结构）
const tagTreeSchema = z.object({
  tags: z.array(
    z.object({
      name: z.string().describe("一级标签名称"),
      children: z
        .array(
          z.object({
            name: z.string().describe("二级标签名称"),
            children: z
              .array(
                z.object({
                  name: z.string().describe("三级标签名称"),
                }),
              )
              .optional()
              .describe("三级标签列表"),
          }),
        )
        .optional()
        .describe("二级标签列表"),
    }),
  ),
});

// 将结构化数据转换为文本格式
function convertStructuredToText(data: z.infer<typeof tagTreeSchema>): string {
  const lines: string[] = [];

  for (const level1 of data.tags) {
    lines.push(`# ${level1.name}`);

    if (level1.children && level1.children.length > 0) {
      for (const level2 of level1.children) {
        lines.push(`## ${level2.name}`);

        if (level2.children && level2.children.length > 0) {
          for (const level3 of level2.children) {
            lines.push(level3.name);
          }
        }
      }
    }
  }

  return lines.join("\n");
}

// 基于大模型生成标签树文本（严格结构化输出）
export async function generateTagTreeByLLM(
  finalPrompt: string,
  lang: Locale = "zh-CN",
): Promise<ServerActionResult<{ text: string; input: string }>> {
  "use server";

  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      rootLogger.info({
        msg: "generateTagTreeByLLM: 开始生成",
        teamId,
        promptLength: finalPrompt.length,
        lang,
      });

      // 根据语言获取配置
      const config = getLanguageConfig(lang);

      // 构建针对结构化输出优化的 prompt
      const structuredPrompt = `${finalPrompt}

${config.promptIntro}
{
  "tags": [
    {
      "name": "${config.level1Label}",
      "children": [
        {
          "name": "${config.level2Label}",
          "children": [
            { "name": "${config.level3Label1}" },
            { "name": "${config.level3Label2}" }
          ]
        }
      ]
    }
  ]
}

${config.notes}`;

      const result = await generateObject({
        model: llm("gpt-5-mini"),
        schema: tagTreeSchema,
        schemaName: config.schemaName,
        schemaDescription: config.schemaDescription,
        prompt: structuredPrompt,
      });

      // 将结构化数据转换为文本格式
      const textOutput = convertStructuredToText(result.object);

      rootLogger.info({
        msg: "generateTagTreeByLLM: 生成成功",
        structuredData: result.object,
        textOutput,
      });

      return {
        success: true,
        data: { text: textOutput, input: finalPrompt },
      };
    } catch (error) {
      rootLogger.error({
        msg: "generateTagTreeByLLM error",
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : "生成标签树失败",
      };
    }
  });
}
