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
  const children = new Map<number, DeletableTag[]>();
  for (const row of rows) {
    if (row.parentId !== null) {
      const siblings = children.get(row.parentId) ?? [];
      siblings.push(row);
      children.set(row.parentId, siblings);
    }
  }
  const descendants: DeletableTag[] = [];
  const seen = new Set([target.id]);
  const collect = (parentId: number) => {
    for (const row of children.get(parentId) ?? []) {
      if (seen.has(row.id)) throw new Error("标签树存在循环关系");
      seen.add(row.id);
      descendants.push(row);
      collect(row.id);
    }
  };
  collect(target.id);
  return { target, descendants };
}

export type TagDeletionPlan = ReturnType<typeof buildTagDeletionPlan>;

/** Deepest levels first for legacy gateways; share ancestor context within each level. */
export function buildCascadeDeletionTree(rows: DeletableTag[], plan: TagDeletionPlan): TagNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const stages = new Map<number, { roots: TagNode[]; nodes: Map<number, TagNode> }>();
  for (const row of [...plan.descendants].reverse().concat(plan.target)) {
    if (!row.slug) continue;
    const path = [row];
    const seen = new Set([row.id]);
    let parentId = row.parentId;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (!parent?.slug) throw new Error("标签层级尚未与 MuseDAM 同步，请先同步标签后重试");
      if (seen.has(parent.id)) throw new Error("标签树存在循环关系");
      seen.add(parent.id);
      path.unshift(parent);
      parentId = parent.parentId;
    }
    const stage = stages.get(path.length) ?? { roots: [], nodes: new Map<number, TagNode>() };
    stages.set(path.length, stage);
    let siblings = stage.roots;
    for (const item of path) {
      let node = stage.nodes.get(item.id);
      if (!node) {
        node = {
          ...item,
          ...(item.id === row.id ? { verb: "delete" as const } : {}),
          children: [],
        };
        siblings.push(node);
        stage.nodes.set(item.id, node);
      }
      siblings = node.children;
    }
  }
  return [...stages].sort(([a], [b]) => b - a).flatMap(([, stage]) => stage.roots);
}
