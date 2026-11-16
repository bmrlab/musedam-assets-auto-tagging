// @vitest-environment node
import { queryIpVectorPoints } from "@/lib/ip/pgvector";
import { queryProductVectorPoints } from "@/lib/product/pgvector";
import type { PrismaClient } from "@/prisma/client";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined }));
const testUrl = process.env.REFERENCE_MATCH_TEST_DATABASE_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.startsWith("/reference_match_test_")
  ) {
    throw new Error(
      "REFERENCE_MATCH_TEST_DATABASE_URL must point to a disposable local reference_match_test_* database",
    );
  }
}
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", async () => {
  const { PrismaClient } = await import("@/prisma/client");
  state.client = process.env.REFERENCE_MATCH_TEST_DATABASE_URL
    ? new PrismaClient({
        datasources: { db: { url: process.env.REFERENCE_MATCH_TEST_DATABASE_URL } },
      })
    : undefined;
  return { default: state.client ?? {} };
});
const db = () => state.client!;
const uuid = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

// The test owns these minimal fixture tables in an explicitly named disposable database.
describe.skipIf(!testUrl)("product/IP reference aggregation on PostgreSQL", () => {
  beforeAll(async () => {
    // The database must have pgvector installed, matching production's cosine operator.
    for (const name of ["Product", "Ip"]) {
      await db().$executeRawUnsafe(`CREATE TABLE "Asset${name}" (
        "id" uuid PRIMARY KEY, "teamId" int NOT NULL, "enabled" boolean DEFAULT true, "status" text DEFAULT 'completed')`);
      await db().$executeRawUnsafe(`CREATE TABLE "${name}Vector" (
        "id" text PRIMARY KEY, "asset${name}Id" uuid, "asset${name}ImageId" uuid,
        "teamId" int, "enabled" boolean DEFAULT true, "status" text DEFAULT 'completed',
        "sourceType" text, "embedding" vector(2),
        "productTypeId" uuid, "generalCategory" text DEFAULT 'object',
        "ipTypeId" uuid, "matchPattern" text DEFAULT 'partial', "partialMatchPatternName" text DEFAULT 'face')`);
    }
    for (const name of ["Product", "Ip"]) {
      await db().$executeRawUnsafe(
        `INSERT INTO "Asset${name}" ("id", "teamId") VALUES ($1::uuid, 7)`,
        uuid(99),
      );
    }
    const migration = await readFile(
      "prisma/migrations/20261116090000_product_ip_reference_match_strategy/migration.sql",
      "utf8",
    );
    for (const statement of migration.split(";").filter((part) => part.trim())) {
      await db().$executeRawUnsafe(statement);
    }
    for (const name of ["Product", "Ip"]) {
      const rows = await db().$queryRawUnsafe<Array<{ referenceMatchStrategy: string }>>(
        `SELECT "referenceMatchStrategy" FROM "Asset${name}" WHERE "id" = $1::uuid`,
        uuid(99),
      );
      expect(rows[0].referenceMatchStrategy).toBe("highest");
    }
  });
  afterAll(async () => {
    await state.client?.$disconnect();
  });

  describe.each([
    {
      name: "Product",
      key: "assetProductId",
      imageKey: "assetProductImageId",
      query: queryProductVectorPoints,
    },
    { name: "Ip", key: "assetIpId", imageKey: "assetIpImageId", query: queryIpVectorPoints },
  ])("$name", ({ name, key, imageKey, query }) => {
    beforeEach(async () => {
      await db().$executeRawUnsafe(
        `TRUNCATE "ProductVector", "IpVector", "AssetProduct", "AssetIp"`,
      );
    });
    async function identity(
      id: number,
      strategy?: "highest" | "average",
      teamId = 7,
      enabled = true,
    ) {
      await db().$executeRawUnsafe(
        `INSERT INTO "Asset${name}" ("id", "teamId", "enabled") VALUES ($1::uuid, $2, $3)`,
        uuid(id),
        teamId,
        enabled,
      );
      if (strategy)
        await db().$executeRawUnsafe(
          `UPDATE "Asset${name}" SET "referenceMatchStrategy" = $2::"AssetReferenceMatchStrategy" WHERE "id" = $1::uuid`,
          uuid(id),
          strategy,
        );
    }
    async function reference(
      id: number,
      owner: number,
      score: number,
      source = "image",
      enabled = true,
      teamId = 7,
      status = "completed",
    ) {
      const vector = `[${score},${Math.sqrt(1 - score * score)}]`;
      await db().$executeRawUnsafe(
        `INSERT INTO "${name}Vector"
        ("id", "${key}", "${imageKey}", "teamId", "sourceType", "embedding", "enabled", "status")
        VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6::vector, $7, $8)`,
        String(id),
        uuid(owner),
        uuid(id),
        teamId,
        source,
        vector,
        enabled,
        status,
      );
    }
    const search = async (options = {}) =>
      (await query({ teamId: 7, vector: [1, 0], limit: 2, sourceType: "image", ...options })).map(
        (point) => ({
          ...point,
          payload: point.payload as Record<string, unknown>,
        }),
      );

    it("defaults existing/new entries to highest and gives each identity one candidate slot", async () => {
      await identity(1);
      await identity(2);
      for (let i = 10; i < 40; i++) await reference(i, 1, 0.95);
      await reference(40, 1, 0.2);
      await reference(50, 2, 0.8);
      const result = await search();
      expect(result.map((r) => r.payload?.[key])).toEqual([uuid(1), uuid(2)]);
      expect(result[0].score).toBeCloseTo(0.95);
      expect(result[0].payload?.referenceMatchStrategy).toBe("highest");
    });

    it("averages the whole reference set before applying the score threshold", async () => {
      await identity(1, "average");
      await identity(2, "highest");
      await reference(10, 1, 0.95);
      await reference(11, 1, -0.75);
      await reference(20, 2, 0.7);
      const all = await search();
      expect(all.map((r) => r.payload?.[key])).toEqual([uuid(2), uuid(1)]);
      expect(all[1].score).toBeCloseTo(0.1);
      expect(all[1].payload?.[imageKey]).toBe(uuid(10));
      const filtered = await search({ scoreThreshold: 0.5 });
      expect(filtered.map((r) => r.payload?.[key])).toEqual([uuid(2)]);
    });

    it("keeps text scores separate and uses the best description regardless of image strategy", async () => {
      await identity(1, "average");
      await reference(10, 1, 0.9);
      await reference(11, 1, 0.1);
      await reference(12, 1, 0.85, "description");
      await reference(13, 1, 0.65, "description");
      expect((await search())[0].score).toBeCloseTo(0.5);
      const text = await search({ sourceType: "description" });
      expect(text[0].score).toBeCloseTo(0.85);
      expect(text[0].payload?.sourceType).toBe("description");
    });

    it("excludes disabled, unfinished, orphaned and other-team references before averaging", async () => {
      await identity(1, "average");
      await identity(2, "highest", 8);
      await identity(3, "highest", 7, false);
      await reference(10, 1, 0.6);
      await reference(11, 1, -0.9, "image", false);
      await reference(12, 1, -0.9, "image", true, 7, "pending");
      await reference(13, 1, -0.9, "image", true, 8);
      await reference(20, 2, 0.99);
      await reference(30, 3, 0.99);
      await reference(40, 4, 0.99);
      const result = await search();
      expect(result).toHaveLength(1);
      expect(result[0].payload?.[key]).toBe(uuid(1));
      expect(result[0].score).toBeCloseTo(0.6);
    });

    it("returns the best IP partial-reference metadata even when the score is averaged", async () => {
      await identity(1, "average");
      await reference(10, 1, 0.8);
      await reference(11, 1, 0.4);
      const [result] = await search();
      expect(result.score).toBeCloseTo(0.6);
      expect(result.payload?.[imageKey]).toBe(uuid(10));
      if (name === "Ip")
        expect(result.payload).toMatchObject({
          matchPattern: "partial",
          partialMatchPatternName: "face",
        });
    });
  });
});
