-- CreateEnum
CREATE TYPE "public"."TaggingQueueStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "public"."TaggingQueueItem" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "assetObjectId" INTEGER NOT NULL,
    "status" "public"."TaggingQueueStatus" NOT NULL,
    "startsAt" TIMESTAMPTZ(6),
    "endsAt" TIMESTAMPTZ(6),
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TaggingQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaggingQueueItem_teamId_status_idx" ON "public"."TaggingQueueItem"("teamId", "status");

-- AddForeignKey
ALTER TABLE "public"."TaggingQueueItem" ADD CONSTRAINT "TaggingQueueItem_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaggingQueueItem" ADD CONSTRAINT "TaggingQueueItem_assetObjectId_fkey" FOREIGN KEY ("assetObjectId") REFERENCES "public"."AssetObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
