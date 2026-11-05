/** Deepest layer first. A layer only contains rows whose children are already gone. */
export function deletionIdLayers(rows: { id: number; parentId: number | null }[]): number[][] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const childCount = new Map<number, number>();
  for (const row of rows) {
    if (row.parentId !== null && byId.has(row.parentId)) {
      childCount.set(row.parentId, (childCount.get(row.parentId) ?? 0) + 1);
    }
  }
  const remaining = new Set(rows.map((row) => row.id));
  const layers: number[][] = [];
  while (remaining.size > 0) {
    const layer = [...remaining].filter((id) => (childCount.get(id) ?? 0) === 0);
    if (layer.length === 0) throw new Error("标签层级存在循环，无法删除");
    for (const id of layer) {
      remaining.delete(id);
      const parentId = byId.get(id)?.parentId;
      if (parentId !== null && parentId !== undefined && remaining.has(parentId)) {
        childCount.set(parentId, (childCount.get(parentId) ?? 1) - 1);
      }
    }
    layers.push(layer);
  }
  return layers;
}
