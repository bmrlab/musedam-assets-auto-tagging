// @vitest-environment node
import { batchCreateTags } from "@/app/tags/actions";
import type { TagNode } from "@/app/tags/types";
import { MuseDAMID } from "@/musedam/types";
import { beforeEach, expect, it, vi } from "vitest";

type Row = {
  id: number;
  teamId: number;
  name: string;
  slug: string | null;
  parentId: number | null;
  level: number;
  deletedAt?: Date;
};
const mocks = vi.hoisted(() => {
  const rows: Row[] = [];
  const matches = (r: Row, w: Record<string, unknown>) =>
    !r.deletedAt &&
    r.teamId === w.teamId &&
    (w.parentId === undefined || r.parentId === w.parentId) &&
    (w.name === undefined || r.name === w.name) &&
    (w.id === undefined || r.id === w.id);
  const assetTag = {
    findFirst: vi.fn(async ({ where }) => rows.find((r) => matches(r, where)) ?? null),
    findMany: vi.fn(),
    create: vi.fn(async ({ data }) => {
      const row = { id: rows.length + 100, ...data };
      rows.push(row);
      return row;
    }),
  };
  const prisma = {
    assetTag,
    team: { findUniqueOrThrow: vi.fn(async () => ({ id: 1, slug: "t/1" })) },
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
      run({ assetTag, $queryRaw: vi.fn() }),
    ),
  };
  return { rows, prisma, assetTag, atomicImport: vi.fn(), sync: vi.fn(), bump: vi.fn() };
});
vi.mock("server-only", () => ({}));
vi.mock("@/musedam/tags/importTagTree", () => ({ importTagTreeSynchronously: mocks.atomicImport }));
vi.mock("@/prisma/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (run: (context: unknown) => unknown) =>
    run({ user: { id: 1 }, team: { id: 1, slug: "t/1" } }),
}));
vi.mock("@/app/tags/tagManagementAuth", async () => ({
  withTagManagementAuth: (await import("@/app/(auth)/withAuth")).withAuth,
}));
vi.mock("@/app/tags/tagMutation", async () => ({
  withTagMutation: (await import("@/app/(auth)/withAuth")).withAuth,
  ensureTagMutationRecovered: vi.fn(),
  isTagMutationActive: () => true,
}));
vi.mock("@/lib/tagging/tag-import-lock", () => ({ assertTagImportOwnership: vi.fn() }));
vi.mock("@/lib/tagging/tag-config-version", () => ({ bumpTagConfigVersion: mocks.bump }));
vi.mock("@/musedam/tags/syncToMuseDAM", () => ({
  syncTagsToMuseDAM: mocks.sync,
  syncTagsToMuseDAMWithCurrentSystemAsBase: vi.fn(),
}));
vi.mock("@/musedam/tags/syncFromMuseDAM", () => ({ syncTagsFromMuseDAM: vi.fn() }));
vi.mock("@/app/tags/generateTagTreeLLM", () => ({ executeGenerateTagTreeByLLM: vi.fn() }));

const input = [
  { name: "品牌", nameChildList: [{ name: "华为", nameChildList: [{ name: "Mate60" }] }] },
];
const row = (id: number, name: string, parentId: number | null = null, level = 1): Row => ({
  id,
  name,
  parentId,
  level,
  teamId: 1,
  slug: `g/${id}`,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.length = 0;
  mocks.sync.mockReset().mockImplementation(async ({ tagsTree }: { tagsTree: TagNode[] }) => {
    let nextId = 500;
    const createdTagMapping = new Map<string, MuseDAMID>();
    const walk = (nodes: TagNode[]): unknown[] =>
      nodes.map((node) => {
        const id = node.id ?? ++nextId;
        if (node.tempId) createdTagMapping.set(node.tempId, MuseDAMID.from(id));
        return { id, name: node.name, sort: 9, children: walk(node.children) };
      });
    return { tags: walk(tagsTree), createdTagMapping };
  });
});

it("saves three manual tags through incremental sync, without import receipts or full local reads", async () => {
  const result = await batchCreateTags([{ name: "a" }, { name: "b" }, { name: "c" }], 2);
  expect(result).toEqual({
    success: true,
    data: { totalCount: 3, existingCount: 0, createdCount: 3 },
  });
  expect(mocks.atomicImport).not.toHaveBeenCalled();
  expect(mocks.sync).toHaveBeenCalledOnce();
  expect(mocks.sync.mock.calls[0][0].tagsTree).toHaveLength(3);
  expect(mocks.rows.map((r) => r.slug)).toEqual(["g/501", "g/502", "g/503"]);
  expect(mocks.rows.every((r) => (r as Row & { sort: number }).sort === 9)).toBe(true);
  expect(mocks.assetTag.findMany).not.toHaveBeenCalled();
  expect(mocks.bump).toHaveBeenCalledOnce();
});

