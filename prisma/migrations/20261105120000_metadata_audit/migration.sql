CREATE TABLE "MetadataAuditItem" (
 "id" SERIAL PRIMARY KEY, "teamId" INTEGER NOT NULL REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "assetObjectId" INTEGER NOT NULL REFERENCES "AssetObject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "queueItemId" INTEGER NOT NULL REFERENCES "TaggingQueueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "fieldId" TEXT NOT NULL, "prediction" JSONB NOT NULL,
 "status" "TaggingAuditStatus" NOT NULL DEFAULT 'pending',
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT "MetadataAuditItem_queueItemId_fieldId_key" UNIQUE ("queueItemId", "fieldId")
);
CREATE INDEX "MetadataAuditItem_teamId_status_createdAt_idx" ON "MetadataAuditItem"("teamId", "status", "createdAt");
