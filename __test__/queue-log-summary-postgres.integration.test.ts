// @vitest-environment node
import { getPendingQueueLogSummary } from "@/app/(tagging)/queue-log-summary";
import { VIDEO_EXTENSIONS } from "@/lib/feature-library";
import { PrismaClient, type Prisma } from "@/prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ tx: undefined as Prisma.TransactionClient | undefined }));
vi.mock("@/prisma/prisma", () => ({
  default: {
    $queryRaw: (...args: Parameters<Prisma.TransactionClient["$queryRaw"]>) => {
      if (!state.tx) throw new Error("Summary query must run inside the isolated test transaction");
      return state.tx.$queryRaw(...args);
    },
  },
}));

// Explicit opt-in. Only session-local temporary tables are populated, even on a remote test DB.
const testUrl = process.env.QUEUE_LOG_TEST_DATABASE_URL;
describe.skipIf(!testUrl)("pending log summary on PostgreSQL temporary tables", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ datasources: { db: { url: testUrl } } });
  });
  afterAll(async () => {
    await client?.$disconnect();
  });

  async function isolated(check: (tx: Prisma.TransactionClient) => Promise<void>) {
    const rollback = new Error("Rollback temporary fixtures");
    try {
      await client.$transaction(
        async (tx) => {
          state.tx = tx;
          // Exclude public entirely: missing fixture tables must never resolve to existing tables.
          await tx.$executeRaw`SET LOCAL search_path = pg_temp`;
          await tx.$executeRaw`CREATE TEMP TABLE "Team" (id int PRIMARY KEY, slug text) ON COMMIT DROP`;
          await tx.$executeRaw`CREATE TEMP TABLE "AssetObject" (id int PRIMARY KEY, name text, extra jsonb) ON COMMIT DROP`;
          await tx.$executeRaw`CREATE TEMP TABLE "TeamConfig" ("teamId" int, key text, value jsonb, UNIQUE ("teamId", key)) ON COMMIT DROP`;
          await tx.$executeRaw`CREATE TEMP TABLE "TaggingQueueItem" ("teamId" int, "assetObjectId" int, status text, extra jsonb) ON COMMIT DROP`;
          await check(tx);
          throw rollback;
        },
        { maxWait: 15_000, timeout: 30_000 },
      );
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      state.tx = undefined;
    }
  }

  it("returns zero counts for an empty queue", async () => {
    await isolated(async () => {
      expect(await getPendingQueueLogSummary()).toEqual({
        pendingTotal: 0,
        teamCount: 0,
        imageCount: 0,
        videoCount: 0,
        otherCount: 0,
        imageModeEnabledCount: 0,
        imageModeDisabledCount: 0,
        videoImageModeEnabledCount: 0,
        videoImageModeDisabledCount: 0,
        byTeam: {},
        mediaByTeam: {},
        summary: "",
      });
    });
  }, 60_000);

  it("counts media per team, prioritizes snapshots, and resolves independent legacy defaults", async () => {
    await isolated(async (tx) => {
      await tx.$executeRaw`INSERT INTO "Team" VALUES (1,'team/a'), (2,'team/b'), (3,'team/c')`;
      await tx.$executeRaw`INSERT INTO "TeamConfig" VALUES
        (1,'featureImageMode','true'), (1,'featureVideoImageMode','false'),
        (2,'featureImageMode','false'), (2,'featureVideoImageMode','true')`;
      await tx.$executeRaw`INSERT INTO "AssetObject" VALUES
        (1,'a.jpg','{"extension":" .JPG "}'), (2,'b.PNG','{}'),
        (3,'c.jpeg','{"extension":"  "}'), (4,'d.mp4','{"extension":" .MP4 "}'),
        (5,'e.MOV','{}'), (6,'f.pdf','{"extension":"pdf"}')`;
      await tx.$executeRaw`INSERT INTO "TaggingQueueItem" VALUES
        (1,1,'pending','{"featureImageMode":false}'),
        (1,2,'pending','{}'), (1,3,'pending','{"featureImageMode":true}'),
        (1,4,'pending','{}'), (1,5,'pending','{"featureImageMode":true}'),
        (1,6,'pending','{}'), (1,NULL,'pending','{"jobKind":"tag-tree-generation"}'),
        (2,1,'pending','{"featureImageMode":true}'), (2,2,'pending','{}'),
        (2,4,'pending','{}'), (2,5,'pending','{"featureImageMode":false}'),
        (3,1,'pending','{}'), (3,2,'pending','{"featureImageMode":null}'),
        (3,4,'pending','{}'), (3,5,'pending','{"featureImageMode":"true"}'),
        (1,1,'processing','{}'), (1,4,'completed','{}'), (2,1,'failed','{}')`;
      const result = await getPendingQueueLogSummary();
      expect(result).toMatchObject({
        pendingTotal: 15,
        teamCount: 3,
        imageCount: 7,
        videoCount: 6,
        otherCount: 2,
        imageModeEnabledCount: 3,
        imageModeDisabledCount: 4,
        videoImageModeEnabledCount: 2,
        videoImageModeDisabledCount: 4,
        byTeam: { "team/a": 7, "team/b": 4, "team/c": 4 },
        mediaByTeam: {
          "team/a": {
            pendingTotal: 7,
            imageCount: 3,
            videoCount: 2,
            otherCount: 2,
            imageModeEnabledCount: 2,
            imageModeDisabledCount: 1,
            videoImageModeEnabledCount: 1,
            videoImageModeDisabledCount: 1,
          },
          "team/b": {
            pendingTotal: 4,
            imageCount: 2,
            videoCount: 2,
            otherCount: 0,
            imageModeEnabledCount: 1,
            imageModeDisabledCount: 1,
            videoImageModeEnabledCount: 1,
            videoImageModeDisabledCount: 1,
          },
          "team/c": {
            pendingTotal: 4,
            imageCount: 2,
            videoCount: 2,
            otherCount: 0,
            imageModeEnabledCount: 0,
            imageModeDisabledCount: 2,
            videoImageModeEnabledCount: 0,
            videoImageModeDisabledCount: 2,
          },
        },
      });
      expect(result.summary).toContain(
        "team/a:7个排队，图片3（图像模式开2/关1），视频2（图像模式开1/关1），其他2",
      );
    });
  }, 60_000);

  it("recognizes every supported video extension with uppercase, dots and filename fallbacks", async () => {
    await isolated(async (tx) => {
      await tx.$executeRaw`INSERT INTO "Team" VALUES (1,'team/video')`;
      // Legacy image-only switch must never enable video image mode.
      await tx.$executeRaw`INSERT INTO "TeamConfig" VALUES (1,'featureImageMode','true')`;
      const assets = [...VIDEO_EXTENSIONS].flatMap((extension, index) => [
        {
          id: index * 2 + 1,
          name: "asset.bin",
          extra: { extension: ` .${extension.toUpperCase()} ` },
        },
        { id: index * 2 + 2, name: `asset.${extension.toUpperCase()}`, extra: {} },
      ]);
      await tx.$executeRaw`INSERT INTO "AssetObject"
        SELECT id, name, extra FROM jsonb_to_recordset(${JSON.stringify(assets)}::jsonb)
          AS a(id int, name text, extra jsonb)`;
      await tx.$executeRaw`INSERT INTO "TaggingQueueItem"
        SELECT 1, id, 'pending', '{}'::jsonb FROM "AssetObject"`;
      const result = await getPendingQueueLogSummary();
      expect(result).toMatchObject({
        pendingTotal: assets.length,
        imageCount: 0,
        videoCount: assets.length,
        otherCount: 0,
        imageModeEnabledCount: 0,
        imageModeDisabledCount: 0,
        videoImageModeEnabledCount: 0,
        videoImageModeDisabledCount: assets.length,
      });
    });
  }, 60_000);
});
