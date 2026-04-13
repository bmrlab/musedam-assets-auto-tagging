ALTER TABLE "public"."AssetLogo"
ADD COLUMN IF NOT EXISTS "processingError" TEXT,
ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMPTZ(6);

ALTER TABLE "public"."AssetLogoImage"
ADD COLUMN IF NOT EXISTS "qdrantPointId" VARCHAR(64),
ADD COLUMN IF NOT EXISTS "embeddingModel" VARCHAR(128),
ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX IF NOT EXISTS "AssetLogoImage_qdrantPointId_key"
ON "public"."AssetLogoImage"("qdrantPointId");
