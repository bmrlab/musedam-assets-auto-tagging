import "server-only";

import { rootLogger } from "@/lib/logging";
import { AsyncLocalStorage } from "node:async_hooks";

type EmbeddingTotals = {
  requested: number;
  generated: number;
  batches: number;
  activeBatches: number;
  activeSince: number;
  totalMs: number;
  elapsedMs: number;
  onDrained?: () => void;
};

const tracking = new AsyncLocalStorage<EmbeddingTotals>();

export async function trackClassificationEmbeddings<T>(
  context: { teamId: number; assetObjectId?: number; queueItemId?: number; frameCount: number },
  retrieve: () => Promise<T>,
): Promise<T> {
  const totals: EmbeddingTotals = {
    requested: 0,
    generated: 0,
    batches: 0,
    activeBatches: 0,
    activeSince: 0,
    totalMs: 0,
    elapsedMs: 0,
  };
  const logSummary = () => {
    rootLogger.info({
      msg: "Feature classification embedding summary",
      ...context,
      embeddingsRequested: totals.requested,
      embeddingsGenerated: totals.generated,
      embeddingBatches: totals.batches,
      embeddingTotalMs: Math.round(totals.totalMs),
      embeddingElapsedMs: Math.round(totals.elapsedMs),
    });
  };
  try {
    return await tracking.run(totals, retrieve);
  } finally {
    if (totals.activeBatches === 0) logSummary();
    else totals.onDrained = logSummary;
  }
}

export function startTrackedEmbeddingBatch(inputCount: number) {
  const totals = tracking.getStore();
  if (!totals) return;
  const startedAt = performance.now();
  totals.requested += inputCount;
  totals.batches++;
  if (totals.activeBatches++ === 0) totals.activeSince = startedAt;
  return (generated: number) => {
    const endedAt = performance.now();
    totals.generated += generated;
    totals.totalMs += endedAt - startedAt;
    // Count concurrent batches only once in the elapsed total.
    if (--totals.activeBatches === 0) {
      totals.elapsedMs += endedAt - totals.activeSince;
      const onDrained = totals.onDrained;
      totals.onDrained = undefined;
      onDrained?.();
    }
  };
}
