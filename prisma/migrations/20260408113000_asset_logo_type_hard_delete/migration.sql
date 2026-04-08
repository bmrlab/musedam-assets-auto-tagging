DROP INDEX IF EXISTS "public"."AssetLogoType_teamId_deletedAt_idx";

ALTER TABLE "public"."AssetLogoType"
DROP COLUMN IF EXISTS "deletedAt";
