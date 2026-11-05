CREATE TABLE "FeatureLlmCall" (
    "id" UUID NOT NULL,
    "teamId" INTEGER NOT NULL,
    "queueItemId" INTEGER,
    "assetObjectId" INTEGER,
    "kind" VARCHAR(20) NOT NULL,
    "model" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "request" JSONB NOT NULL,
    "response" TEXT,
    "rawResponse" JSONB,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "imageTokens" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "inputCost" DECIMAL(18,9),
    "outputCost" DECIMAL(18,9),
    "totalCost" DECIMAL(18,9),
    "inputPricePerMillion" DECIMAL(18,9),
    "cachedInputPricePerMillion" DECIMAL(18,9),
    "outputPricePerMillion" DECIMAL(18,9),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeatureLlmCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeatureLlmCall_teamId_createdAt_idx" ON "FeatureLlmCall"("teamId", "createdAt");
CREATE INDEX "FeatureLlmCall_queueItemId_idx" ON "FeatureLlmCall"("queueItemId");
CREATE INDEX "FeatureLlmCall_assetObjectId_idx" ON "FeatureLlmCall"("assetObjectId");
ALTER TABLE "FeatureLlmCall" ADD CONSTRAINT "FeatureLlmCall_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
