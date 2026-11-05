import "server-only";

import { requestMuseDAMAPI } from "../lib";

export interface MergeTag {
  id?: number;
  name: string;
  operation: 0 | 1 | 2 | 3;
  sort?: number;
  children?: MergeTag[];
}

// Count ancestors as well as descendants: splitting only root groups still leaves
// large groups (such as thousands of SKUs) in a single upstream transaction.
export const MERGE_TAG_BATCH_SIZE = 1000;

const hasOperations = (tag: MergeTag): boolean =>
  tag.operation !== 0 || (tag.children ?? []).some(hasOperations);

const countNodes = (tag: MergeTag): number =>
  1 + (tag.children ?? []).reduce((sum, child) => sum + countNodes(child), 0);

/** Submit bounded requests serially, returning the same tree shape as the input. */
export async function mergeTagsInBatches(
  tags: MergeTag[],
  apiKey: string,
): Promise<{ tags: MergeTag[] }> {
  async function mergeLevel(nodes: MergeTag[], ancestors: MergeTag[]): Promise<MergeTag[]> {
    const capacity = MERGE_TAG_BATCH_SIZE - ancestors.length;
    const result: MergeTag[] = [];

    async function submit(batch: MergeTag[]): Promise<MergeTag[]> {
      let wrapped = batch;
      for (let i = ancestors.length - 1; i >= 0; i--) {
        wrapped = [{ ...ancestors[i], operation: 0, children: wrapped }];
      }
      // Do not retry create requests: a timeout may occur after the remote commit.
      const response = await requestMuseDAMAPI<{ tags: MergeTag[] }>("/api/muse/merge-tags", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: { tags: wrapped },
      });
      let level = response.tags;
      for (const ancestor of ancestors) {
        const parent = level.find((tag) => tag.id === ancestor.id);
        if (!parent?.children) throw new Error("MuseDAM merge-tags response missing parent tags");
        level = parent.children;
      }
      return level;
    }

    let batch: MergeTag[] = [];
    let size = 0;
    async function flush() {
      if (batch.length) result.push(...(await submit(batch)));
      batch = [];
      size = 0;
    }

    for (const node of nodes) {
      if (!hasOperations(node)) {
        await flush();
        result.push(node);
        continue;
      }
      const nodeSize = countNodes(node);
      if (nodeSize > capacity) {
        await flush();
        const { children, ...parentRequest } = node;
        // Existing parents are only context for the child batches. There is no
        // reason to submit a separate no-op request for them.
        const parent =
          parentRequest.operation === 0 && parentRequest.id !== undefined
            ? parentRequest
            : (await submit([parentRequest]))[0];
        if (!parent?.id) throw new Error("MuseDAM merge-tags response missing parent ID");
        const mergedChildren = await mergeLevel(children ?? [], [
          ...ancestors,
          { ...parentRequest, id: parent.id, operation: 0 },
        ]);
        result.push({ ...parent, children: mergedChildren });
      } else {
        if (size + nodeSize > capacity) await flush();
        batch.push(node);
        size += nodeSize;
      }
    }
    await flush();
    return result;
  }

  return { tags: await mergeLevel(tags, []) };
}
