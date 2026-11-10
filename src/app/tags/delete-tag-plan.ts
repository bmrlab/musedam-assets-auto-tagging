import { deletionIdLayers } from "@/lib/tagging/delete-tag-layers";
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

/**
 * Whole subtree, deepest layer first. Each DELETE only contains nodes whose
 * children are already gone, so ON DELETE SET NULL cannot turn a still-living
 * child into a root and trip AssetTag_teamId_name_key.
 */
export function deletionLayers(plan: TagDeletionPlan): number[][] {
  return deletionIdLayers([...plan.descendants, plan.target]);
}

/**
 * MuseDAM cascade-deletes children when a parent is removed, so a subtree is
 * one delete on the highest synced node. Listing every descendant turns a
 * parent with thousands of children into thousands of merge-tags operations.
 */
export function buildCascadeDeletionTree(rows: DeletableTag[], plan: TagDeletionPlan): TagNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const affected = [plan.target, ...plan.descendants];
  const affectedIds = new Set(affected.map((row) => row.id));
  const tops = affected.filter((row) => {
    if (!row.slug) return false;
    let parentId = row.parentId;
    while (parentId !== null && affectedIds.has(parentId)) {
      const parent = byId.get(parentId);
      if (parent?.slug) return false;
      if (!parent) break;
      parentId = parent.parentId;
    }
    return true;
  });
  return forestFor(tops.map((row) => row.id));

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
