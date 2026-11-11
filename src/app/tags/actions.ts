"use server";
import { softDeleteTagSubtree } from "@/lib/tagging/soft-delete-tags";
import { deleteTagAndDescendants } from "./delete-tag";

import { withAuth } from "@/app/(auth)/withAuth";
import { executeGenerateTagTreeByLLM } from "@/app/tags/generateTagTreeLLM";
import { Locale } from "@/i18n/routing";
import { ServerActionResult } from "@/lib/serverAction";
import { idToSlug } from "@/lib/slug";
import { applyTagConfigImportChunk } from "@/lib/tagging/import-tag-config";
import type { TagTreeImportStats } from "@/lib/tagging/tag-import-result";
import {
  AssetTagTreeNode,
  buildChildrenInclude,
  findExceedingTagLevel,
  MAX_TAG_LEVEL,
  TAG_LEVEL_EXCEEDED_MESSAGE,
} from "@/lib/tagging/tag-level";
import { importTagTreeSynchronously } from "@/musedam/tags/importTagTree";
import { syncTagsFromMuseDAM } from "@/musedam/tags/syncFromMuseDAM";
import {
  syncTagsToMuseDAM,
  syncTagsToMuseDAMWithCurrentSystemAsBase,
} from "@/musedam/tags/syncToMuseDAM";
import { MuseDAMID } from "@/musedam/types";
import type { AssetTagExtra } from "@/prisma/client";
import { AssetTag } from "@/prisma/client";
import prisma from "@/prisma/prisma";
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

// 合并模式去重 key：同一父节点下按标签名（trim 后）唯一，不含 level
/**
 * 待保存的 TagNode 树里，是否有「新建」节点落在 MAX_TAG_LEVEL 之下（超过最大层级）。
 * 删除的节点不参与；已存在且未新建的节点不报错（避免历史数据阻塞保存）。
 */
function tagNodesExceedMaxLevel(nodes: TagNode[], baseLevel: number = 1): boolean {
  return (
    findExceedingTagLevel(nodes, (node) => node.children, {
      baseLevel,
      isCounted: (node) => node.verb !== "delete",
      isChecked: (node) => node.verb === "create",
    }) !== null
  );
}

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
        deletedAt: null,
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
    tags: (AssetTagTreeNode & { parent?: AssetTag | null })[];
  }>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    const tags = await prisma.assetTag.findMany({
      where: {
        deletedAt: null,
        teamId,
        parentId: {
          equals: null,
        },
      },
      orderBy: [{ level: "asc" }, { sort: "desc" }, { name: "asc" }],
      include: {
        parent: true,
        // 一级节点之下再展开 MAX_TAG_LEVEL - 1 层
        ...buildChildrenInclude(MAX_TAG_LEVEL - 1, {
          orderBy: [{ sort: "desc" }, { name: "asc" }],
        }),
      },
    });

    return {
      success: true,
      data: { tags: tags as (AssetTagTreeNode & { parent?: AssetTag | null })[] },
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
      if (error instanceof Error && error.message === "TAG_CLEANUP_CONTINUE") {
        return { success: false, code: "continue", message: "多余标签较多，正在继续清理" };
      }
      console.error("Sync from MuseDAM error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "从 MuseDAM 同步标签时发生未知错误",
      };
    }
  });
}

export async function syncTagsToMuseDAMWithCurrentSystemAsBaseAction(): Promise<
  ServerActionResult<void>
> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 获取团队信息
      const team = await prisma.team.findUniqueOrThrow({
        where: { id: teamId },
      });

      await syncTagsToMuseDAMWithCurrentSystemAsBase({ team: { id: teamId, slug: team.slug } });
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
      if (tagNodesExceedMaxLevel(tagsTree)) {
        return { success: false, message: TAG_LEVEL_EXCEEDED_MESSAGE };
      }
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
      // 先校验层级，避免超限的树被推到 MuseDAM 或写进本地库
      if (tagNodesExceedMaxLevel(tagsTree)) {
        return { success: false, message: TAG_LEVEL_EXCEEDED_MESSAGE };
      }

      const includesDelete = (nodes: TagNode[]): boolean =>
        nodes.some((node) => node.verb === "delete" || includesDelete(node.children));
      const deleting = includesDelete(tagsTree);
      // 在数据库操作前先同步到 MuseDAM（此时数据库中的数据还是完整的）
      let syncResult: SyncResult | null = null;
      try {
        const syncResponse = await saveTagsTreeToMuseDAM(tagsTree);
        if (syncResponse.success) {
          syncResult = syncResponse.data;
        } else {
          if (deleting) throw new Error(syncResponse.message);
          console.error("Sync to MuseDAM failed:", syncResponse.message);
        }
      } catch (error) {
        if (deleting) throw error;
        console.error("Sync to MuseDAM error:", error);
        // MuseDAM 同步失败不影响本地保存结果
      }

      // 构建 musedamId -> sort 的映射
      const musedamSortMap = syncResult ? buildMuseDAMSortMap(syncResult.tags) : null;

      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${teamId}::int, 5521735::int)::text`;
        // 递归处理标签节点
        const processNodes = async (
          nodes: TagNode[],
          parentId: number | null = null,
          level: number = 1,
        ) => {
          for (const node of nodes) {
            if (node.verb === "delete" && node.id) {
              // 删除标签（级联删除子标签）
              await softDeleteTagSubtree(tx, teamId, node.id);
            } else if (node.verb === "create") {
              // 创建新标签
              if (!node.name.trim()) {
                throw new Error("标签名不能为空");
              }
              if (level > MAX_TAG_LEVEL) {
                throw new Error(TAG_LEVEL_EXCEEDED_MESSAGE);
              }

              // 检查同级标签名是否重复
              const existingTag = await tx.assetTag.findFirst({
                where: { deletedAt: null, teamId, parentId, name: node.name.trim() },
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
                  deletedAt: null,
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
                where: { deletedAt: null, id: node.id, teamId },
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
        where: { deletedAt: null, teamId },
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

// 同一父级下的同名标签（trim 后）合并为一个，子标签递归合并；
// 否则整棵树推给 MuseDAM 时会报「标签名称已存在」
function mergeDuplicateSiblings(data: BatchCreateTagData[]): BatchCreateTagData[] {
  const byName = new Map<string, BatchCreateTagData>();
  for (const item of data) {
    const name = item.name.trim();
    if (!name) continue;
    const existing = byName.get(name);
    if (existing) {
      if (item.nameChildList?.length) {
        existing.nameChildList = [...(existing.nameChildList ?? []), ...item.nameChildList];
      }
    } else {
      byName.set(name, { ...item, name, nameChildList: item.nameChildList ?? undefined });
    }
  }
  return Array.from(byName.values()).map((item) => ({
    ...item,
    nameChildList: item.nameChildList?.length
      ? mergeDuplicateSiblings(item.nameChildList)
      : item.nameChildList,
  }));
}

export async function batchCreateTags(
  rawNameChildList: BatchCreateTagData[],
  addType: 1 | 2, // 1: 仅保留新建标签树, 2: 合并到现有标签系统
  options?: { imported?: boolean },
): Promise<ServerActionResult<TagTreeImportStats>> {
  return withAuth(async ({ team: { id: teamId, slug: teamSlug } }) => {
    try {
      const nameChildList = mergeDuplicateSiblings(rawNameChildList);

      // 批量导入的树从一级开始挂载，整体深度不能超过 MAX_TAG_LEVEL
      if (findExceedingTagLevel(nameChildList, (item) => item.nameChildList) !== null) {
        return { success: false, message: TAG_LEVEL_EXCEEDED_MESSAGE };
      }

      const stats = await importTagTreeSynchronously(
        { id: teamId, slug: teamSlug },
        nameChildList,
        options?.imported,
        addType === 1 ? "overwrite" : "merge",
      );
      return { success: true, data: stats };
    } catch (error) {
      console.error("Batch create tags error:", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "批量创建标签失败",
      };
    }
  });
}

// 保存单个标签的变更（支持 create、update、delete）
export async function saveSingleTagChange(
  node: TagNode,
  parentId: number | null = null,
  level: number = 1,
): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      if (node.verb === "delete" && node.id) return deleteTagAndDescendants(node.id);
      // 层级以库里父节点的实际层级为准（客户端传入的 level 仅作兜底），新建节点不能超过 MAX_TAG_LEVEL
      let effectiveLevel = level;
      if (parentId !== null) {
        const parentTag = await prisma.assetTag.findFirst({
          where: { deletedAt: null, id: parentId, teamId },
          select: { level: true },
        });
        if (parentTag) effectiveLevel = Math.max(level, parentTag.level + 1);
      }
      if (tagNodesExceedMaxLevel([node], effectiveLevel)) {
        return { success: false, message: TAG_LEVEL_EXCEEDED_MESSAGE };
      }

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
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${teamId}::int, 5521735::int)::text`;
        if (
          parentId !== null &&
          !(await tx.assetTag.findFirst({
            where: { id: parentId, teamId, deletedAt: null },
            select: { id: true },
          }))
        ) {
          throw new Error("父标签不存在或已被删除，请刷新后重试");
        }
        if (node.verb === "delete" && node.id) {
          // 删除标签（级联删除子标签）
          await softDeleteTagSubtree(tx, teamId, node.id);
        } else if (node.verb === "create") {
          // 创建新标签
          if (!node.name.trim()) {
            throw new Error("标签名不能为空");
          }

          // 检查同级标签名是否重复
          const existingTag = await tx.assetTag.findFirst({
            where: { deletedAt: null, teamId, parentId, name: node.name.trim() },
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
              deletedAt: null,
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
            where: { deletedAt: null, id: node.id, teamId },
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
            where: { deletedAt: null, id, teamId },
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
    /** 仅对有子标签的分类有意义：子标签之间是否互斥。人工设置后系统不再自动覆盖 */
    siblingsExclusive?: boolean;
    /** 仅对有子标签的分类有意义：是否必打（每个素材都必须打出该分类下的一个子标签） */
    requiredGroup?: boolean;
  },
): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 获取现有标签
      const existingTag = await prisma.assetTag.findFirst({
        where: { deletedAt: null, id: tagId, teamId },
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
            deletedAt: null,
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

      // 与导入使用相同行锁，在最新配置上仅合并本次编辑字段；保护导入来源和后台策略。
      await prisma.$transaction((tx) =>
        applyTagConfigImportChunk(
          tx,
          teamId,
          [
            {
              tag: { id: tagId },
              record: { fields: data },
              data: updateData,
            },
          ],
          false,
        ),
      );

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

// 基于大模型生成标签树文本（严格结构化输出；长耗时场景请优先走 /api/tags/generate-tag-tree）
export async function generateTagTreeByLLM(
  finalPrompt: string,
  lang: Locale = "zh-CN",
): Promise<ServerActionResult<{ text: string; input: string }>> {
  "use server";

  return withAuth(async ({ team: { id: teamId } }) =>
    executeGenerateTagTreeByLLM({ finalPrompt, lang, teamId }),
  );
}
