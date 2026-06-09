DROP INDEX IF EXISTS "public"."AssetLogo_teamId_deletedAt_createdAt_idx";

ALTER TABLE "public"."AssetLogo"
DROP COLUMN IF EXISTS "deletedAt";

CREATE INDEX IF NOT EXISTS "AssetLogo_teamId_createdAt_idx"
ON "public"."AssetLogo"("teamId", "createdAt");
