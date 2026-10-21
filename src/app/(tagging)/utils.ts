import "server-only";

import { buildChildrenSelect, MAX_TAG_LEVEL } from "@/lib/tagging/tag-level";
import { AssetTagExtra, TagWithChildren } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import {
  getExplicitRequiredGroup,
  getExplicitSiblingsExclusive,
  resolveEvidencePolicy,
} from "./evidence-policy";

/**
 * 构建标签结构的文本描述
 */
export const LITERAL_EVIDENCE_TAG_MARK = "【字面证据】";
export const SIBLINGS_EXCLUSIVE_TAG_MARK = "【同级互斥】";
export const REQUIRED_GROUP_TAG_MARK = "【必选】";

/**
 * 字面型标签（证据策略 literal）在标签体系文本里带上标记，让模型知道这类标签必须摘录 evidence，
 * 且不能仅凭画面印象给出。
 */
function literalMark(extra: unknown, tagPath: string[]): string {
  return resolveEvidencePolicy(extra, tagPath) === "literal" ? ` ${LITERAL_EVIDENCE_TAG_MARK}` : "";
}

/** 同级互斥的分类节点带标记，让模型知道其子标签只能选一个。 */
function exclusiveMark(extra: unknown): string {
  return getExplicitSiblingsExclusive(extra) ? ` ${SIBLINGS_EXCLUSIVE_TAG_MARK}` : "";
}

/** 必打的分类节点带标记，让模型知道必须在其下输出一个子标签。 */
function requiredMark(extra: unknown): string {
  return getExplicitRequiredGroup(extra) ? ` ${REQUIRED_GROUP_TAG_MARK}` : "";
}

/**
 * 子标签被裁剪过的分类：标出原有数量，让模型知道没列出的子标签不是不存在，而是没有字面命中。
 * 全部被裁掉时只陈述事实、不下"不要选择"的指令——该分类可能带【必选】，两条指令会互相矛盾；
 * 必打分类没有候选时由 ensureRequiredGroups / predictRequiredGroupChoices 用完整标签树兜底。
 */
function prunedMark(tagId: number, prunedGroups?: ReadonlyMap<number, PrunedGroupInfo>): string {
  const info = prunedGroups?.get(tagId);
  if (!info) return "";
  return info.shown > 0
    ? ` （共 ${info.total} 个子标签，仅列出在素材文字信息中字面出现的 ${info.shown} 个）`
    : ` （共 ${info.total} 个子标签，均未在素材文字信息中字面出现，因此未列出）`;
}

export type PrunedGroupInfo = { total: number; shown: number };

/**
 * 按层级递归输出标签体系文本，层级数不固定（最大 MAX_TAG_LEVEL）。
 * 格式（与 3 级时代保持一致）：一级节点前空一行；第 n 级（n >= 2）缩进 2 + 4 * (n - 2) 个空格并带 "└─ "。
 * 互斥 / 必选 / 裁剪标记：所有非叶子分类节点都输出；为与历史输出一致，1、2 级的叶子节点也照旧输出（通常为空）。
 */
export function buildTagStructureText(
  tags: TagWithChildren[],
  prunedGroups?: ReadonlyMap<number, PrunedGroupInfo>,
): string {
  let structureText = "";
  const walk = (nodes: TagWithChildren[], level: number, parentPath: string[]) => {
    for (const tag of nodes) {
      const path = [...parentPath, tag.name];
      const children = tag.children ?? [];
      const isGroup = children.length > 0 || level <= 2;
      const groupMarks = isGroup
        ? `${exclusiveMark(tag.extra)}${requiredMark(tag.extra)}${prunedMark(tag.id, prunedGroups)}`
        : "";
      const line = `Level ${level} (id: ${tag.id}): ${tag.name}${literalMark(tag.extra, path)}${groupMarks}\n`;
      structureText += level === 1 ? `\n${line}` : `${" ".repeat(2 + 4 * (level - 2))}└─ ${line}`;
      walk(children, level + 1, path);
    }
  };
  walk(tags, 1, []);
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
        // 每一层子标签都只取允许打标的（父节点关闭打标时整棵子树一并排除）
        ...buildChildrenSelect(
          MAX_TAG_LEVEL - 1,
          { id: true, name: true, extra: true },
          { where: { taggingEnabled: true }, orderBy: { id: "asc" } },
        ),
      } as { id: true; name: true; extra: true },
    })
    .then((tags) => tags as TagWithChildren[]);
  return tags;
}
