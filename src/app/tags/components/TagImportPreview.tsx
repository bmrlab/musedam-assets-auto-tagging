"use client";

import { useMemo, useState } from "react";
import { nameChildListToPreviewTagNodes } from "../batchTagText";
import type { TagBatchCreateNode } from "../tagBatchSpreadsheet";
import type { TagNode } from "../types";
import { TagLevelColumns } from "./TagLevelColumns";

export function TagImportPreview({
  tree,
  maxLevel,
}: {
  tree: TagBatchCreateNode[];
  maxLevel: 3 | 4;
}) {
  const nodes = useMemo(() => nameChildListToPreviewTagNodes(tree), [tree]);
  const [selected, setSelected] = useState<(string | null)[]>([]);
  const lists: TagNode[][] = [nodes];
  const selectedIds: (string | null)[] = [];
  for (let level = 0; level < maxLevel; level++) {
    const current = lists[level];
    const node = current.find((item) => item.tempId === selected[level]) ?? current[0];
    selectedIds.push(node?.tempId ?? null);
    if (level < maxLevel - 1) lists.push(node?.children ?? []);
  }
  return (
    <div className="h-72 min-w-0 overflow-auto rounded-lg border border-basic-3">
      <TagLevelColumns
        lists={lists}
        selectedIds={selectedIds}
        onSelect={(level, id) => setSelected((previous) => [...previous.slice(0, level - 1), id])}
        levelCount={maxLevel}
        canEdit={false}
        showAdd={false}
        showAiTags={false}
        getNodeId={(node) => node.tempId!}
      />
    </div>
  );
}
