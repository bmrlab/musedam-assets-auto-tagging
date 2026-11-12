// @vitest-environment node
import { loadFairQueueCandidates } from "@/app/(tagging)/queue-candidates";
import { getQueueWaitEstimates } from "@/app/(tagging)/queue-estimate";
import { runWithQueueExecution } from "@/lib/tagging/queue-execution";
import prisma from "@/prisma/prisma";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const url = process.env.TAG_QUEUE_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    u.hostname !== "127.0.0.1" ||
    !u.pathname.startsWith("/tag_import_test_") ||
    process.env.DATABASE_URL !== url
  )
    throw Error("Isolated local test database required");
}
describe.skipIf(!url)("real PostgreSQL fair queue, batched estimates and execution fencing", () => {
  let teams: number[], assetId: number, otherAssetId: number;
  beforeAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Team" RESTART IDENTITY CASCADE');
    teams = (
      await prisma.team.createManyAndReturn({
        data: Array.from({ length: 205 }, (_, i) => ({ slug: `queue-test-${i}` })),
        select: { id: true },
      })
    )
      .map((t) => t.id)
      .sort((a, b) => a - b);
    const createAsset = (teamId: number, slug: string) =>
      prisma.assetObject.create({
        data: { teamId, slug, name: slug, description: "", materializedPath: "" },
      });
    assetId = (await createAsset(teams[0], "a")).id;
    otherAssetId = (await createAsset(teams[1], "b")).id;
    await prisma.taggingQueueItem.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({
        teamId: teams[0],
        assetObjectId: assetId,
        status: "pending" as const,
        taskType: "manual" as const,
        createdAt: new Date(1700000000000 + i),
      })),
    });
    await prisma.taggingQueueItem.createMany({
      data: teams
        .slice(1)
        .map((teamId) => ({
          teamId,
          assetObjectId: otherAssetId,
          status: "pending" as const,
          taskType: "manual" as const,
        })),
    });
    await prisma.taggingQueueItem.create({
      data: {
        teamId: teams[1],
        status: "pending",
        taskType: "manual",
        extra: { jobKind: "tag-tree-generation" },
      },
    });
    await prisma.$executeRaw`INSERT INTO "TaggingQueueItem" ("teamId","assetObjectId",status,"taskType","startsAt","endsAt",extra,"updatedAt")
   SELECT ${teams[0]},${assetId},'completed','manual',now()-i*interval '1 second',now()-(i-1)*interval '1 second','{"processingTimingVersion":2}'::jsonb,now() FROM generate_series(1,100000)i`;
    await prisma.$executeRawUnsafe('ANALYZE "TaggingQueueItem"');
  }, 60000);
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it("admits small teams and trees independently of the 1000-job backlog", async () => {
    const old = await prisma.taggingQueueItem.findMany({
      where: { status: "pending", taskType: { not: "test" } },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { teamId: true },
    });
    expect(old.every((r) => r.teamId === teams[0])).toBe(true);
    const candidates = await loadFairQueueCandidates("production", 0, 5);
    expect(candidates).toHaveLength(200);
    expect(candidates.some((r) => r.teamId === teams[1])).toBe(true);
    expect((await loadFairQueueCandidates("tree", 0, 1)).map((r) => r.teamId)).toEqual([teams[1]]);
    const rotated = await loadFairQueueCandidates("production", teams[199], 5);
    expect(rotated.some((r) => r.teamId === teams[204])).toBe(true);
    console.log("FAIR_CANDIDATES", {
      largeTeamBacklog: 1000,
      candidateCount: candidates.length,
      smallTeamAdmitted: true,
      treeAdmitted: true,
      rotation: true,
    });
  });
  it("uses the expression index for hot per-team lane probes", async () => {
    const plan =
      await prisma.$queryRawUnsafe(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM "TaggingQueueItem" WHERE status='pending' AND "teamId"=${teams[0]}
   AND (CASE WHEN extra->>'jobKind'='tag-tree-generation' THEN 'tree' WHEN "taskType"='test' THEN 'test' ELSE 'production' END)='production' ORDER BY "createdAt",id LIMIT 5`);
    expect(JSON.stringify(plan)).toContain("TaggingQueueItem_pending_lane_team_age_idx");
    console.log("FAIR_PROBE_PLAN", JSON.stringify(plan));
  });
  it("admits image and thumbnail-only jobs behind videos waiting for a frame slot", async () => {
    const team = await prisma.team.create({ data: { slug: "queue-video-deferral" } });
    const createAsset = (slug: string, extension: string) =>
      prisma.assetObject.create({
        data: { teamId: team.id, slug, name: slug, description: "", materializedPath: "", extra: { extension } },
      });
    const video = await createAsset("video", ".MP4");
    const image = await createAsset("image", "jpg");
    const pending = { teamId: team.id, status: "pending", taskType: "test" } as const;
    await prisma.taggingQueueItem.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        ...pending,
        assetObjectId: video.id,
        extra: { featureClassify: true },
        createdAt: new Date(1700000000000 + index),
      })),
    });
    const thumbnailOnly = await prisma.taggingQueueItem.create({
      data: {
        ...pending,
        assetObjectId: video.id,
        extra: { featureClassify: true, featureBrand: false, featureProduct: false, featureIp: false },
        createdAt: new Date(1700000000100),
      },
    });
    const imageJob = await prisma.taggingQueueItem.create({
      data: {
        ...pending,
        assetObjectId: image.id,
        extra: { featureClassify: true },
        createdAt: new Date(1700000000200),
      },
    });
    const candidates = await loadFairQueueCandidates("test", 0, 2, 200, true);
    expect(candidates.filter((item) => item.teamId === team.id).map((item) => item.id))
      .toEqual([thumbnailOnly.id, imageJob.id]);
  });
  it("estimates pending rank consistently for equal timestamps and shares history", async () => {
    const rows = await prisma.taggingQueueItem.findMany({
      where: { teamId: teams[0], status: "pending" },
      orderBy: { id: "asc" },
      take: 3,
    });
    const estimates = await getQueueWaitEstimates(teams[0], rows);
    expect(rows.map((row) => estimates.get(row.id)!.aheadCount)).toEqual([0, 1, 2]);
    expect(estimates.get(rows[0].id)!.avgProcessingSeconds).toBe(21);
  });
  it("rejects a late attempt and aborts before starting a new database write", async () => {
    const row = await prisma.taggingQueueItem.create({
      data: { teamId: teams[0], status: "processing", extra: { executionAttempt: "new" } },
    });
    const controller = new AbortController();
    const context = {
      queueItemId: row.id,
      attempt: "old",
      signal: controller.signal,
      assertOwned: async () => {},
    };
    await expect(
      runWithQueueExecution(context, () =>
        prisma.taggingQueueItem.update({ where: { id: row.id }, data: { status: "completed" } }),
      ),
    ).rejects.toThrow();
    expect(
      (await prisma.taggingQueueItem.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe("processing");
    controller.abort(Error("cancelled"));
    await expect(
      runWithQueueExecution(context, () =>
        prisma.teamConfig.create({ data: { teamId: teams[0], key: "late-write", value: {} } }),
      ),
    ).rejects.toThrow("cancelled");
    expect(await prisma.teamConfig.count({ where: { teamId: teams[0], key: "late-write" } })).toBe(
      0,
    );
  });
});
