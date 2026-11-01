import type { TagWithChildren } from "@/prisma/client";
import { flattenTagsTree, getExplicitRequiredGroup, TagTreeNodeWithPath } from "./evidence-policy";
import type { TagWithScore } from "./types";

/**
 * 画幅比例确定性打标：画幅是文件元数据，靠模型看图判断不可靠（客户反馈 1254×1254 的图打不上 1:1）。
 * 这里按标签树信息自动识别"画幅组"，再用素材真实宽高计算并直接打上对应子标签，不经过模型。
 *
 * 画幅组的识别规则（无需配置）：一个分类的直接子标签 ≥ 2 个、全部是叶子，且每个子标签名都能解析为
 * - 数值比例：1:1、9:16、16：9、3x4、1920×1080（按最大公约数归一，1920x1080 即 16:9）；
 * - 或方向词：横版/横图/横屏/landscape、竖版/竖图/竖屏/portrait、方图/方形/正方形/square。
 * 两类可以混用（如 横版/竖版/1:1）。
 * 子标签名末尾的括号备注会被忽略（如 "1:1（TTS详情页）"、"800×800（电商主图）"）。
 * 允许少数子标签解析不了（如 "其他尺寸（自定义）"、"长1600、宽度自适应"），只要能解析的占多数且至少 2 个；
 * 其中名为"其他/自定义"的子标签作为兜底，没有比例落在容差内时打它；
 * 其余解析不了的（如"长1600、宽度自适应"）交给模型按真实像素尺寸单独判断（见 predict.ts 的 predictUnparsedSizeTags）。
 */

export type AspectRatioSpec =
  | {
      kind: "ratio";
      value: number;
      label: string;
      /** 名字里写的原始数值（未约分），用于同比例子标签之间按像素精确匹配 */
      width: number;
      height: number;
    }
  | { kind: "orientation"; value: "landscape" | "portrait" | "square"; label: string };

export type AspectRatioGroup = {
  parentId: number;
  parentPath: string[];
  /** 分类被设为必打：宽高比超出容差时退回最近的比例子标签，保证不留空 */
  required: boolean;
  children: Array<{ id: number; tagPath: string[]; spec: AspectRatioSpec }>;
  /** 名为"其他尺寸/自定义"之类的子标签：没有比例落在容差内时打它 */
  fallbackChild?: { id: number; tagPath: string[] };
  /**
   * 解析不了的其余子标签：主打标流程里不让模型凭画面猜（看不到宽高），
   * 而是另外带上真实像素尺寸单独问一次模型。
   */
  unparsedChildren: Array<{ id: number; tagPath: string[] }>;
};

/** 比例最近匹配的容差：|ln(r_asset / r_tag)| ≤ ln(1 + 8%)。4:5 与 3:4 相差约 6.7%，仍能区分。 */
export const ASPECT_RATIO_TOLERANCE = 0.08;
/** 方向判定：宽高比超过 1.02 视为横版，低于 0.98 视为竖版，其间为方图 */
const SQUARE_BAND = 0.02;

/** 名字末尾的括号备注：（…） (…) 【…】 [...]，可能被截断而缺右括号 */
const TRAILING_NOTE_PATTERN = /\s*[（(【\[][^（）()【】\[\]]*[）)】\]]?\s*$/;
const FALLBACK_NAME_PATTERN = /^(其他|其它|自定义|other|others|custom)/i;

