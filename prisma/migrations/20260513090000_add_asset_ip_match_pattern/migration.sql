CREATE TYPE "public"."AssetIpMatchPattern" AS ENUM ('whole', 'partial');

ALTER TABLE "public"."AssetIp"
ADD COLUMN "matchPattern" "public"."AssetIpMatchPattern" NOT NULL DEFAULT 'whole';

ALTER TABLE "public"."AssetIpImage"
ADD COLUMN "partialMatchPatternName" VARCHAR(64),
ADD COLUMN "cropXMin" DOUBLE PRECISION,
ADD COLUMN "cropYMin" DOUBLE PRECISION,
ADD COLUMN "cropXMax" DOUBLE PRECISION,
ADD COLUMN "cropYMax" DOUBLE PRECISION,
ADD COLUMN "cropImageWidth" DOUBLE PRECISION,
ADD COLUMN "cropImageHeight" DOUBLE PRECISION,
ADD COLUMN "cropSource" VARCHAR(32),
ADD COLUMN "cropDetectionLabel" VARCHAR(100),
ADD COLUMN "cropDetectionScore" DOUBLE PRECISION;

CREATE INDEX "AssetIp_matchPattern_idx" ON "public"."AssetIp"("matchPattern");

CREATE INDEX "AssetIpImage_partialMatchPatternName_idx" ON "public"."AssetIpImage"("partialMatchPatternName");
