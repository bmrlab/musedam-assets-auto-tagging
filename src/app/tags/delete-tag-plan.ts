import type { TagNode } from "./types";

export interface DeletableTag {
  id: number;
  name: string;
  slug: string | null;
  parentId: number | null;
  level: number;
  sort: number;
}

/** Build from database rows, never from the possibly filtered client tree. */
export function buildTagDeletionPlan(rows: DeletableTag[], tagId: number) {
  const target = rows.find((row) => row.id === tagId);
  if (!target) throw new Error("标签不存在或已被删除，请刷新后重试");
  const descendants: DeletableTag[] = [];
  const collect = (parentId: number) => {
    for (const row of rows.filter((row) => row.parentId === parentId)) {
      descendants.push(row);
      collect(row.id);
    }
  };
  collect(target.id);
  return { target, descendants };
}

export type TagDeletionPlan = ReturnType<typeof buildTagDeletionPlan>;

/**
 * Delete deepest nodes first: the legacy API only removes direct children.
 * Siblings share one ancestor path so a few thousand leaves stay a handful of requests.
 */
export function buildCascadeDeletionTree(rows: DeletableTag[], plan: TagDeletionPlan): TagNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = [...plan.descendants]
    .reverse()
    .concat(plan.target)
    .filter((row) => row.slug);
  const deleting = new Set(ordered.map((row) => row.id));
  const childIds = new Map<number, number[]>();
  for (const row of ordered) {
    if (row.parentId !== null && deleting.has(row.parentId)) {
      const list = childIds.get(row.parentId) ?? [];
      list.push(row.id);
      childIds.set(row.parentId, list);
    }
  }

  const result: TagNode[] = [];
  const remaining = new Set(deleting);
  while (remaining.size > 0) {
    const leaves = ordered.filter(
      (row) =>
        remaining.has(row.id) && (childIds.get(row.id) ?? []).every((id) => !remaining.has(id)),
    );
    if (leaves.length === 0) throw new Error("标签层级存在循环，无法删除");
    result.push(...forestFor(leaves.map((row) => row.id)));
    for (const row of leaves) remaining.delete(row.id);
  }
  return result;

  function forestFor(leafIds: number[]): TagNode[] {
    const roots: TagNode[] = [];
    const nodeByPath = new Map<string, TagNode>();
    for (const leafId of leafIds) {
      const chain: DeletableTag[] = [];
      let cursor = byId.get(leafId);
      while (cursor) {
        chain.push(cursor);
        if (cursor.parentId === null) break;
        const parent = byId.get(cursor.parentId);
        if (!parent?.slug) throw new Error("标签层级尚未与 MuseDAM 同步，请先同步标签后重试");
        cursor = parent;
      }
      chain.reverse();
      let siblings = roots;
      let path = "";
      chain.forEach((row, index) => {
        path += `/${row.id}`;
        const isLeaf = index === chain.length - 1;
        let node = nodeByPath.get(path);
        if (!node) {
          node = {
            id: row.id,
            slug: row.slug,
            name: row.name,
            sort: row.sort,
            children: [],
            ...(isLeaf ? { verb: "delete" as const } : {}),
          };
          nodeByPath.set(path, node);
          siblings.push(node);
        } else if (isLeaf) {
          node.verb = "delete";
        }
        siblings = node.children;
      });
    }
    return roots;
  }
}
