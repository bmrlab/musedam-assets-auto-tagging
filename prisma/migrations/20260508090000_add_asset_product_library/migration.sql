CREATE TYPE "public"."AssetProductProcessStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE "public"."AssetProductType" (
    "id" UUID NOT NULL,
    "teamId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetProductType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AssetProduct" (
    "id" UUID NOT NULL,
    "teamId" INTEGER NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "productTypeId" UUID,
    "productTypeName" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "generalCategory" VARCHAR(100) NOT NULL DEFAULT '',
    "status" "public"."AssetProductProcessStatus" NOT NULL DEFAULT 'pending',
    "processingError" TEXT,
    "processedAt" TIMESTAMPTZ(6),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AssetProductImage" (
    "id" UUID NOT NULL,
    "assetProductId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "qdrantPointId" VARCHAR(64),
    "embeddingModel" VARCHAR(128),
    "embeddedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetProductImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AssetProductTag" (
    "id" UUID NOT NULL,
    "assetProductId" UUID NOT NULL,
    "assetTagId" INTEGER,
    "tagPath" JSONB NOT NULL DEFAULT '[]',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetProductTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetProduct_slug_key" ON "public"."AssetProduct"("slug");

CREATE UNIQUE INDEX "AssetProductImage_qdrantPointId_key" ON "public"."AssetProductImage"("qdrantPointId");

CREATE UNIQUE INDEX "AssetProductTag_assetProductId_assetTagId_key" ON "public"."AssetProductTag"("assetProductId", "assetTagId");

CREATE INDEX "AssetProduct_teamId_createdAt_idx" ON "public"."AssetProduct"("teamId", "createdAt");

CREATE INDEX "AssetProduct_teamId_status_idx" ON "public"."AssetProduct"("teamId", "status");

CREATE INDEX "AssetProduct_teamId_generalCategory_idx" ON "public"."AssetProduct"("teamId", "generalCategory");

CREATE INDEX "AssetProductImage_assetProductId_sort_idx" ON "public"."AssetProductImage"("assetProductId", "sort");

CREATE INDEX "AssetProductTag_assetProductId_sort_idx" ON "public"."AssetProductTag"("assetProductId", "sort");

ALTER TABLE "public"."AssetProductType" ADD CONSTRAINT "AssetProductType_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetProduct" ADD CONSTRAINT "AssetProduct_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetProduct" ADD CONSTRAINT "AssetProduct_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "public"."AssetProductType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."AssetProductImage" ADD CONSTRAINT "AssetProductImage_assetProductId_fkey" FOREIGN KEY ("assetProductId") REFERENCES "public"."AssetProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetProductTag" ADD CONSTRAINT "AssetProductTag_assetProductId_fkey" FOREIGN KEY ("assetProductId") REFERENCES "public"."AssetProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetProductTag" ADD CONSTRAINT "AssetProductTag_assetTagId_fkey" FOREIGN KEY ("assetTagId") REFERENCES "public"."AssetTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
