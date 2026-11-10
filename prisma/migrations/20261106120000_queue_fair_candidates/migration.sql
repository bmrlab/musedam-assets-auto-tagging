-- Indexed per-lane/per-team probes prevent a large team's backlog hiding other teams.
CREATE INDEX "TaggingQueueItem_pending_lane_team_age_idx" ON "TaggingQueueItem"
((CASE WHEN "extra"->>'jobKind' = 'tag-tree-generation' THEN 'tree'
  WHEN "taskType" = 'test' THEN 'test' ELSE 'production' END), "teamId", "createdAt", "id")
WHERE "status" = 'pending';
-- Used once per team in a batch status poll, rather than sorting its entire completed history.
CREATE INDEX "TaggingQueueItem_completed_team_endsAt_idx" ON "TaggingQueueItem" ("teamId", "endsAt" DESC)
WHERE "status" = 'completed' AND "assetObjectId" IS NOT NULL AND "startsAt" IS NOT NULL AND "endsAt" IS NOT NULL;
