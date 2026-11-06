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

/** One root operation: the main site's merge transaction recursively deletes its descendants. */
export function buildCascadeDeletionTree(rows: DeletableTag[], plan: TagDeletionPlan): TagNode[] {
  if (!plan.target.slug) {
    if (plan.descendants.some((tag) => tag.slug)) {
      throw new Error("标签层级尚未与 MuseDAM 同步，请先同步标签后重试");
    }
    return [];
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  let node: TagNode = { ...plan.target, verb: "delete", children: [] };
  const seen = new Set([plan.target.id]);
  let parentId = plan.target.parentId;
  while (parentId !== null) {
    const parent = byId.get(parentId);
    if (!parent?.slug) throw new Error("标签层级尚未与 MuseDAM 同步，请先同步标签后重试");
    if (seen.has(parent.id)) throw new Error("标签树存在循环关系");
    seen.add(parent.id);
    node = { ...parent, children: [node] };
    parentId = parent.parentId;
  }
  return [node];
}
