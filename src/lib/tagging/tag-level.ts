import type { AssetTag } from "@/prisma/client";

/**
 * 企业标签树的最大层级。MuseDAM 后端已支持 4 级（query-tag-tree 最深返回 4 级，merge-tags 接受 4 级，
 * 超过 4 级报错 20101）。
 *
 * TODO: 后端提供团队标签设置接口后，改为读取团队设置（3 或 4 级），而不是写死常量。
 */
export const MAX_TAG_LEVEL = 4;

/**
 * 构造 Prisma 递归 `children` include，深度为 `depth` 层子节点（默认 MAX_TAG_LEVEL - 1，即从一级节点出发覆盖整棵树）。
 * `extra` 会合并到每一层的 children 查询参数里（如 where / orderBy / select 之外的条件）。
 *
 * 返回类型刻意放宽为 `any` 兼容的结构：Prisma 无法对动态深度做类型推导，调用方应把结果断言为
 * `TagWithChildren` 或自己的递归节点类型。
 */
export function buildChildrenInclude(
  depth: number = MAX_TAG_LEVEL - 1,
  extra: Record<string, unknown> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (depth <= 0) return undefined;
  const nested = buildChildrenInclude(depth - 1, extra);
  return {
    children: {
      ...extra,
      ...(nested ? { include: nested } : {}),
    },
  };
}

/**
 * 构造 Prisma 递归 `children` select：每层选 `fields`，并合并 `extra`（如 where / orderBy）。
 * 与 buildChildrenInclude 相同，返回值需由调用方断言类型。
 */
export function buildChildrenSelect(
  depth: number,
  fields: Record<string, boolean>,
  extra: Record<string, unknown> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (depth <= 0) return undefined;
  const nested = buildChildrenSelect(depth - 1, fields, extra);
  return {
    children: {
      ...extra,
      select: { ...fields, ...(nested ?? {}) },
    },
  };
}

/**
 * 构造 Prisma 递归 `parent` include，向上 `depth` 层（默认 MAX_TAG_LEVEL - 1，足以从叶子回溯到一级节点）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildParentInclude(depth: number = MAX_TAG_LEVEL - 1): any {
  if (depth <= 0) return undefined;
  const nested = buildParentInclude(depth - 1);
  return { parent: nested ? { include: nested } : true };
}

/** 完整 AssetTag 行 + 递归 children（Prisma `buildChildrenInclude` 的查询结果形状） */
export type AssetTagTreeNode = AssetTag & { children?: AssetTagTreeNode[] };

/**
 * 构造 Prisma 递归 `parent` select：每层选 `fields`，向上 `depth` 层（默认 MAX_TAG_LEVEL - 1）。
 */
export function buildParentSelect(
  fields: Record<string, boolean>,
  depth: number = MAX_TAG_LEVEL - 1,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (depth <= 0) return undefined;
  const nested = buildParentSelect(fields, depth - 1);
  return { parent: { select: { ...fields, ...(nested ?? {}) } } };
}

/** 带递归 parent 链的节点（Prisma `buildParentInclude` 的查询结果形状） */
export type TagWithParentChain<T = { name: string }> = T & {
  parent?: TagWithParentChain<T> | null;
};

/** 沿 parent 链向上收集节点，返回从根到当前节点的顺序 */
export function walkParentChain<T>(tag: TagWithParentChain<T>): TagWithParentChain<T>[] {
  const chain: TagWithParentChain<T>[] = [];
  let current: TagWithParentChain<T> | null | undefined = tag;
  // 防御：限制步数，避免脏数据形成环
  let guard = 0;
  while (current && guard < 64) {
    chain.unshift(current);
    current = current.parent;
    guard++;
  }
  return chain;
}

/** 沿 parent 链构造从根到当前节点的名称路径 */
export function buildTagNamePath(tag: TagWithParentChain<{ name: string }>): string[] {
  return walkParentChain(tag).map((node) => node.name);
}

/** 计算一组树节点的最大深度（根节点所在层为 1；空数组为 0） */
export function getTreeDepth<T extends { children?: T[] | null }>(
  nodes: T[] | null | undefined,
): number {
  if (!nodes || nodes.length === 0) return 0;
  let max = 0;
  for (const node of nodes) {
    const d = 1 + getTreeDepth(node.children ?? undefined);
    if (d > max) max = d;
  }
  return max;
}

/** 服务端层级超限时返回的错误信息（server action 目前直接返回中文 message，UI 可按此常量匹配后做 i18n） */
export const TAG_LEVEL_EXCEEDED_MESSAGE = `标签层级不能超过 ${MAX_TAG_LEVEL} 级`;

/**
 * 检查一棵（待写入的）标签树在挂到 `baseLevel` 层后是否超过 MAX_TAG_LEVEL。
 * - `isCounted` 返回 false 的节点（如将被删除的节点）连同其子树不参与计算；
 * - `isChecked` 返回 false 的节点即使超限也不报错（如已存在、本次未改动的节点，避免历史数据阻塞保存），
 *   但仍会继续检查其子孙。
 * 返回第一个超限节点所在层级；未超限返回 null。
 */
export function findExceedingTagLevel<T>(
  nodes: T[] | null | undefined,
  getChildren: (node: T) => T[] | null | undefined,
  {
    baseLevel = 1,
    isCounted = () => true,
    isChecked = () => true,
    maxLevel = MAX_TAG_LEVEL,
  }: {
    baseLevel?: number;
    isCounted?: (node: T) => boolean;
    isChecked?: (node: T) => boolean;
    maxLevel?: number;
  } = {},
): number | null {
  for (const node of nodes ?? []) {
    if (!isCounted(node)) continue;
    if (baseLevel > maxLevel && isChecked(node)) return baseLevel;
    const deeper = findExceedingTagLevel(getChildren(node), getChildren, {
      baseLevel: baseLevel + 1,
      isCounted,
      isChecked,
      maxLevel,
    });
    if (deeper !== null) return deeper;
  }
  return null;
}
