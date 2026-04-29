CREATE TYPE "public"."AssetPersonProcessStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE "public"."AssetPersonType" (
    "id" UUID NOT NULL,
    "teamId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetPersonType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AssetPerson" (
    "id" UUID NOT NULL,
    "teamId" INTEGER NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "personTypeId" UUID,
    "personTypeName" VARCHAR(100) NOT NULL,
    "status" "public"."AssetPersonProcessStatus" NOT NULL DEFAULT 'pending',
    "processingError" TEXT,
    "processedAt" TIMESTAMPTZ(6),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetPerson_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AssetPersonImage" (
    "id" UUID NOT NULL,
    "assetPersonId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "qdrantPointId" VARCHAR(64),
    "embeddingModel" VARCHAR(128),
    "embeddedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetPersonImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AssetPersonTag" (
    "id" UUID NOT NULL,
    "assetPersonId" UUID NOT NULL,
    "assetTagId" INTEGER,
    "tagPath" JSONB NOT NULL DEFAULT '[]',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetPersonTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetPerson_slug_key" ON "public"."AssetPerson"("slug");

CREATE UNIQUE INDEX "AssetPersonImage_qdrantPointId_key" ON "public"."AssetPersonImage"("qdrantPointId");

CREATE UNIQUE INDEX "AssetPersonTag_assetPersonId_assetTagId_key" ON "public"."AssetPersonTag"("assetPersonId", "assetTagId");

CREATE INDEX "AssetPerson_teamId_createdAt_idx" ON "public"."AssetPerson"("teamId", "createdAt");

CREATE INDEX "AssetPerson_teamId_status_idx" ON "public"."AssetPerson"("teamId", "status");

CREATE INDEX "AssetPersonImage_assetPersonId_sort_idx" ON "public"."AssetPersonImage"("assetPersonId", "sort");

CREATE INDEX "AssetPersonTag_assetPersonId_sort_idx" ON "public"."AssetPersonTag"("assetPersonId", "sort");

ALTER TABLE "public"."AssetPersonType" ADD CONSTRAINT "AssetPersonType_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetPerson" ADD CONSTRAINT "AssetPerson_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetPerson" ADD CONSTRAINT "AssetPerson_personTypeId_fkey" FOREIGN KEY ("personTypeId") REFERENCES "public"."AssetPersonType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."AssetPersonImage" ADD CONSTRAINT "AssetPersonImage_assetPersonId_fkey" FOREIGN KEY ("assetPersonId") REFERENCES "public"."AssetPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetPersonTag" ADD CONSTRAINT "AssetPersonTag_assetPersonId_fkey" FOREIGN KEY ("assetPersonId") REFERENCES "public"."AssetPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AssetPersonTag" ADD CONSTRAINT "AssetPersonTag_assetTagId_fkey" FOREIGN KEY ("assetTagId") REFERENCES "public"."AssetTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
