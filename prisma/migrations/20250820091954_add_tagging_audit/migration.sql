-- CreateEnum
CREATE TYPE "public"."TaggingAuditStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "public"."TaggingQueueItem" ADD COLUMN     "extra" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "public"."TaggingAuditItem" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "assetObjectId" INTEGER NOT NULL,
    "status" "public"."TaggingAuditStatus" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "tagPath" JSONB NOT NULL DEFAULT '[]',
    "leafTagId" INTEGER NOT NULL,
    "queueItemId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TaggingAuditItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaggingAuditItem_teamId_status_idx" ON "public"."TaggingAuditItem"("teamId", "status");

-- AddForeignKey
ALTER TABLE "public"."TaggingAuditItem" ADD CONSTRAINT "TaggingAuditItem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaggingAuditItem" ADD CONSTRAINT "TaggingAuditItem_assetObjectId_fkey" FOREIGN KEY ("assetObjectId") REFERENCES "public"."AssetObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaggingAuditItem" ADD CONSTRAINT "TaggingAuditItem_leafTagId_fkey" FOREIGN KEY ("leafTagId") REFERENCES "public"."Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaggingAuditItem" ADD CONSTRAINT "TaggingAuditItem_queueItemId_fkey" FOREIGN KEY ("queueItemId") REFERENCES "public"."TaggingQueueItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
