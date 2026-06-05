/*
  Warnings:

  - You are about to drop the column `qdrantPointId` on the `AssetIpImage` table. All the data in the column will be lost.
  - You are about to drop the column `qdrantPointId` on the `AssetLogoImage` table. All the data in the column will be lost.
  - You are about to drop the column `qdrantPointId` on the `AssetPersonImage` table. All the data in the column will be lost.
  - You are about to drop the column `qdrantPointId` on the `AssetProductImage` table. All the data in the column will be lost.
  - The primary key for the `IpVector` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `IpVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(64)`.
  - The `assetIpImageId` column on the `IpVector` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `ipTypeId` column on the `IpVector` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `matchPattern` on the `IpVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `partialMatchPatternName` on the `IpVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(64)`.
  - You are about to alter the column `status` on the `IpVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `sourceType` on the `IpVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `embeddingModel` on the `IpVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(128)`.
  - The primary key for the `LogoVector` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `LogoVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(64)`.
  - The `logoTypeId` column on the `LogoVector` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `status` on the `LogoVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `embeddingModel` on the `LogoVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(128)`.
  - The primary key for the `PersonVector` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `PersonVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(64)`.
  - The `personTypeId` column on the `PersonVector` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `status` on the `PersonVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `embeddingModel` on the `PersonVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(128)`.
  - The primary key for the `ProductVector` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `ProductVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(64)`.
  - The `assetProductImageId` column on the `ProductVector` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `productTypeId` column on the `ProductVector` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to alter the column `generalCategory` on the `ProductVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(100)`.
  - You are about to alter the column `status` on the `ProductVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `sourceType` on the `ProductVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(20)`.
  - You are about to alter the column `embeddingModel` on the `ProductVector` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(128)`.
  - A unique constraint covering the columns `[pgvectorPointId]` on the table `AssetIpImage` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[pgvectorPointId]` on the table `AssetLogoImage` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[pgvectorPointId]` on the table `AssetPersonImage` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[pgvectorPointId]` on the table `AssetProductImage` will be added. If there are existing duplicate values, this will fail.
  - Changed the type of `assetIpId` on the `IpVector` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `assetLogoId` on the `LogoVector` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `assetLogoImageId` on the `LogoVector` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `assetPersonId` on the `PersonVector` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `assetPersonImageId` on the `PersonVector` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `assetProductId` on the `ProductVector` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropIndex
DROP INDEX "public"."AssetIpImage_qdrantPointId_key";

-- DropIndex
DROP INDEX "public"."AssetLogoImage_qdrantPointId_key";

-- DropIndex
DROP INDEX "public"."AssetPersonImage_qdrantPointId_key";

-- DropIndex
DROP INDEX "public"."AssetProductImage_qdrantPointId_key";

-- DropIndex
DROP INDEX "public"."IpVector_enabled_idx";

-- DropIndex
DROP INDEX "public"."IpVector_sourceType_idx";

-- DropIndex
DROP INDEX "public"."IpVector_status_idx";

-- DropIndex
DROP INDEX "public"."IpVector_teamId_embedding_idx";

-- DropIndex
DROP INDEX "public"."IpVector_teamId_idx";

-- DropIndex
DROP INDEX "public"."LogoVector_enabled_idx";

-- DropIndex
DROP INDEX "public"."LogoVector_status_idx";

-- DropIndex
DROP INDEX "public"."LogoVector_teamId_embedding_idx";

-- DropIndex
DROP INDEX "public"."LogoVector_teamId_idx";

-- DropIndex
DROP INDEX "public"."PersonVector_enabled_idx";

-- DropIndex
DROP INDEX "public"."PersonVector_status_idx";

-- DropIndex
DROP INDEX "public"."PersonVector_teamId_embedding_idx";

-- DropIndex
DROP INDEX "public"."PersonVector_teamId_idx";

-- DropIndex
DROP INDEX "public"."ProductVector_enabled_idx";

-- DropIndex
DROP INDEX "public"."ProductVector_sourceType_idx";

-- DropIndex
DROP INDEX "public"."ProductVector_status_idx";

-- DropIndex
DROP INDEX "public"."ProductVector_teamId_embedding_idx";

-- DropIndex
DROP INDEX "public"."ProductVector_teamId_idx";

-- AlterTable
ALTER TABLE "public"."AssetIpImage" DROP COLUMN "qdrantPointId",
ADD COLUMN     "pgvectorPointId" VARCHAR(64);

-- AlterTable
ALTER TABLE "public"."AssetLogoImage" DROP COLUMN "qdrantPointId",
ADD COLUMN     "pgvectorPointId" VARCHAR(64);

-- AlterTable
ALTER TABLE "public"."AssetPersonImage" DROP COLUMN "qdrantPointId",
ADD COLUMN     "pgvectorPointId" VARCHAR(64);

-- AlterTable
ALTER TABLE "public"."AssetProductImage" DROP COLUMN "qdrantPointId",
ADD COLUMN     "pgvectorPointId" VARCHAR(64);

-- AlterTable
ALTER TABLE "public"."IpVector" DROP CONSTRAINT "IpVector_pkey",
ALTER COLUMN "id" SET DATA TYPE VARCHAR(64),
DROP COLUMN "assetIpId",
ADD COLUMN     "assetIpId" UUID NOT NULL,
DROP COLUMN "assetIpImageId",
ADD COLUMN     "assetIpImageId" UUID,
DROP COLUMN "ipTypeId",
ADD COLUMN     "ipTypeId" UUID,
ALTER COLUMN "matchPattern" DROP DEFAULT,
ALTER COLUMN "matchPattern" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "partialMatchPatternName" SET DATA TYPE VARCHAR(64),
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "sourceType" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "embeddingModel" SET DATA TYPE VARCHAR(128),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ADD CONSTRAINT "IpVector_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "public"."LogoVector" DROP CONSTRAINT "LogoVector_pkey",
ALTER COLUMN "id" SET DATA TYPE VARCHAR(64),
DROP COLUMN "assetLogoId",
ADD COLUMN     "assetLogoId" UUID NOT NULL,
DROP COLUMN "assetLogoImageId",
ADD COLUMN     "assetLogoImageId" UUID NOT NULL,
DROP COLUMN "logoTypeId",
ADD COLUMN     "logoTypeId" UUID,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "embeddingModel" SET DATA TYPE VARCHAR(128),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ADD CONSTRAINT "LogoVector_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "public"."PersonVector" DROP CONSTRAINT "PersonVector_pkey",
ALTER COLUMN "id" SET DATA TYPE VARCHAR(64),
DROP COLUMN "assetPersonId",
ADD COLUMN     "assetPersonId" UUID NOT NULL,
DROP COLUMN "assetPersonImageId",
ADD COLUMN     "assetPersonImageId" UUID NOT NULL,
DROP COLUMN "personTypeId",
ADD COLUMN     "personTypeId" UUID,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "embeddingModel" SET DATA TYPE VARCHAR(128),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ADD CONSTRAINT "PersonVector_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "public"."ProductVector" DROP CONSTRAINT "ProductVector_pkey",
ALTER COLUMN "id" SET DATA TYPE VARCHAR(64),
DROP COLUMN "assetProductId",
ADD COLUMN     "assetProductId" UUID NOT NULL,
DROP COLUMN "assetProductImageId",
ADD COLUMN     "assetProductImageId" UUID,
DROP COLUMN "productTypeId",
ADD COLUMN     "productTypeId" UUID,
ALTER COLUMN "generalCategory" DROP DEFAULT,
ALTER COLUMN "generalCategory" SET DATA TYPE VARCHAR(100),
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "sourceType" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "embeddingModel" SET DATA TYPE VARCHAR(128),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ADD CONSTRAINT "ProductVector_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE UNIQUE INDEX "AssetIpImage_pgvectorPointId_key" ON "public"."AssetIpImage"("pgvectorPointId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetLogoImage_pgvectorPointId_key" ON "public"."AssetLogoImage"("pgvectorPointId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetPersonImage_pgvectorPointId_key" ON "public"."AssetPersonImage"("pgvectorPointId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetProductImage_pgvectorPointId_key" ON "public"."AssetProductImage"("pgvectorPointId");

-- CreateIndex
CREATE INDEX "IpVector_teamId_status_enabled_idx" ON "public"."IpVector"("teamId", "status", "enabled");

-- CreateIndex
CREATE INDEX "IpVector_teamId_sourceType_status_enabled_idx" ON "public"."IpVector"("teamId", "sourceType", "status", "enabled");

-- CreateIndex
CREATE INDEX "IpVector_assetIpId_idx" ON "public"."IpVector"("assetIpId");

-- CreateIndex
CREATE INDEX "LogoVector_teamId_status_enabled_idx" ON "public"."LogoVector"("teamId", "status", "enabled");

-- CreateIndex
CREATE INDEX "LogoVector_assetLogoId_idx" ON "public"."LogoVector"("assetLogoId");

-- CreateIndex
CREATE INDEX "PersonVector_teamId_status_enabled_idx" ON "public"."PersonVector"("teamId", "status", "enabled");

-- CreateIndex
CREATE INDEX "PersonVector_assetPersonId_idx" ON "public"."PersonVector"("assetPersonId");

-- CreateIndex
CREATE INDEX "ProductVector_teamId_status_enabled_idx" ON "public"."ProductVector"("teamId", "status", "enabled");

-- CreateIndex
CREATE INDEX "ProductVector_teamId_sourceType_status_enabled_idx" ON "public"."ProductVector"("teamId", "sourceType", "status", "enabled");

-- CreateIndex
CREATE INDEX "ProductVector_assetProductId_idx" ON "public"."ProductVector"("assetProductId");
