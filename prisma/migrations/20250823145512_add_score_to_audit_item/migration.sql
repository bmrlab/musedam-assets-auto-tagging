/*
  Warnings:

  - You are about to drop the column `confidence` on the `TaggingAuditItem` table. All the data in the column will be lost.
  - Added the required column `score` to the `TaggingAuditItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."TaggingAuditItem" DROP COLUMN "confidence",
ADD COLUMN     "score" INTEGER NOT NULL;
