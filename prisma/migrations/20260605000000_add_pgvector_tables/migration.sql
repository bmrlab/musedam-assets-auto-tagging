-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create vector table for logo embeddings
CREATE TABLE "LogoVector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" INTEGER NOT NULL,
    "assetLogoId" TEXT NOT NULL,
    "assetLogoImageId" TEXT NOT NULL,
    "logoTypeId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "embedding" vector(1024) NOT NULL,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "LogoVector_teamId_embedding_idx" ON "LogoVector" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX "LogoVector_teamId_idx" ON "LogoVector"("teamId");
CREATE INDEX "LogoVector_assetLogoId_idx" ON "LogoVector"("assetLogoId");
CREATE INDEX "LogoVector_status_idx" ON "LogoVector"("status");
CREATE INDEX "LogoVector_enabled_idx" ON "LogoVector"("enabled");

-- Create vector table for IP embeddings
CREATE TABLE "IpVector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" INTEGER NOT NULL,
    "assetIpId" TEXT NOT NULL,
    "assetIpImageId" TEXT,
    "ipTypeId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "matchPattern" TEXT NOT NULL DEFAULT 'whole',
    "partialMatchPatternName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceType" TEXT,
    "embedding" vector(1024) NOT NULL,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "IpVector_teamId_embedding_idx" ON "IpVector" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX "IpVector_teamId_idx" ON "IpVector"("teamId");
CREATE INDEX "IpVector_assetIpId_idx" ON "IpVector"("assetIpId");
CREATE INDEX "IpVector_status_idx" ON "IpVector"("status");
CREATE INDEX "IpVector_enabled_idx" ON "IpVector"("enabled");
CREATE INDEX "IpVector_sourceType_idx" ON "IpVector"("sourceType");

-- Create vector table for product embeddings
CREATE TABLE "ProductVector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" INTEGER NOT NULL,
    "assetProductId" TEXT NOT NULL,
    "assetProductImageId" TEXT,
    "productTypeId" TEXT,
    "generalCategory" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceType" TEXT,
    "embedding" vector(1024) NOT NULL,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ProductVector_teamId_embedding_idx" ON "ProductVector" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX "ProductVector_teamId_idx" ON "ProductVector"("teamId");
CREATE INDEX "ProductVector_assetProductId_idx" ON "ProductVector"("assetProductId");
CREATE INDEX "ProductVector_status_idx" ON "ProductVector"("status");
CREATE INDEX "ProductVector_enabled_idx" ON "ProductVector"("enabled");
CREATE INDEX "ProductVector_sourceType_idx" ON "ProductVector"("sourceType");

-- Create vector table for person embeddings
CREATE TABLE "PersonVector" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" INTEGER NOT NULL,
    "assetPersonId" TEXT NOT NULL,
    "assetPersonImageId" TEXT NOT NULL,
    "personTypeId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "embedding" vector(1024) NOT NULL,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "PersonVector_teamId_embedding_idx" ON "PersonVector" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
CREATE INDEX "PersonVector_teamId_idx" ON "PersonVector"("teamId");
CREATE INDEX "PersonVector_assetPersonId_idx" ON "PersonVector"("assetPersonId");
CREATE INDEX "PersonVector_status_idx" ON "PersonVector"("status");
CREATE INDEX "PersonVector_enabled_idx" ON "PersonVector"("enabled");
