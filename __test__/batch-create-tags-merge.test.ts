import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 批量创建标签「合并到现有标签系统」(addType=2)：
 * 在已存在的一级标签下追加二/三级标签时，推给 MuseDAM 的树里已存在节点必须带 id 且不是 create，
 * 本地 DB 只创建真正缺失的节点。
 */

type TagRow = {
  id: number;
  teamId: number;
  name: string;
  slug: string | null;
  parentId: number | null;
  level: number;
};

const mocks = vi.hoisted(() => {
  const rows: TagRow[] = [];
  let nextId = 100;
  const assetTag = {
    findMany: vi.fn(async ({ where }: { where?: { teamId?: number; parentId?: null } } = {}) =>
      rows.filter(
        (r) =>
          (where?.teamId === undefined || r.teamId === where.teamId) &&
          (where?.parentId === undefined || r.parentId === null),
      ),
    ),
    create: vi.fn(async ({ data }: { data: Omit<TagRow, "id" | "slug"> & { slug?: string } }) => {
      const row: TagRow = { id: nextId++, slug: null, ...data };
      rows.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<TagRow> }) => {
      const row = rows.find((r) => r.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    count: vi.fn(async () => 0),
  };
  const prisma = {
    assetTag,
    team: { findUniqueOrThrow: vi.fn(async () => ({ id: 1, slug: "t/test" })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return {
    rows,
    prisma,
    assetTag,
    reset: () => {
      rows.length = 0;
      nextId = 100;
    },
    atomicImport: vi.fn(async () => undefined),
    syncTagsToMuseDAM: vi.fn(),
    syncTagsToMuseDAMWithCurrentSystemAsBase: vi.fn(async () => undefined),
    syncTagsFromMuseDAM: vi.fn(async () => undefined),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/musedam/tags/importTagTree", () => ({ importTagTreeSynchronously: mocks.atomicImport }));
afterEach(() => vi.unstubAllEnvs());
vi.mock("@/prisma/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (fn: (args: { user: unknown; team: { id: number; slug: string } }) => Promise<unknown>) =>
    fn({ user: { id: "u1" }, team: { id: 1, slug: "t/test" } }),
}));
vi.mock("@/musedam/tags/syncToMuseDAM", () => ({
  syncTagsToMuseDAM: mocks.syncTagsToMuseDAM,
  syncTagsToMuseDAMWithCurrentSystemAsBase: mocks.syncTagsToMuseDAMWithCurrentSystemAsBase,
}));
vi.mock("@/musedam/tags/syncFromMuseDAM", () => ({
  syncTagsFromMuseDAM: mocks.syncTagsFromMuseDAM,
}));
vi.mock("@/app/(tagging)/keyword-feedback", () => ({
  pruneRejectionCountsForRemovedKeywords: vi.fn(),
}));
vi.mock("@/app/tags/generateTagTreeLLM", () => ({
  executeGenerateTagTreeByLLM: vi.fn(),
}));

import { batchCreateTags } from "@/app/tags/actions";
const input = [
  {
    name: "品牌",
    nameChildList: [{ name: "华为", nameChildList: [{ name: "Mate60" }] }],
  },
];


beforeEach(() => { mocks.reset(); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllEnvs());

it.each([1, 2] as const)("always uses the synchronous import endpoint for addType %i with no configuration", async (addType) => {
  vi.stubEnv("MUSEDAM_TAG_TREE_IMPORT_ENABLED", undefined);
  expect(await batchCreateTags(input, addType, { imported: true })).toMatchObject({ success: true });
  expect(mocks.atomicImport).toHaveBeenCalledWith({ id: 1, slug: "t/test" }, input, true, addType === 1 ? "overwrite" : "merge");
  expect(mocks.syncTagsToMuseDAM).not.toHaveBeenCalled();
  expect(mocks.assetTag.create).not.toHaveBeenCalled();
  expect(mocks.assetTag.deleteMany).not.toHaveBeenCalled();
});

it.each(["false", "true"])("ignores the obsolete environment switch value %s", async (value) => {
  vi.stubEnv("MUSEDAM_TAG_TREE_IMPORT_ENABLED", value);
  await batchCreateTags(input, 2);
  expect(mocks.atomicImport).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), input, undefined, "merge");
  expect(mocks.syncTagsToMuseDAM).not.toHaveBeenCalled();
});

it("coalesces duplicate paths before submitting one synchronous import", async () => {
  expect(await batchCreateTags([...input, ...input], 2)).toMatchObject({ success: true });
  expect(mocks.atomicImport).toHaveBeenCalledTimes(1);
  expect(mocks.atomicImport).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), input, undefined, "merge");
});

it.each([1, 2] as const)("never falls back to legacy writes when addType %i fails", async (addType) => {
  mocks.atomicImport.mockRejectedValueOnce(new Error("upstream unavailable"));
  expect(await batchCreateTags(input, addType)).toMatchObject({ success: false, message: "upstream unavailable" });
  expect(mocks.syncTagsToMuseDAM).not.toHaveBeenCalled();
  expect(mocks.syncTagsToMuseDAMWithCurrentSystemAsBase).not.toHaveBeenCalled();
  expect(mocks.syncTagsFromMuseDAM).not.toHaveBeenCalled();
  expect(mocks.assetTag.create).not.toHaveBeenCalled();
  expect(mocks.assetTag.deleteMany).not.toHaveBeenCalled();
});

it("rejects a tree exceeding the supported depth before contacting MuseDAM", async () => {
  const deep = [{ name: "1", nameChildList: [{ name: "2", nameChildList: [{ name: "3", nameChildList: [{ name: "4", nameChildList: [{ name: "5" }] }] }] }] }];
  expect(await batchCreateTags(deep, 2)).toMatchObject({ success: false });
  expect(mocks.atomicImport).not.toHaveBeenCalled();
});