function stripTrailingNote(name: string): string {
  return (name ?? "").replace(TRAILING_NOTE_PATTERN, "").trim();
}

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
  const trimmed = stripTrailingNote(name);
  const ratio = RATIO_PATTERN.exec(trimmed);
  if (ratio) {
    const w = Number(ratio[1]);
    const h = Number(ratio[2]);
    if (w > 0 && h > 0) {
      const g = gcd(w, h);
      return { kind: "ratio", value: w / h, label: `${w / g}:${h / g}`, width: w, height: h };
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
    const parsed: AspectRatioGroup["children"] = [];
    const unparsed: TagTreeNodeWithPath[] = [];
    for (const child of children) {
      const spec = parseAspectRatioSpec(child.name);
      if (spec) parsed.push({ id: child.id, tagPath: child.tagPath, spec });
      else unparsed.push(child);
    }
    if (parsed.length < 2 || parsed.length <= unparsed.length) continue;
    const fallback = unparsed.find((child) => FALLBACK_NAME_PATTERN.test(child.name.trim()));
    groups.push({
      parentId: parent.id,
      parentPath: parent.tagPath,
      required: getExplicitRequiredGroup(parent.extra) === true,
      children: parsed,
      ...(fallback ? { fallbackChild: { id: fallback.id, tagPath: fallback.tagPath } } : {}),
      unparsedChildren: unparsed
        .filter((child) => child !== fallback)
        .map((child) => ({ id: child.id, tagPath: child.tagPath })),
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
    if (group.fallbackChild) childIds.add(group.fallbackChild.id);
    for (const child of group.unparsedChildren) childIds.add(child.id);
  }
  return { parentIds, childIds };
}

/**
 * 按素材真实宽高，为每个画幅组选出一个子标签。
 * 数值比例按对数距离取最近者，超出容差不打；方向词按横/竖/方判定；两类混用时数值优先（更具体）。
 * 多个子标签比例相同（如 1:1 / 800×800 / 1080×1080）时：像素与素材完全一致的优先，
 * 其次是纯比例写法（名字本身已是最简比，如 1:1），最后按标签顺序。
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

  // 同比例子标签之间的优先级，越小越优先
  const tieRank = (spec: Extract<AspectRatioSpec, { kind: "ratio" }>) =>
    spec.width === width && spec.height === height ? 0 : gcd(spec.width, spec.height) === 1 ? 1 : 2;
  // 浮点误差内视为同一比例（1920×1080 与 16:9）
  const EPSILON = 1e-9;
  type Candidate = { id: number; tagPath: string[]; distance: number; rank: number };
  const isBetter = (candidate: Candidate, current: Candidate | null) =>
    !current ||
    candidate.distance < current.distance - EPSILON ||
    (Math.abs(candidate.distance - current.distance) <= EPSILON && candidate.rank < current.rank);

  const result: TagWithScore[] = [];
  for (const group of groups) {
    let best: Candidate | null = null;
    let nearest: Candidate | null = null;
    for (const child of group.children) {
      if (child.spec.kind !== "ratio") continue;
      const candidate: Candidate = {
        id: child.id,
        tagPath: child.tagPath,
        distance: Math.abs(Math.log(assetRatio / child.spec.value)),
        rank: tieRank(child.spec),
      };
      if (isBetter(candidate, nearest)) nearest = candidate;
      if (candidate.distance <= maxDistance && isBetter(candidate, best)) best = candidate;
    }
    if (!best) {
      const byOrientation = group.children.find(
        (child) => child.spec.kind === "orientation" && child.spec.value === orientation,
      );
      if (byOrientation)
        best = { id: byOrientation.id, tagPath: byOrientation.tagPath, distance: 0, rank: 0 };
    }
    if (!best && group.fallbackChild) {
      best = { ...group.fallbackChild, distance: 0, rank: 0 };
    }
    // 必打分类：超出容差也要有一个，取最近的比例，低分标记为兜底，审核时能看出来
    if (!best && group.required && nearest) {
      result.push({
        leafTagId: nearest.id,
        tagPath: nearest.tagPath,
        confidenceBySources: {},
        score: 50,
        origin: "requiredFallback",
      });
      continue;
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

/**
 * 合并系统按比例打的标签和模型按像素尺寸认出的标签：
 * 模型在某个画幅组里认出了具体规格（如"长1600、宽度自适应"）时，该组的"其他尺寸"兜底就不再需要。
 */
export function mergeAiSizeTags({
  groups,
  systemTags,
  aiTags,
}: {
  groups: AspectRatioGroup[];
  systemTags: TagWithScore[];
  aiTags: TagWithScore[];
}): TagWithScore[] {
  if (aiTags.length === 0) return systemTags;
  const aiTagIds = new Set(aiTags.map((tag) => tag.leafTagId));
  const replacedFallbackIds = new Set<number>();
  for (const group of groups) {
    if (group.fallbackChild && group.unparsedChildren.some((child) => aiTagIds.has(child.id))) {
      replacedFallbackIds.add(group.fallbackChild.id);
    }
  }
  return [
    ...systemTags.filter(
      (tag) => !replacedFallbackIds.has(tag.leafTagId) && !aiTagIds.has(tag.leafTagId),
    ),
    ...aiTags,
  ];
}
