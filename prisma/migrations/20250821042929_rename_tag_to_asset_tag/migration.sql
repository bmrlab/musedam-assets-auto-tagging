/*
  Warnings:

  - You are about to drop the `Tag` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Tag" DROP CONSTRAINT "Tag_parentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Tag" DROP CONSTRAINT "Tag_teamId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TaggingAuditItem" DROP CONSTRAINT "TaggingAuditItem_leafTagId_fkey";

-- DropTable
DROP TABLE "public"."Tag";

-- CreateTable
CREATE TABLE "public"."AssetTag" (
    "id" SERIAL NOT NULL,
    "teamId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(64),
    "level" INTEGER NOT NULL DEFAULT 1,
    "parentId" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AssetTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssetTag_teamId_parentId_idx" ON "public"."AssetTag"("teamId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetTag_teamId_level_name_key" ON "public"."AssetTag"("teamId", "level", "name");

-- AddForeignKey
ALTER TABLE "public"."AssetTag" ADD CONSTRAINT "AssetTag_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AssetTag" ADD CONSTRAINT "AssetTag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."AssetTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TaggingAuditItem" ADD CONSTRAINT "TaggingAuditItem_leafTagId_fkey" FOREIGN KEY ("leafTagId") REFERENCES "public"."AssetTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
