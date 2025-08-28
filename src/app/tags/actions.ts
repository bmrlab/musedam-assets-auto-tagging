"use server";

import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { syncTagsFromMuseDAM } from "@/musedam/tags/syncFromMuseDAM";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";
import type { AssetTagExtra } from "@/prisma/client";
import { AssetTag } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { TagNode } from "./types";

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
      orderBy: [{ level: "asc" }, { name: "asc" }],
      include: {
        parent: true,
        children: {
          orderBy: { name: "asc" },
          include: {
            children: {
              orderBy: { name: "asc" },
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
      try {
        // 获取团队信息
        const team = await prisma.team.findUniqueOrThrow({
          where: { id: teamId },
        });

        await syncTagsToMuseDAM({
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

              if (existingTag) {
                throw new Error(`标签名 "${node.name}" 在同级中已存在`);
              }

              const createdTag = await tx.assetTag.create({
                data: {
                  teamId,
                  name: node.name.trim(),
                  level,
                  parentId,
                },
              });

              // 递归处理子标签
              if (node.children.length > 0) {
                await processNodes(node.children, createdTag.id, level + 1);
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
