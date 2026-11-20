// @vitest-environment node
import { submitTagImportJob } from "@/app/tags/tagImportJobs";
import type { PrismaClient } from "@/prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined }));
const url = process.env.TAG_IMPORT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    !parsed.pathname.startsWith("/tag_import_test_")
  )
    throw new Error("Only disposable local tag_import_test_* databases are allowed");
}
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", async () => {
  const { PrismaClient } = await import("@/prisma/client");
  state.client = process.env.TAG_IMPORT_TEST_DATABASE_URL
    ? new PrismaClient({ datasources: { db: { url: process.env.TAG_IMPORT_TEST_DATABASE_URL } } })
    : undefined;
  return { default: state.client ?? {} };
});
vi.mock("@/app/tags/tagBatchActions", () => ({
  importTagTreeAction: vi.fn(),
  precheckTagTreeImportAction: vi.fn(),
}));
const options = { mode: "overwrite" as const, level: 4 as const, locale: "zh-CN", skipRows: [5] };
const uploadId = "70c372cf-6b55-41a4-a333-bf855780cf25";
describe.skipIf(!url)("persistent import submission on real PostgreSQL", () => {
  beforeAll(async () => {
    for (const sql of [
      `DO $$ BEGIN CREATE TYPE "TaggingQueueStatus" AS ENUM ('pending', 'processing', 'completed', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `DO $$ BEGIN CREATE TYPE "TaggingTaskType" AS ENUM ('default', 'test', 'manual', 'scheduled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      `CREATE TABLE IF NOT EXISTS "TeamConfig" ("id" serial PRIMARY KEY, "teamId" int NOT NULL, "key" varchar(255) NOT NULL, "value" jsonb NOT NULL DEFAULT '{}', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), UNIQUE("teamId", "key"))`,
      `CREATE TABLE IF NOT EXISTS "TaggingQueueItem" ("id" serial PRIMARY KEY, "teamId" int NOT NULL, "assetObjectId" int, "status" "TaggingQueueStatus" NOT NULL, "taskType" "TaggingTaskType" NOT NULL DEFAULT 'default', "startsAt" timestamptz, "endsAt" timestamptz, "result" jsonb NOT NULL DEFAULT '{}', "extra" jsonb NOT NULL DEFAULT '{}', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now())`,
    ])
      await state.client!.$executeRawUnsafe(sql);
  });
  beforeEach(async () => {
    await state.client!.$executeRawUnsafe(
      'TRUNCATE "TeamConfig", "TaggingQueueItem" RESTART IDENTITY',
    );
    await state.client!.teamConfig.create({
      data: {
        teamId: 7,
        key: `tag-import-upload:${uploadId}`,
        value: {
          uploadId,
          userId: 9,
          objectKey: "tag-imports/7/test.csv",
          filename: "tags.csv",
          size: 5,
          sha256: "a".repeat(64),
          expiresAt: Date.now() + 60_000,
        },
      },
    });
  });
  afterAll(async () => {
    await state.client?.$disconnect();
  });
  it("creates exactly one task under concurrent identical submissions", async () => {
    const ids = await Promise.all(
      Array.from({ length: 20 }, () => submitTagImportJob(7, 9, uploadId, options)),
    );
    expect(new Set(ids).size).toBe(1);
    expect(await state.client!.taggingQueueItem.count()).toBe(1);
    const row = await state.client!.taggingQueueItem.findFirstOrThrow();
    expect(row.assetObjectId).toBeNull();
    expect(row.extra).toEqual({ jobKind: "tag-tree-import", uploadId, userId: 9 });
    await expect(submitTagImportJob(7, 9, uploadId, { ...options, mode: "merge" })).rejects.toThrow(
      "different options",
    );
    await expect(submitTagImportJob(7, 9, uploadId, { ...options, skipRows: [6] })).rejects.toThrow(
      "different options",
    );
  });
  it("does not accept another user or team and cannot create a job without an upload", async () => {
    await expect(submitTagImportJob(7, 10, uploadId, options)).rejects.toThrow("not found");
    await expect(submitTagImportJob(8, 9, uploadId, options)).rejects.toThrow("not found");
    expect(await state.client!.taggingQueueItem.count()).toBe(0);
  });
});
