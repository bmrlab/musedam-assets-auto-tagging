export type SavedTagSort = { id: number; sort: number };

/** 只回填服务端确认的排序值，保留子树和保存期间新增的本地草稿。 */
export function applySavedTagSort<T extends { id?: number; sort?: number; children: T[] }>(
  nodes: T[],
  saved: SavedTagSort[],
): T[] {
  const byId = new Map(saved.map((item) => [item.id, item.sort]));
  const walk = (siblings: T[]): T[] => {
    let changed = false;
    let childrenChanged = false;
    const result = siblings.map((node) => {
      const sort = node.id ? byId.get(node.id) : undefined;
      if (sort !== undefined) changed = true;
      const children = walk(node.children);
      childrenChanged ||= children !== node.children;
      return sort !== undefined || children !== node.children
        ? { ...node, ...(sort !== undefined ? { sort } : {}), children }
        : node;
    });
    return changed
      ? result.sort(
          (a, b) =>
            (b.sort ?? 0) - (a.sort ?? 0) ||
            (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER),
        )
      : childrenChanged ? result : siblings;
  };
  return walk(nodes);
}
