-- Add missing indexes that were causing full table scans on the hot tagging path.
-- Use ordinary index creation so the multi-statement migration is safe for
-- Prisma migrate deploy; existing indexes are retained.

-- Supports processPendingQueueItems(): `where status = 'pending' order by createdAt asc`
CREATE INDEX IF NOT EXISTS "TaggingQueueItem_status_createdAt_idx"
  ON "public"."TaggingQueueItem"("status", "createdAt");

-- Supports recoverStaleProcessingItems(): `where status = 'processing' and updatedAt < staleBefore`
CREATE INDEX IF NOT EXISTS "TaggingQueueItem_status_updatedAt_idx"
  ON "public"."TaggingQueueItem"("status", "updatedAt");

-- Supports buildAssetObjectTags() and other `where slug in (...)` lookups on every processed
-- queue item; AssetTag.slug previously had no index at all (full table scan per task).
CREATE INDEX IF NOT EXISTS "AssetTag_slug_idx"
  ON "public"."AssetTag"("slug");
