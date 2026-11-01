import { MAX_TAG_LEVEL } from "@/lib/tagging/tag-level";
import type { TagNode } from "./types";

export interface NameChildList {
  name: string;
  nameChildList?: NameChildList[];
}

/** 标题最多支持的 `#` 个数随团队层级变化：最末级由普通文本承担，所以标题深度是 maxLevel - 1 */

/**
 * 解析批量创建标签的文本（手动创建 / AI 生成结果共用）：
 * - `#` 一级标签，`##` 二级标签，`###` 三级标签；
 * - 普通文本为最近一个标题的子标签（最末级）：`##` 下的普通文本为三级（兼容旧的三层格式），
 *   `###` 下的普通文本为四级；
 * - 标题必须逐级出现（`##` 需在 `#` 之后，`###` 需在 `##` 之后），否则该行无效；
 * - `####` 及以上、空名称标题、或层级超过 MAX_TAG_LEVEL 的行无效。无效标题之后的普通文本
 *   也一并忽略（直到下一个有效标题），避免被误挂到上一个标题下；
 * - 同一父级下同名标签会合并（后续子标签合并到已有节点）。
 */
export function parseBatchTagText(text: string, maxLevel: number = MAX_TAG_LEVEL): NameChildList[] {
  if (!text || !text.trim()) return [];
  const maxHeadingDepth = Math.max(1, maxLevel - 1);

  const result: NameChildList[] = [];
  // stack[i] 为当前第 i+1 级标题节点
  const stack: NameChildList[] = [];
  // 最近一个标题无效时为 true，此时忽略其后的普通文本
  let skipping = false;

  const findOrAppend = (siblings: NameChildList[], name: string): NameChildList => {
    const existing = siblings.find((item) => item.name === name);
    if (existing) {
      existing.nameChildList ??= [];
      return existing;
    }
    const node: NameChildList = { name, nameChildList: [] };
    siblings.push(node);
    return node;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const hashes = /^#+/.exec(line)?.[0].length ?? 0;

    if (hashes > 0) {
      const name = line.slice(hashes).trim();
      const level = hashes;
      const parentReady = level === 1 || stack.length >= level - 1;
      if (!name || level > maxHeadingDepth || level > maxLevel || !parentReady) {
        skipping = true;
        continue;
      }
      const siblings = level === 1 ? result : stack[level - 2].nameChildList!;
      const node = findOrAppend(siblings, name);
      stack.length = level - 1;
      stack.push(node);
      skipping = false;
      continue;
    }

    // 普通文本：最近标题的子标签
    if (skipping || stack.length === 0) continue;
    if (stack.length + 1 > maxLevel) continue;
    const parent = stack[stack.length - 1];
    parent.nameChildList ??= [];
    if (parent.nameChildList.some((item) => item.name === line)) continue;
    parent.nameChildList.push({ name: line });
  }

  return result;
}

/** NameChildList -> TagNode（用于预览），tempId 按路径生成保证全树唯一 */
export function nameChildListToPreviewTagNodes(
  nameChildList: NameChildList[],
  idPrefix = "preview",
): TagNode[] {
  return nameChildList.map((item, index) => {
    const tempId = `${idPrefix}_${index}`;
    return {
      id: undefined,
      slug: null,
      name: item.name,
      originalName: item.name,
      children: item.nameChildList
        ? nameChildListToPreviewTagNodes(item.nameChildList, tempId)
        : [],
      tempId,
    };
  });
}