it("reuses existing ancestors and preserves unrelated branches and configuration", async () => {
  mocks.rows.push(row(1, "品牌"), row(2, "华为", 1, 2), row(3, "无关"));
  const result = await batchCreateTags(input, 2);
  expect(result).toMatchObject({ success: true, data: { existingCount: 2, createdCount: 1 } });
  expect(mocks.sync.mock.calls[0][0].tagsTree).toMatchObject([
    { id: 1, children: [{ id: 2, children: [{ name: "Mate60", verb: "create" }] }] },
  ]);
  expect(mocks.assetTag.create).toHaveBeenCalledExactlyOnceWith({
    data: expect.objectContaining({ name: "Mate60", parentId: 2, level: 3 }),
  });
  expect(mocks.rows[2]).toEqual(row(3, "无关"));
});

it("does not mistake a root with the same name for a child beneath a new parent", async () => {
  mocks.rows.push(row(1, "华为"));
  expect(await batchCreateTags(input, 2)).toMatchObject({
    success: true,
    data: { createdCount: 3 },
  });
  expect(mocks.rows.find((r) => r.name === "华为" && r.parentId !== null)).toBeDefined();
});

it("coalesces duplicate input paths and skips entirely existing trees", async () => {
  mocks.rows.push(row(1, "品牌"), row(2, "华为", 1, 2), row(3, "Mate60", 2, 3));
  expect(await batchCreateTags([...input, ...input], 2)).toEqual({
    success: true,
    data: { totalCount: 3, existingCount: 3, createdCount: 0 },
  });
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.assetTag.create).not.toHaveBeenCalled();
});

it("excludes deleted and other-team paths when merging", async () => {
  mocks.rows.push({ ...row(1, "品牌"), deletedAt: new Date() }, { ...row(2, "品牌"), teamId: 2 });
  expect(await batchCreateTags(input, 2)).toMatchObject({
    success: true,
    data: { createdCount: 3 },
  });
});

it.each([1, 2] as const)(
  "keeps file imports on the receipt protocol for mode %i",
  async (addType) => {
    expect(await batchCreateTags(input, addType, { imported: true })).toMatchObject({
      success: true,
    });
    expect(mocks.atomicImport).toHaveBeenCalledExactlyOnceWith(
      { id: 1, slug: "t/1" },
      input,
      true,
      addType === 1 ? "overwrite" : "merge",
    );
    expect(mocks.sync).not.toHaveBeenCalled();
  },
);

it("keeps manual overwrite atomic", async () => {
  await batchCreateTags(input, 1);
  expect(mocks.atomicImport).toHaveBeenCalledWith(
    { id: 1, slug: "t/1" },
    input,
    undefined,
    "overwrite",
  );
  expect(mocks.sync).not.toHaveBeenCalled();
});

it("returns incremental failures without local writes or an import fallback", async () => {
  mocks.sync.mockRejectedValueOnce(new Error("upstream unavailable"));
  expect(await batchCreateTags(input, 2)).toMatchObject({
    success: false,
    message: "upstream unavailable",
  });
  expect(mocks.atomicImport).not.toHaveBeenCalled();
  expect(mocks.assetTag.create).not.toHaveBeenCalled();
});

it("rejects unsupported depth before any upstream writes", async () => {
  const deep = [
    {
      name: "1",
      nameChildList: [
        {
          name: "2",
          nameChildList: [
            { name: "3", nameChildList: [{ name: "4", nameChildList: [{ name: "5" }] }] },
          ],
        },
      ],
    },
  ];
  expect(await batchCreateTags(deep, 2)).toMatchObject({ success: false });
  expect(mocks.atomicImport).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
});

it("keeps large manual and AI trees on the bulk path before querying any local tags", async () => {
  const data = [
    { name: "root", nameChildList: Array.from({ length: 100 }, (_, i) => ({ name: `tag-${i}` })) },
  ];
  expect(await batchCreateTags(data, 2)).toMatchObject({ success: true });
  expect(mocks.atomicImport).toHaveBeenCalledWith({ id: 1, slug: "t/1" }, data, undefined, "merge");
  expect(mocks.assetTag.findFirst).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
});

it("does not silently report unsynced local paths as saved", async () => {
  mocks.rows.push({ ...row(1, "品牌"), slug: null });
  expect(await batchCreateTags(input, 2)).toMatchObject({
    success: false,
    message: expect.stringContaining("尚未同步"),
  });
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.assetTag.create).not.toHaveBeenCalled();
});

it("persists four-level new paths with the correct parent IDs", async () => {
  const data = [
    {
      name: "1",
      nameChildList: [
        { name: "2", nameChildList: [{ name: "3", nameChildList: [{ name: "4" }] }] },
      ],
    },
  ];
  expect(await batchCreateTags(data, 2)).toMatchObject({
    success: true,
    data: { createdCount: 4 },
  });
  expect(mocks.rows.map((r) => [r.name, r.parentId, r.level])).toEqual([
    ["1", null, 1],
    ["2", 100, 2],
    ["3", 101, 3],
    ["4", 102, 4],
  ]);
});
