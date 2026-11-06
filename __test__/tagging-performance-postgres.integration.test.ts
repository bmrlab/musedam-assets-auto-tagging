// @vitest-environment node
// Opt in only with a disposable, fully migrated local database.
import { buildTagDeletionPlan } from "@/app/tags/delete-tag-plan";
import { createMissingBatchImportTagTrees } from "@/lib/tagging/batch-import-tags";
import { softDeleteTagSubtree } from "@/lib/tagging/soft-delete-tags";
import { PrismaClient } from "@/prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined, queries: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", async () => {
  const { PrismaClient } = await import("@/prisma/client");
  const url = process.env.TAG_PERF_TEST_DATABASE_URL;
  if (url) {
    const u = new URL(url);
    if (u.hostname !== "127.0.0.1" || !u.pathname.startsWith("/tag_import_test_"))
      throw new Error("Disposable local test DB required");
    const client = new PrismaClient({
      datasources: { db: { url } },
      log: [{ emit: "event", level: "query" }],
    });
    client.$on("query", () => state.queries++);
    state.client = client;
  }
  return { default: state.client ?? {} };
});
const db = () => state.client!;
const report: Record<string, unknown> = {};
describe.skipIf(!process.env.TAG_PERF_TEST_DATABASE_URL)(
  "tagging real PostgreSQL performance and tombstones",
  () => {
    let teamId: number, otherTeamId: number;
    beforeAll(async () => {
      await db().$executeRawUnsafe('TRUNCATE TABLE "Team" RESTART IDENTITY CASCADE');
      teamId = (await db().team.create({ data: { slug: `perf-${Date.now()}` } })).id;
      otherTeamId = (await db().team.create({ data: { slug: `perf-other-${Date.now()}` } })).id;
    });
    afterAll(async () => {
      console.log("PERFORMANCE_REPORT", JSON.stringify(report));
      await db().$disconnect();
    });
    it("preserves history, excludes a whole subtree, permits same-name recreation and isolates teams", async () => {
      const root = await db().assetTag.create({ data: { teamId, name: "history" } });
      const child = await db().assetTag.create({
        data: { teamId, parentId: root.id, name: "child", level: 2 },
      });
      const logo = await db().assetLogo.create({
        data: { teamId, name: "history-logo", logoTypeName: "type" },
      });
      const ip = await db().assetIp.create({
        data: { teamId, name: "history-ip", ipTypeName: "type" },
      });
      const product = await db().assetProduct.create({
        data: { teamId, name: "history-product", productTypeName: "type" },
      });
      const person = await db().assetPerson.create({
        data: { teamId, name: "history-person", personTypeName: "type" },
      });
      await db().assetLogoTag.create({ data: { assetLogoId: logo.id, assetTagId: child.id } });
      await db().assetIpTag.create({ data: { assetIpId: ip.id, assetTagId: child.id } });
      await db().assetProductTag.create({
        data: { assetProductId: product.id, assetTagId: child.id },
      });
      await db().assetPersonTag.create({
        data: { assetPersonId: person.id, assetTagId: child.id },
      });
      const other = await db().assetTag.create({ data: { teamId: otherTeamId, name: "history" } });
      const audit = await db().taggingAuditItem.create({
        data: {
          teamId,
          leafTagId: child.id,
          status: "approved",
          score: 99,
          tagPath: ["history", "child"],
        },
      });
      const version = () =>
        db().teamConfig.findUniqueOrThrow({
          where: { teamId_key: { teamId, key: "tagging-config-version" } },
        });
      const before = await version();
      await db().$transaction((tx) => softDeleteTagSubtree(tx, teamId, root.id));
      expect(await db().assetTag.count({ where: { teamId, deletedAt: null } })).toBe(0);
      expect(
        (await db().taggingAuditItem.findUniqueOrThrow({ where: { id: audit.id } })).leafTagId,
      ).toBe(child.id);
      expect((await db().assetTag.findUniqueOrThrow({ where: { id: child.id } })).parentId).toBe(
        root.id,
      );
      expect(
        (await db().assetTag.findUniqueOrThrow({ where: { id: other.id } })).deletedAt,
      ).toBeNull();
      expect((await version()).value).not.toEqual(before.value);
      expect(
        await Promise.all([
          db().assetLogoTag.count({ where: { assetTagId: child.id } }),
          db().assetIpTag.count({ where: { assetTagId: child.id } }),
          db().assetProductTag.count({ where: { assetTagId: child.id } }),
          db().assetPersonTag.count({ where: { assetTagId: child.id } }),
        ]),
      ).toEqual([1, 1, 1, 1]);
      const versionBeforeRollback = await version();
      await db()
        .$transaction(async (tx) => {
          await tx.assetTag.create({ data: { teamId, name: "rollback-cache" } });
          throw new Error("rollback cache version");
        })
        .catch((e) => {
          if (!String(e).includes("rollback cache version")) throw e;
        });
      expect((await version()).value).toEqual(versionBeforeRollback.value);
      const replacement = await db().assetTag.create({ data: { teamId, name: "history" } });
      expect(replacement.id).not.toBe(root.id);
      await expect(db().assetTag.create({ data: { teamId, name: "history" } })).rejects.toThrow();
    });
    it("compares batched shared-prefix creation with the old per-path loop", async () => {
      const paths = Array.from(
        { length: 1000 },
        (_, i) => `r${i % 10} > g${i % 100} > p${i % 500} > sku${i}`,
      );
      const oldCreate = async () => {
        for (const path of paths) {
          let parentId: number | null = null;
          for (const [i, name] of path.split(" > ").entries()) {
            let row: { id: number } | null = await db().assetTag.findFirst({
              where: { teamId, parentId, name: { equals: name, mode: "insensitive" } },
              select: { id: true },
            });
            row ??= await db().assetTag.create({
              data: { teamId, parentId, name, level: i + 1 },
              select: { id: true },
            });
            parentId = row.id;
          }
        }
      };
      state.queries = 0;
      let started = performance.now();
      await oldCreate();
      report.createBefore = { ms: performance.now() - started, queries: state.queries };
      await db().assetTag.deleteMany({ where: { teamId, name: { not: "history" } } });
      state.queries = 0;
      started = performance.now();
      await createMissingBatchImportTagTrees({ teamId, tagPaths: paths });
      report.createAfter = { ms: performance.now() - started, queries: state.queries };
      expect(await db().assetTag.count({ where: { teamId, deletedAt: null } })).toBe(1611);
    }, 60_000);
    it("measures global queue poll plans on 200k rows with 1% pending", async () => {
      await db().$executeRawUnsafe('TRUNCATE TABLE "TaggingQueueItem", "TaggingAuditItem"');
      await db()
        .$executeRaw`INSERT INTO "TaggingQueueItem" ("teamId", "status", "taskType", "createdAt", "updatedAt")
      SELECT ${teamId}, CASE WHEN i % 100 = 0 THEN 'pending' ELSE 'completed' END::"TaggingQueueStatus",
      CASE WHEN i % 300 = 0 THEN 'test' ELSE 'default' END::"TaggingTaskType", now() - i * interval '1 second', now() FROM generate_series(1,200000) i`;
      await db().$executeRawUnsafe('ANALYZE "TaggingQueueItem"');
      const query = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "TaggingQueueItem" WHERE status = 'pending' AND "taskType" <> 'test' ORDER BY "createdAt" ASC LIMIT 200`;
      await db()
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe('DROP INDEX "TaggingQueueItem_pending_createdAt_idx"');
          report.queueBefore = await tx.$queryRawUnsafe(query);
          throw new Error("rollback benchmark index removal");
        })
        .catch((e) => {
          if (!String(e).includes("rollback benchmark")) throw e;
        });
      report.queueAfter = await db().$queryRawUnsafe(query);
    }, 60_000);
    it("compares physical and soft subtree deletion with 1000 historical audit links", async () => {
      const root = await db().assetTag.create({ data: { teamId, name: "delete-benchmark" } });
      const children = await db().assetTag.createManyAndReturn({
        data: Array.from({ length: 1000 }, (_, i) => ({
          teamId,
          parentId: root.id,
          name: `delete-${i}`,
          level: 2,
        })),
      });
      await db().taggingAuditItem.createMany({
        data: children.map((child) => ({
          teamId,
          leafTagId: child.id,
          status: "approved" as const,
          score: 90,
        })),
      });
      const ids = [root.id, ...children.map((child) => child.id)];
      const benchmark = async (soft: boolean) => {
        let ms = 0;
        await db()
          .$transaction(
            async (tx) => {
              const started = performance.now();
              if (soft) await softDeleteTagSubtree(tx, teamId, root.id);
              else await tx.assetTag.deleteMany({ where: { teamId, id: { in: ids } } });
              ms = performance.now() - started;
              throw new Error("rollback delete benchmark");
            },
            { timeout: 60000 },
          )
          .catch((e) => {
            if (!String(e).includes("rollback delete benchmark")) throw e;
          });
        return ms;
      };
      report.deleteBeforeMs = await benchmark(false);
      report.deleteAfterMs = await benchmark(true);
      expect(await db().taggingAuditItem.count({ where: { teamId, leafTagId: { in: ids } } })).toBe(
        1000,
      );
    }, 60_000);
    it("compares subtree planning at 20k nodes", () => {
      const rows = Array.from({ length: 20000 }, (_, i) => ({
        id: i + 1,
        name: String(i),
        slug: null,
        sort: 0,
        level: i ? 2 : 1,
        parentId: i ? 1 : null,
      }));
      let started = performance.now();
      const oldCollect = (id: number): number =>
        rows.filter((row) => row.parentId === id).reduce((n, row) => n + 1 + oldCollect(row.id), 0);
      expect(oldCollect(1)).toBe(19999);
      report.planBeforeMs = performance.now() - started;
      started = performance.now();
      expect(buildTagDeletionPlan(rows, 1).descendants.length).toBe(19999);
      report.planAfterMs = performance.now() - started;
    });
  },
);
