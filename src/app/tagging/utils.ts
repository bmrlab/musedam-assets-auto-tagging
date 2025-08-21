import "server-only";

import { TagWithChildren } from "@/prisma/client";
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

export async function fetchTagsTree({ teamId }: { teamId: number }) {
  const tags = await prisma.assetTag
    .findMany({
      where: {
        teamId,
        parentId: { equals: null },
      },
      orderBy: [{ id: "asc" }],
      select: {
        id: true,
        name: true,
        children: {
          orderBy: { id: "asc" },
          select: {
            id: true,
            name: true,
            children: {
              select: {
                id: true,
                name: true,
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
