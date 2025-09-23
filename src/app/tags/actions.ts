"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { idToSlug } from "@/lib/slug";
import { syncTagsFromMuseDAM } from "@/musedam/tags/syncFromMuseDAM";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";
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

// 定义同步结果的类型
type SyncResult = {
  tags: MuseDAMTagRequest[];
  createdTagMapping: Map<string, MuseDAMID>;
};

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

export async function saveTagsTree(tagsTree: TagNode[]): Promise<ServerActionResult<void>> {
  return withAuth(async ({ team: { id: teamId } }) => {
    try {
      // 在数据库操作前先同步到 MuseDAM（此时数据库中的数据还是完整的）
      let syncResult: SyncResult | null = null;
      try {
        // 获取团队信息
        const team = await prisma.team.findUniqueOrThrow({
          where: { id: teamId },
        });

        syncResult = await syncTagsToMuseDAM({
          team: { id: teamId, slug: team.slug },
          tagsTree,
        });
      } catch (error) {
        console.error("Sync to MuseDAM error:", error);
        // MuseDAM 同步失败不影响本地保存结果
      }

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
                const createdTag = await tx.assetTag.create({
                  data: {
                    teamId,
                    name: node.name.trim(),
                    level,
                    parentId,
                  },
                });
                targetTagId = createdTag.id;

                // 如果有同步结果且该标签是新创建的，更新 slug
                if (syncResult && node.tempId) {
                  const musedamId = syncResult.createdTagMapping.get(node.tempId);
                  if (musedamId) {
                    const slug = idToSlug("assetTag", musedamId);
                    await tx.assetTag.update({
                      where: { id: targetTagId },
                      data: { slug },
                    });
                  }
                }
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
      if (addType === 1) {
        // 仅保留新建标签树：先同步到 MuseDAM，然后创建标签并更新 slug
        const team = await prisma.team.findUniqueOrThrow({
          where: { id: teamId },
        });

        // 转换为 TagNode 格式用于同步
        const convertToTagNodes = (
          data: BatchCreateTagData[],
          parentPath: string = "",
        ): TagNode[] => {
          return data.map((item, index) => {
            const currentPath = parentPath
              ? `${parentPath}_${index}`
              : `batch_${Date.now()}_${index}`;
            return {
              id: undefined,
              slug: null,
              name: item.name,
              originalName: item.name,
              children: item.nameChildList
                ? convertToTagNodes(item.nameChildList, currentPath)
                : [],
              verb: "create" as const,
              tempId: currentPath,
            };
          });
        };

        const tagsTree = convertToTagNodes(nameChildList);
        let syncResult: SyncResult | null = null;

        // 先同步到 MuseDAM
        try {
          syncResult = await syncTagsToMuseDAM({
            team: { id: teamId, slug: team.slug },
            tagsTree,
          });
        } catch (error) {
          console.error("Sync to MuseDAM error:", error);
          // MuseDAM 同步失败不影响本地保存结果
        }

        // 然后创建标签并更新 slug
        await prisma.$transaction(async (tx) => {
          // 1. 删除所有现有标签（级联删除子标签）
          await tx.assetTag.deleteMany({
            where: { teamId },
          });

          // 2. 创建新标签
          const createTagsRecursively = async (
            data: BatchCreateTagData[],
            parentId: number | null = null,
            level: number = 1,
            tempIdPrefix: string = "",
          ) => {
            for (let i = 0; i < data.length; i++) {
              const item = data[i];
              if (!item.name.trim()) {
                throw new Error("标签名不能为空");
              }

              const currentTempId = tempIdPrefix
                ? `${tempIdPrefix}_${i}`
                : `batch_${Date.now()}_${i}`;

              // 检查同级标签名是否重复
              const existingTag = await tx.assetTag.findFirst({
                where: {
                  teamId,
                  parentId,
                  name: item.name.trim(),
                },
              });

              let targetTagId: number;

              if (existingTag) {
                // 标签已存在，使用现有标签的ID
                targetTagId = existingTag.id;
              } else {
                // 标签不存在，创建新标签
                const createdTag = await tx.assetTag.create({
                  data: {
                    teamId,
                    name: item.name.trim(),
                    level,
                    parentId,
                  },
                });
                targetTagId = createdTag.id;

                // 如果有同步结果且该标签是新创建的，更新 slug
                if (syncResult && syncResult.createdTagMapping) {
                  const musedamId = syncResult.createdTagMapping.get(currentTempId);
                  if (musedamId) {
                    const slug = idToSlug("assetTag", musedamId);
                    await tx.assetTag.update({
                      where: { id: targetTagId },
                      data: { slug },
                    });
                  }
                }
              }

              // 递归创建子标签
              if (item.nameChildList && item.nameChildList.length > 0) {
                await createTagsRecursively(
                  item.nameChildList,
                  targetTagId,
                  level + 1,
                  currentTempId,
                );
              }
            }
          };

          await createTagsRecursively(nameChildList);
        });
      } else {
        // 合并到现有标签系统：使用现有的 saveTagsTree 逻辑
        const convertToTagNodes = (data: BatchCreateTagData[]): TagNode[] => {
          return data.map((item) => ({
            id: undefined,
            slug: null,
            name: item.name,
            originalName: item.name,
            children: item.nameChildList ? convertToTagNodes(item.nameChildList) : [],
            verb: "create" as const,
            tempId: `batch_${Date.now()}_${Math.random()}`,
          }));
        };

        const tagsTree = convertToTagNodes(nameChildList);
        const result = await saveTagsTree(tagsTree);

        if (!result.success) {
          return result;
        }
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
        syncResult = await syncTagsToMuseDAM({
          team: { id: teamId, slug: team.slug },
          tagsTree: singleNodeTree,
        });
      } catch (error) {
        console.error("Sync to MuseDAM error:", error);
        // MuseDAM 同步失败不影响本地保存结果
      }

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
            const createdTag = await tx.assetTag.create({
              data: {
                teamId,
                name: node.name.trim(),
                level,
                parentId,
              },
            });
            targetTagId = createdTag.id;

            // 如果有同步结果且该标签是新创建的，更新 slug
            if (syncResult && syncResult.createdTagMapping && node.tempId) {
              const musedamId = syncResult.createdTagMapping.get(node.tempId);
              if (musedamId) {
                const slug = idToSlug("assetTag", musedamId);
                await tx.assetTag.update({
                  where: { id: targetTagId },
                  data: { slug },
                });
              }
            }
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
      const updateData: { name?: string; extra?: AssetTagExtra } = {};

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
