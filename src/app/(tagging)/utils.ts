import "server-only";

import { TagWithChildren, AssetTagExtra } from "@/prisma/client";
import prisma from "@/prisma/prisma";

/**
 * 构建标签结构的文本描述
 */
export function buildTagStructureText(tags: TagWithChildren[]): string {
  let structureText = "";
  for (const level1Tag of tags) {
    structureText += `\Level 1 (id: ${level1Tag.id}): ${level1Tag.name}\n`;
    for (const level2Tag of level1Tag.children ?? []) {
      structureText += `  └─ Level 2 (id: ${level2Tag.id}): ${level2Tag.name}\n`;
      for (const level3Tag of level2Tag.children ?? []) {
        structureText += `      └─ Level 3 (id: ${level3Tag.id}): ${level3Tag.name}\n`;
      }
    }
  }
  return structureText;
}

/**
 * 构建标签关键词信息的文本描述
 */
export function buildTagKeywordsText(tags: TagWithChildren[]): string {
  let keywordsText = "";
  
  const processTag = (tag: TagWithChildren, level: number = 1) => {
    const indent = "  ".repeat(level - 1);
    const extra = (tag.extra as AssetTagExtra) || {};
    
    if (extra.keywords && extra.keywords.length > 0) {
      keywordsText += `${indent}标签: ${tag.name} (id: ${tag.id})\n`;
      keywordsText += `${indent}  匹配关键词: ${extra.keywords.join(", ")}\n`;
      
      if (extra.negativeKeywords && extra.negativeKeywords.length > 0) {
        keywordsText += `${indent}  排除关键词: ${extra.negativeKeywords.join(", ")}\n`;
      }
      keywordsText += "\n";
    }
    
    // 递归处理子标签
    if (tag.children) {
      for (const child of tag.children) {
        processTag(child, level + 1);
      }
    }
  };
  
  for (const tag of tags) {
    processTag(tag);
  }
  
  return keywordsText || "暂无标签关键词配置";
}

export async function fetchTagsTree({ teamId }: { teamId: number }) {
  const tags = await prisma.assetTag
    .findMany({
      where: {
        teamId,
        parentId: { equals: null },
        taggingEnabled: true, // 只获取允许打标的标签
      },
      orderBy: [{ id: "asc" }],
      select: {
        id: true,
        name: true,
        extra: true, // 添加 extra 字段以获取关键词信息
        children: {
          where: {
            taggingEnabled: true, // 子标签也需要过滤
          },
          orderBy: { id: "asc" },
          select: {
            id: true,
            name: true,
            extra: true, // 添加 extra 字段
            children: {
              where: {
                taggingEnabled: true, // 三级标签也需要过滤
              },
              select: {
                id: true,
                name: true,
                extra: true, // 添加 extra 字段
              },
              orderBy: { id: "asc" },
            },
          },
        },
      },
    })
    .then((tags) => tags as TagWithChildren[]);
  return tags;
}
