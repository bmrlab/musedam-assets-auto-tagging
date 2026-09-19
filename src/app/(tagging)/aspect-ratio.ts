import type { TagWithChildren } from "@/prisma/client";
import { flattenTagsTree, TagTreeNodeWithPath } from "./evidence-policy";
import type { TagWithScore } from "./types";

/**
 * 画幅比例确定性打标：画幅是文件元数据，靠模型看图判断不可靠（客户反馈 1254×1254 的图打不上 1:1）。
 * 这里按标签树信息自动识别"画幅组"，再用素材真实宽高计算并直接打上对应子标签，不经过模型。
 *
 * 画幅组的识别规则（无需配置）：一个分类的直接子标签 ≥ 2 个、全部是叶子，且每个子标签名都能解析为
 * - 数值比例：1:1、9:16、16：9、3x4、1920×1080（按最大公约数归一，1920x1080 即 16:9）；
 * - 或方向词：横版/横图/横屏/landscape、竖版/竖图/竖屏/portrait、方图/方形/正方形/square。
 * 两类可以混用（如 横版/竖版/1:1）。
 */

export type AspectRatioSpec =
  | { kind: "ratio"; value: number; label: string }
  | { kind: "orientation"; value: "landscape" | "portrait" | "square"; label: string };

export type AspectRatioGroup = {
  parentId: number;
  parentPath: string[];
  children: Array<{ id: number; tagPath: string[]; spec: AspectRatioSpec }>;
};

/** 比例最近匹配的容差：|ln(r_asset / r_tag)| ≤ ln(1 + 8%)。4:5 与 3:4 相差约 6.7%，仍能区分。 */
export const ASPECT_RATIO_TOLERANCE = 0.08;
/** 方向判定：宽高比超过 1.02 视为横版，低于 0.98 视为竖版，其间为方图 */
const SQUARE_BAND = 0.02;

const RATIO_PATTERN = /^\s*(\d+)\s*[:：xX×*\/]\s*(\d+)\s*$/;
const ORIENTATION_WORDS: Array<[RegExp, "landscape" | "portrait" | "square"]> = [
  [/^(横版|横图|横屏|横向|横构图|landscape|horizontal)$/i, "landscape"],
  [/^(竖版|竖图|竖屏|竖向|竖构图|纵向|portrait|vertical)$/i, "portrait"],
  [/^(方图|方形|方版|正方形|正方|square)$/i, "square"],
];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function parseAspectRatioSpec(name: string): AspectRatioSpec | null {
  const trimmed = (name ?? "").trim();
  const ratio = RATIO_PATTERN.exec(trimmed);
  if (ratio) {
    const w = Number(ratio[1]);
    const h = Number(ratio[2]);
    if (w > 0 && h > 0) {
      const g = gcd(w, h);
      return { kind: "ratio", value: w / h, label: `${w / g}:${h / g}` };
    }
    return null;
  }
  for (const [pattern, value] of ORIENTATION_WORDS) {
    if (pattern.test(trimmed)) return { kind: "orientation", value, label: trimmed };
  }
  return null;
}

/** 从标签树里识别所有画幅组。 */
export function detectAspectRatioGroups(tagsTree: TagWithChildren[]): AspectRatioGroup[] {
  const nodes = flattenTagsTree(tagsTree);
  const childrenByParent = new Map<number, TagTreeNodeWithPath[]>();
  for (const node of nodes) {
    if (node.parentId === undefined) continue;
    const list = childrenByParent.get(node.parentId) ?? [];
    list.push(node);
    childrenByParent.set(node.parentId, list);
  }
  const groups: AspectRatioGroup[] = [];
  for (const parent of nodes) {
    const children = childrenByParent.get(parent.id) ?? [];
    if (children.length < 2 || children.some((child) => child.hasChildren)) continue;
    const parsed = children.map((child) => ({ child, spec: parseAspectRatioSpec(child.name) }));
    if (parsed.some(({ spec }) => spec === null)) continue;
    groups.push({
      parentId: parent.id,
      parentPath: parent.tagPath,
      children: parsed.map(({ child, spec }) => ({
        id: child.id,
        tagPath: child.tagPath,
        spec: spec!,
      })),
    });
  }
  return groups;
}

/** 画幅组的所有子标签 id（用于把模型对这些标签的猜测丢掉、以及互斥/必打判定时跳过这些组）。 */
export function collectAspectRatioTagIds(groups: AspectRatioGroup[]): {
  parentIds: Set<number>;
  childIds: Set<number>;
} {
  const parentIds = new Set<number>();
  const childIds = new Set<number>();
  for (const group of groups) {
    parentIds.add(group.parentId);
    for (const child of group.children) childIds.add(child.id);
  }
  return { parentIds, childIds };
}

/**
 * 按素材真实宽高，为每个画幅组选出一个子标签。
 * 数值比例按对数距离取最近者，超出容差不打；方向词按横/竖/方判定；两类混用时数值优先（更具体）。
 */
export function resolveAspectRatioTags({
  groups,
  width,
  height,
}: {
  groups: AspectRatioGroup[];
  width: number | undefined | null;
  height: number | undefined | null;
}): TagWithScore[] {
  if (
    !width ||
    !height ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return [];
  }
  const assetRatio = width / height;
  const maxDistance = Math.log(1 + ASPECT_RATIO_TOLERANCE);
  const orientation: "landscape" | "portrait" | "square" =
    assetRatio > 1 + SQUARE_BAND
      ? "landscape"
      : assetRatio < 1 - SQUARE_BAND
        ? "portrait"
        : "square";

  const result: TagWithScore[] = [];
  for (const group of groups) {
    let best: { id: number; tagPath: string[]; distance: number } | null = null;
    for (const child of group.children) {
      if (child.spec.kind !== "ratio") continue;
      const distance = Math.abs(Math.log(assetRatio / child.spec.value));
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        best = { id: child.id, tagPath: child.tagPath, distance };
      }
    }
    if (!best) {
      const byOrientation = group.children.find(
        (child) => child.spec.kind === "orientation" && child.spec.value === orientation,
      );
      if (byOrientation)
        best = { id: byOrientation.id, tagPath: byOrientation.tagPath, distance: 0 };
    }
    if (best) {
      result.push({
        leafTagId: best.id,
        tagPath: best.tagPath,
        confidenceBySources: {},
        score: 100,
        origin: "aspectRatio",
      });
    }
  }
  return result;
}
