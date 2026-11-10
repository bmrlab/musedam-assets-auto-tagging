ALTER TABLE "AssetTag" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
DROP INDEX "AssetTag_teamId_parentId_name_key";
DROP INDEX "AssetTag_teamId_name_key";
CREATE UNIQUE INDEX "AssetTag_active_sibling_name_key" ON "AssetTag" ("teamId", "parentId", "name") WHERE "deletedAt" IS NULL AND "parentId" IS NOT NULL;
CREATE UNIQUE INDEX "AssetTag_active_root_name_key" ON "AssetTag" ("teamId", "name") WHERE "deletedAt" IS NULL AND "parentId" IS NULL;
CREATE INDEX "AssetTag_teamId_deletedAt_parentId_idx" ON "AssetTag" ("teamId", "deletedAt", "parentId");
-- Worker polls globally, separately for test and production, ordered by age.
CREATE INDEX "TaggingQueueItem_pending_createdAt_idx" ON "TaggingQueueItem" ("createdAt", "id") INCLUDE ("taskType") WHERE "status" = 'pending';

-- Statement triggers invalidate once per affected team, including legacy/raw SQL writers.
-- Keep this in the same transaction as the tree write so workers never observe a new tree with an old version.
CREATE FUNCTION bump_asset_tag_cache_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "TeamConfig" ("teamId", "key", "value", "createdAt", "updatedAt")
  SELECT DISTINCT "teamId", 'tagging-config-version', '{"version":1}'::jsonb, now(), now() FROM changed_tags
  ON CONFLICT ("teamId", "key") DO UPDATE SET
    "value" = jsonb_build_object('version', COALESCE(("TeamConfig"."value"->>'version')::bigint, 0) + 1),
    "updatedAt" = now();
  RETURN NULL;
END;
$$;
CREATE TRIGGER asset_tag_cache_insert AFTER INSERT ON "AssetTag"
  REFERENCING NEW TABLE AS changed_tags FOR EACH STATEMENT EXECUTE FUNCTION bump_asset_tag_cache_version();
CREATE TRIGGER asset_tag_cache_update AFTER UPDATE ON "AssetTag"
  REFERENCING NEW TABLE AS changed_tags FOR EACH STATEMENT EXECUTE FUNCTION bump_asset_tag_cache_version();
CREATE TRIGGER asset_tag_cache_delete AFTER DELETE ON "AssetTag"
  REFERENCING OLD TABLE AS changed_tags FOR EACH STATEMENT EXECUTE FUNCTION bump_asset_tag_cache_version();
