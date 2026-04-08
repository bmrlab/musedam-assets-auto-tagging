-- CreateEnum
CREATE TYPE "public"."AssetLogoProcessStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "public"."AssetLogoType" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetLogoType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AssetLogo" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "logoTypeId" INTEGER,
    "logoTypeName" VARCHAR(100) NOT NULL,
    "status" "public"."AssetLogoProcessStatus" NOT NULL DEFAULT 'pending',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "deletedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetLogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AssetLogoImage" (
    "id" SERIAL NOT NULL,
    "assetLogoId" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "accessUrl" TEXT NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetLogoImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AssetLogoTag" (
    "id" SERIAL NOT NULL,
    "assetLogoId" INTEGER NOT NULL,
    "assetTagId" INTEGER,
    "tagPath" JSONB NOT NULL DEFAULT '[]',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetLogoTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetLogoType_teamId_deletedAt_idx" ON "public"."AssetLogoType"("teamId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetLogo_slug_key" ON "public"."AssetLogo"("slug");

-- CreateIndex
CREATE INDEX "AssetLogo_teamId_deletedAt_createdAt_idx" ON "public"."AssetLogo"("teamId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "AssetLogo_teamId_status_idx" ON "public"."AssetLogo"("teamId", "status");

-- CreateIndex
CREATE INDEX "AssetLogoImage_assetLogoId_sort_idx" ON "public"."AssetLogoImage"("assetLogoId", "sort");

-- CreateIndex
CREATE INDEX "AssetLogoTag_assetLogoId_sort_idx" ON "public"."AssetLogoTag"("assetLogoId", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "AssetLogoTag_assetLogoId_assetTagId_key" ON "public"."AssetLogoTag"("assetLogoId", "assetTagId");

-- AddForeignKey
ALTER TABLE "public"."AssetLogoType" ADD CONSTRAINT "AssetLogoType_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssetLogo" ADD CONSTRAINT "AssetLogo_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssetLogo" ADD CONSTRAINT "AssetLogo_logoTypeId_fkey" FOREIGN KEY ("logoTypeId") REFERENCES "public"."AssetLogoType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssetLogoImage" ADD CONSTRAINT "AssetLogoImage_assetLogoId_fkey" FOREIGN KEY ("assetLogoId") REFERENCES "public"."AssetLogo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssetLogoTag" ADD CONSTRAINT "AssetLogoTag_assetLogoId_fkey" FOREIGN KEY ("assetLogoId") REFERENCES "public"."AssetLogo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssetLogoTag" ADD CONSTRAINT "AssetLogoTag_assetTagId_fkey" FOREIGN KEY ("assetTagId") REFERENCES "public"."AssetTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
