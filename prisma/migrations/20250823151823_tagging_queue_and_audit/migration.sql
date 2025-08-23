-- CreateEnum
CREATE TYPE "public"."TaggingQueueStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "public"."TaggingAuditStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "public"."TaggingQueueItem" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "assetObjectId" INTEGER,
    "status" "public"."TaggingQueueStatus" NOT NULL,
    "startsAt" TIMESTAMPTZ(6),
    "endsAt" TIMESTAMPTZ(6),
    "result" JSONB NOT NULL DEFAULT '{}',
    "extra" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TaggingQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TaggingAuditItem" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "assetObjectId" INTEGER,
    "status" "public"."TaggingAuditStatus" NOT NULL,
    "score" INTEGER NOT NULL,
    "tagPath" JSONB NOT NULL DEFAULT '[]',
    "leafTagId" INTEGER,
    "queueItemId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TaggingAuditItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaggingQueueItem_teamId_status_idx" ON "public"."TaggingQueueItem"("teamId", "status");

-- CreateIndex
CREATE INDEX "TaggingAuditItem_teamId_status_idx" ON "public"."TaggingAuditItem"("teamId", "status");

-- AddForeignKey
ALTER TABLE "public"."TaggingQueueItem" ADD CONSTRAINT "TaggingQueueItem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaggingQueueItem" ADD CONSTRAINT "TaggingQueueItem_assetObjectId_fkey" FOREIGN KEY ("assetObjectId") REFERENCES "public"."AssetObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaggingAuditItem" ADD CONSTRAINT "TaggingAuditItem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaggingAuditItem" ADD CONSTRAINT "TaggingAuditItem_assetObjectId_fkey" FOREIGN KEY ("assetObjectId") REFERENCES "public"."AssetObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaggingAuditItem" ADD CONSTRAINT "TaggingAuditItem_leafTagId_fkey" FOREIGN KEY ("leafTagId") REFERENCES "public"."AssetTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaggingAuditItem" ADD CONSTRAINT "TaggingAuditItem_queueItemId_fkey" FOREIGN KEY ("queueItemId") REFERENCES "public"."TaggingQueueItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
