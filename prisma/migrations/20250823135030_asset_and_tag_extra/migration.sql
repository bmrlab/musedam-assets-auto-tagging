-- AlterTable
ALTER TABLE "public"."AssetObject" ADD COLUMN     "extra" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "public"."AssetTag" ADD COLUMN     "extra" JSONB NOT NULL DEFAULT '{}';
