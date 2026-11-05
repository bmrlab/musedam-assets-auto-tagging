import { deletionIdLayers } from "@/lib/tagging/delete-tag-layers";
import prisma from "@/prisma/prisma";

const INITIAL_BATCH = 100;
const MIN_BATCH = 20;
const MAX_BATCH = 400;

function isTimeout(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /timeout|timed out|expired/i.test(message);
}

/**
 * Commit leaf deletes in small batches. Each deleted tag updates unindexed
 * foreign keys, so one statement for thousands of rows runs past the gateway.
 * Finished batches stay deleted, and the caller can invoke this again.
 */
export async function deleteTagsWithinBudget(
  teamId: number,
  rows: { id: number; parentId: number | null }[],
  budgetMs = 25_000,
): Promise<boolean> {
  const remaining = new Map(rows.map((row) => [row.id, row.parentId]));
  const deadline = Date.now() + budgetMs;
  let batchSize = INITIAL_BATCH;
  while (remaining.size > 0 && Date.now() < deadline) {
    const leaves = deletionIdLayers(
      [...remaining].map(([id, parentId]) => ({ id, parentId })),
    )[0];
    if (!leaves?.length) throw new Error("标签层级存在循环，无法删除");
    const batch = leaves.slice(0, batchSize);
    const started = Date.now();
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.assetTag.deleteMany({ where: { teamId, id: { in: batch } } });
        },
        { timeout: 12_000 },
      );
    } catch (error) {
      if (!isTimeout(error) || batchSize <= MIN_BATCH) throw error;
      batchSize = Math.max(MIN_BATCH, Math.floor(batchSize / 2));
      continue;
    }
    for (const id of batch) remaining.delete(id);
    if (Date.now() - started < 1_500 && batch.length === batchSize) {
      batchSize = Math.min(MAX_BATCH, batchSize * 2);
    }
  }
  return remaining.size === 0;
}
