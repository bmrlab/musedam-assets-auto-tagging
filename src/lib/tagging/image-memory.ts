import { runInAbortableSlot } from "./abortable-slot";
import { throwIfQueueAborted } from "./queue-execution";
import "server-only";

import { rootLogger } from "@/lib/logging";
import pLimit from "p-limit";
import sharp from "sharp";

// libvips concurrency limits threads per image, not the number of images in flight.
// Share this slot across foreground crops, embeddings and background thumbnails.
const decodeSlot = pLimit(1);

export function imageMemorySnapshot() {
  const { rss, heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
  const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
  return {
    rssMB: mb(rss),
    heapUsedMB: mb(heapUsed),
    heapTotalMB: mb(heapTotal),
    externalMB: mb(external),
    arrayBuffersMB: mb(arrayBuffers),
    // A trend indicator only: RSS also includes code, stacks and allocator arenas.
    nonHeapRssMB: mb(Math.max(0, rss - heapTotal)),
    imageDecodesActive: decodeSlot.activeCount,
    imageDecodesPending: decodeSlot.pendingCount,
    sharp: sharp.counters(),
  };
}

export function withImageDecodeSlot<T>(stage: string, run: () => Promise<T>): Promise<T> {
  return runInAbortableSlot(decodeSlot, async () => {
    throwIfQueueAborted();
    const before = imageMemorySnapshot();
    const startedAt = Date.now();
    try {
      return await run();
    } finally {
      const after = imageMemorySnapshot();
      if (after.rssMB >= 600 || after.rssMB - before.rssMB >= 64) {
        rootLogger.info({
          msg: "Image decode memory",
          stage,
          durationMs: Date.now() - startedAt,
          before,
          after,
        });
      }
    }
  });
}
