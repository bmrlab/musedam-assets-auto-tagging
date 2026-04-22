CREATE TYPE "public"."AssetIpProcessStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE "public"."AssetIpType" (
    "id" UUID NOT NULL,
    "teamId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetIpType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AssetIp" (
    "id" UUID NOT NULL,
    "teamId" INTEGER NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "ipTypeId" UUID,
    "ipTypeName" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "public"."AssetIpProcessStatus" NOT NULL DEFAULT 'pending',
    "processingError" TEXT,
    "processedAt" TIMESTAMPTZ(6),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetIp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AssetIpImage" (
    "id" UUID NOT NULL,
    "assetIpId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "qdrantPointId" VARCHAR(64),
    "embeddingModel" VARCHAR(128),
    "embeddedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetIpImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AssetIpTag" (
    "id" UUID NOT NULL,
    "assetIpId" UUID NOT NULL,
    "assetTagId" INTEGER,
    "tagPath" JSONB NOT NULL DEFAULT '[]',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetIpTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetIp_slug_key" ON "public"."AssetIp"("slug");

CREATE UNIQUE INDEX "AssetIpImage_qdrantPointId_key" ON "public"."AssetIpImage"("qdrantPointId");

CREATE UNIQUE INDEX "AssetIpTag_assetIpId_assetTagId_key" ON "public"."AssetIpTag"("assetIpId", "assetTagId");

CREATE INDEX "AssetIp_teamId_createdAt_idx" ON "public"."AssetIp"("teamId", "createdAt");

CREATE INDEX "AssetIp_teamId_status_idx" ON "public"."AssetIp"("teamId", "status");

CREATE INDEX "AssetIpImage_assetIpId_sort_idx" ON "public"."AssetIpImage"("assetIpId", "sort");

CREATE INDEX "AssetIpTag_assetIpId_sort_idx" ON "public"."AssetIpTag"("assetIpId", "sort");

ALTER TABLE "public"."AssetIpType" ADD CONSTRAINT "AssetIpType_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetIp" ADD CONSTRAINT "AssetIp_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetIp" ADD CONSTRAINT "AssetIp_ipTypeId_fkey" FOREIGN KEY ("ipTypeId") REFERENCES "public"."AssetIpType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."AssetIpImage" ADD CONSTRAINT "AssetIpImage_assetIpId_fkey" FOREIGN KEY ("assetIpId") REFERENCES "public"."AssetIp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetIpTag" ADD CONSTRAINT "AssetIpTag_assetIpId_fkey" FOREIGN KEY ("assetIpId") REFERENCES "public"."AssetIp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetIpTag" ADD CONSTRAINT "AssetIpTag_assetTagId_fkey" FOREIGN KEY ("assetTagId") REFERENCES "public"."AssetTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
