// @vitest-environment node
// Runs only against an explicitly supplied disposable local database, never DATABASE_URL.
import { applyTagConfigImportChunk } from "@/lib/tagging/import-tag-config";
import {
  assertTagImportOwnership,
  runTagImportExclusive,
  TagImportBusyError,
} from "@/lib/tagging/tag-import-lock";
import { importTagTreeSynchronously } from "@/musedam/tags/importTagTree";
import type { PrismaClient } from "@/prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  client: undefined as PrismaClient | undefined,
  request: vi.fn(),
}));
const testUrl = process.env.TAG_IMPORT_TEST_DATABASE_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.startsWith("/tag_import_test_")
  )
    throw new Error(
      "TAG_IMPORT_TEST_DATABASE_URL must point to a disposable local tag_import_test_* database",
    );
}
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", async () => {
  const { PrismaClient } = await import("@/prisma/client");
  const url = process.env.TAG_IMPORT_TEST_DATABASE_URL;
  state.client = url ? new PrismaClient({ datasources: { db: { url } } }) : undefined;
  return { default: state.client ?? {} };
});
vi.mock("@/musedam/apiKey", () => ({
  retrieveTeamCredentials: async () => ({ apiKey: "local-test-only" }),
}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: state.request }));
const db = () => state.client!;
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe.skipIf(!testUrl)("real PostgreSQL tag import regression", () => {
  beforeAll(async () => {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS "User" ("id" serial PRIMARY KEY, "name" text NOT NULL DEFAULT '', "slug" text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now())`,
      `CREATE TABLE IF NOT EXISTS "TeamConfig" ("id" serial PRIMARY KEY, "teamId" int NOT NULL, "key" varchar(255) NOT NULL, "value" jsonb NOT NULL DEFAULT '{}', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), UNIQUE("teamId", "key"))`,
      `CREATE TABLE IF NOT EXISTS "AssetTag" ("id" serial PRIMARY KEY, "teamId" int NOT NULL, "name" varchar(100) NOT NULL, "slug" varchar(64), "level" int NOT NULL DEFAULT 1, "parentId" int, "sort" int NOT NULL DEFAULT 0, "deletedAt" timestamptz, "taggingEnabled" boolean NOT NULL DEFAULT true, "extra" jsonb NOT NULL DEFAULT '{}', "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now())`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "test_root_name" ON "AssetTag" ("teamId", "name") WHERE "parentId" IS NULL AND "deletedAt" IS NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "test_sibling_name" ON "AssetTag" ("teamId", "parentId", "name") WHERE "deletedAt" IS NULL`,
    ])
      await db().$executeRawUnsafe(sql);
  });
  beforeEach(async () => {
    await db().$executeRawUnsafe(
      'TRUNCATE TABLE "AssetTag", "TeamConfig", "User" RESTART IDENTITY',
    );
    vi.clearAllMocks();
    state.request.mockImplementation(async (_path, { body }) => {
      let next = BigInt("9007199254740993");
      const nodes: unknown[] = [];
      const walk = (
        items: Array<{ clientId: string; name: string; children: typeof items }>,
        parentId = "0",
      ) => {
        for (const node of items) {
          const id = String(next++);
          nodes.push({
            clientId: node.clientId,
            id,
            parentId,
            name: node.name,
            sort: 0,
            created: true,
          });
          walk(node.children, id);
        }
      };
      walk(body.tags);
      return {
        requestId: body.requestId,
        mode: body.mode,
        createdCount: nodes.length,
        reusedCount: 0,
        nodes,
      };
    });
  });
  afterAll(async () => {
    await state.client?.$disconnect();
  });

  it("executes the production advisory-lock SQL and merges configuration with a committed version", async () => {
    const row = await db().assetTag.create({
      data: { teamId: 7, name: "Old", extra: { keywords: ["keep"], evidencePolicy: "literal" } },
    });
    await db().$transaction((tx) =>
      applyTagConfigImportChunk(tx, 7, [
        { tag: { id: row.id }, record: { fields: { description: "Updated" } }, data: {} },
      ]),
    );
    expect((await db().assetTag.findUniqueOrThrow({ where: { id: row.id } })).extra).toEqual({
      keywords: ["keep"],
      evidencePolicy: "literal",
      description: "Updated",
      configurationSource: "import",
    });
    expect(
      (
        await db().teamConfig.findUniqueOrThrow({
          where: { teamId_key: { teamId: 7, key: "tagging-config-version" } },
        })
      ).value,
    ).toEqual({ version: 1 });
  });

  it("keeps the owner-specific busy response nonblocking while the owner holds the lease row for writing", async () => {
    const a = await db().user.create({ data: { name: "张三", slug: "u/1" } });
    const b = await db().user.create({ data: { name: "李四", slug: "u/2" } });
    const started = gate(),
      finish = gate();
    const first = runTagImportExclusive(7, a.id, () =>
      db().$transaction(async (tx) => {
        await assertTagImportOwnership(tx);
        started.resolve();
        await finish.promise;
      }),
    );
    await started.promise;
    try {
      const result = await runTagImportExclusive(7, b.id, async () => {}).catch((error) => error);
      expect(result).toBeInstanceOf(TagImportBusyError);
      expect((result as TagImportBusyError).memberName).toBe("张三");
    } finally {
      finish.resolve();
      await first;
    }
  });

  it("rolls back local deletion on an insert error, then restores from the same remote overwrite receipt", async () => {
    await db().assetTag.create({
      data: { teamId: 7, name: "Old", extra: { description: "must survive" } },
    });
    await db().$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION reject_tag_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."name" = 'New' THEN RAISE EXCEPTION 'injected insert failure'; END IF; RETURN NEW; END $$`,
    );
    await db().$executeRawUnsafe(
      `CREATE TRIGGER reject_tag_insert BEFORE INSERT ON "AssetTag" FOR EACH ROW EXECUTE FUNCTION reject_tag_insert()`,
    );
    const team = { id: 7, slug: "t/123" };
    try {
      await expect(
        importTagTreeSynchronously(team, [{ name: "New" }], true, "overwrite"),
      ).rejects.toThrow("injected insert failure");
      expect(
        (await db().assetTag.findMany({ where: { deletedAt: null } })).map((row) => row.name),
      ).toEqual(["Old"]);
      expect(state.request.mock.calls[0][1].body.mode).toBe("overwrite");
    } finally {
      await db().$executeRawUnsafe('DROP TRIGGER reject_tag_insert ON "AssetTag"');
      await db().$executeRawUnsafe("DROP FUNCTION reject_tag_insert()");
    }
    await importTagTreeSynchronously(team, [{ name: "New" }], true, "overwrite");
    expect(
      (await db().assetTag.findMany({ where: { deletedAt: null } })).map((row) => row.name),
    ).toEqual(["New"]);
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it("does not let an in-flight remote receipt overwrite deletion cancellation; deliberate reimport gets a new request ID", async () => {
    const team = { id: 901, slug: "t/901" };
    const original = state.request.getMockImplementation()!;
    state.request.mockImplementationOnce(async (...args) => {
      const response = await original(...args);
      await db()
        .$executeRaw`UPDATE "TeamConfig" SET "value" = jsonb_set("value", '{state}', '"cancelled"'::jsonb)
      WHERE "teamId" = ${team.id} AND "key" LIKE 'tag-tree-import:%'`;
      return response;
    });
    await expect(importTagTreeSynchronously(team, [{ name: "cancelled" }])).rejects.toThrow(
      "导入记录已变化",
    );
    expect(await db().assetTag.count({ where: { teamId: team.id } })).toBe(0);
    const oldRequestId = state.request.mock.calls.at(-1)![1].body.requestId;
    await importTagTreeSynchronously(team, [{ name: "cancelled" }]);
    expect(state.request.mock.calls.at(-1)![1].body.requestId).not.toBe(oldRequestId);
    expect(await db().assetTag.count({ where: { teamId: team.id, deletedAt: null } })).toBe(1);
  });
});
