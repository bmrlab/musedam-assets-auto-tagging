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

/** Explicitly delete deepest nodes first: the legacy API only removes direct children. */
export function buildCascadeDeletionTree(rows: DeletableTag[], plan: TagDeletionPlan): TagNode[] {
  return [...plan.descendants]
    .reverse()
    .concat(plan.target)
    .flatMap((row) => {
      if (!row.slug) return [];
      let node: TagNode = { ...row, verb: "delete", children: [] };
      let parentId = row.parentId;
      while (parentId !== null) {
        const parent = rows.find((item) => item.id === parentId);
        if (!parent?.slug) throw new Error("标签层级尚未与 MuseDAM 同步，请先同步标签后重试");
        node = { ...parent, children: [node] };
        parentId = parent.parentId;
      }
      return [node];
    });
}
