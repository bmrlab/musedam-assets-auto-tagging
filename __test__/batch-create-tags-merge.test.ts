import { beforeEach, describe, expect, it, vi } from "vitest";

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
    syncTagsToMuseDAM: vi.fn(),
    syncTagsToMuseDAMWithCurrentSystemAsBase: vi.fn(async () => undefined),
    syncTagsFromMuseDAM: vi.fn(async () => undefined),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (fn: (args: { user: unknown; team: { id: number } }) => Promise<unknown>) =>
    fn({ user: { id: "u1" }, team: { id: 1 } }),
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
import type { TagNode } from "@/app/tags/types";

const seed = (row: Omit<TagRow, "teamId">) => {
  mocks.rows.push({ teamId: 1, ...row });
};

const lastSyncedTree = (): TagNode[] => {
  const call = mocks.syncTagsToMuseDAM.mock.calls.at(-1)?.[0] as
    | { tagsTree: TagNode[] }
    | undefined;
  if (!call) throw new Error("syncTagsToMuseDAM was not called");
  return call.tagsTree;
};

const input = [
  {
    name: "品牌",
    nameChildList: [{ name: "华为", nameChildList: [{ name: "Mate60" }] }],
  },
];

describe("batchCreateTags merge mode (addType=2)", () => {
  beforeEach(() => {
    mocks.reset();
    vi.clearAllMocks();
    mocks.syncTagsToMuseDAM.mockResolvedValue({ tags: [], createdTagMapping: new Map() });
  });

  it("reuses an existing synced root tag and only creates the missing children", async () => {
    seed({ id: 10, name: "品牌", slug: "slug-10", parentId: null, level: 1 });

    const result = await batchCreateTags(input, 2);
    expect(result.success).toBe(true);

    const tree = lastSyncedTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(10);
    expect(tree[0].slug).toBe("slug-10");
    expect(tree[0].verb).toBeUndefined();
    expect(tree[0].children[0].verb).toBe("create");
    expect(tree[0].children[0].id).toBeUndefined();
    expect(tree[0].children[0].children[0].verb).toBe("create");

    expect(mocks.assetTag.create).toHaveBeenCalledTimes(2);
    const created = mocks.assetTag.create.mock.calls.map((c) => c[0].data);
    const huawei = created.find((d) => d.name === "华为");
    const mate = created.find((d) => d.name === "Mate60");
    expect(huawei).toMatchObject({ parentId: 10, level: 2, teamId: 1 });
    expect(mate?.level).toBe(3);
    expect(mate?.parentId).toBe(mocks.rows.find((r) => r.name === "华为")?.id);
    // 根标签未被重复创建
    expect(mocks.rows.filter((r) => r.name === "品牌")).toHaveLength(1);
  });

  it("marks the whole tree as create when the root does not exist yet", async () => {
    const result = await batchCreateTags(input, 2);
    expect(result.success).toBe(true);

    const tree = lastSyncedTree();
    expect(tree[0].verb).toBe("create");
    expect(tree[0].id).toBeUndefined();
    expect(tree[0].children[0].verb).toBe("create");
    expect(mocks.assetTag.create).toHaveBeenCalledTimes(3);
  });

  it("marks an existing root without slug as update so MuseDAM falls back to create", async () => {
    seed({ id: 10, name: "品牌", slug: null, parentId: null, level: 1 });

    const result = await batchCreateTags(input, 2);
    expect(result.success).toBe(true);

    const tree = lastSyncedTree();
    expect(tree[0].id).toBe(10);
    expect(tree[0].verb).toBe("update");
    expect(mocks.assetTag.create).toHaveBeenCalledTimes(2);
  });

  it("is a no-op for the DB when the imported tree already exists entirely", async () => {
    seed({ id: 10, name: "品牌", slug: "s10", parentId: null, level: 1 });
    seed({ id: 11, name: "华为", slug: "s11", parentId: 10, level: 2 });
    seed({ id: 12, name: "Mate60", slug: "s12", parentId: 11, level: 3 });

    const result = await batchCreateTags(input, 2);
    expect(result.success).toBe(true);

    const tree = lastSyncedTree();
    expect(tree[0].verb).toBeUndefined();
    expect(tree[0].children[0].id).toBe(11);
    expect(tree[0].children[0].children[0].id).toBe(12);
    expect(mocks.assetTag.create).not.toHaveBeenCalled();
  });

  it("matches an existing root even when its stored level is wrong", async () => {
    // 历史数据 level 不准时不能撞 teamId+name 唯一索引
    seed({ id: 10, name: "品牌", slug: "s10", parentId: null, level: 2 });

    const result = await batchCreateTags(input, 2);
    expect(result.success).toBe(true);
    expect(lastSyncedTree()[0].id).toBe(10);
    expect(mocks.rows.filter((r) => r.name === "品牌")).toHaveLength(1);
  });
});
