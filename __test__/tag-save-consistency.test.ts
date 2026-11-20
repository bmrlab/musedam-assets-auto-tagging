// @vitest-environment node
import { fetchTeamTags, saveTagsTree, updateTagSort, updateTagExtra } from "@/app/tags/actions";
import type { TagNode } from "@/app/tags/types";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type Row = {
    id: number;
    teamId: number;
    slug: string;
    name: string;
    parentId: number | null;
    sort: number;
  };
  type Query = {
    teamId: number;
    id?: number | { not?: number; in?: number[] };
    parentId?: number | null;
    name?: string;
  };
  const local: Row[] = [],
    remote: Row[] = [];
  const markers = new Map<string, unknown>();
  const assetTag = {
    findFirst: vi.fn(
      async ({ where }: { where: Query }) =>
        local.find(
          (row) =>
            row.teamId === where.teamId &&
            (typeof where.id !== "number" || row.id === where.id) &&
            (typeof where.id !== "object" || !where.id.not || row.id !== where.id.not) &&
            (where.parentId === undefined || row.parentId === where.parentId) &&
            (where.name === undefined || row.name === where.name),
        ) ?? null,
    ),
    findMany: vi.fn(async ({ where }: { where: Query }) =>
      local.filter(
        (row) =>
          row.teamId === where.teamId &&
          (typeof where.id !== "object" || !where.id.in || where.id.in.includes(row.id)),
      ),
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: number; teamId: number }; data: Partial<Row> }) => {
        const row = local.find((row) => row.id === where.id && row.teamId === where.teamId);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      },
    ),
  };
  const sortWrite = vi.fn(async (_sql: TemplateStringsArray, ids: number[], sorts: number[], teamId: number) => {
      let count = 0;
      ids.forEach((id, index) => {
        const row = local.find(row => row.id === id && row.teamId === teamId);
        if (row) { row.sort = sorts[index]; count++; }
      });
      return count;
    });
  return {
    local,
    remote,
    markers,
    assetTag,
    allowed: true,
    sync: vi.fn(),
    recover: vi.fn(),
    bump: vi.fn(),
    sortWrite,
    transaction: vi.fn(async (run: (tx: unknown) => unknown) =>
      run({
        assetTag,
        $queryRaw: vi.fn(),
        $executeRaw: sortWrite,
        teamConfig: {
          upsert: async ({ create }: { create: { key: string; value: unknown } }) =>
            markers.set(create.key, create.value),
          deleteMany: async ({ where }: { where: { key: string } }) => {
            markers.delete(where.key);
            return { count: 1 };
          },
        },
      }),
    ),
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (run: (ctx: unknown) => unknown) =>
    run({
      user: { id: 9, slug: "u/99" },
      team: { id: 1, slug: "t/11" },
    }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/app/(auth)/lib", () => ({
  checkUserPermission: async () => ({ roleCode: mocks.allowed ? "admin" : null }),
}));
vi.mock("@/lib/tagging/tag-import-lock", () => ({
  runTagImportExclusive: async (_t: number, _u: number, run: () => unknown) => run(),
  assertTagImportOwnership: vi.fn(),
}));
vi.mock("@/lib/tagging/tag-config-version", () => ({ bumpTagConfigVersion: mocks.bump }));
vi.mock("@/musedam/tags/syncToMuseDAM", () => ({
  syncTagsToMuseDAM: mocks.sync,
  syncTagsToMuseDAMWithCurrentSystemAsBase: vi.fn(),
}));
vi.mock("@/musedam/tags/syncFromMuseDAM", () => ({ syncTagsFromMuseDAM: mocks.recover }));
vi.mock("@/musedam/tags/importTagTree", () => ({ importTagTreeSynchronously: vi.fn() }));
vi.mock("@/app/tags/generateTagTreeLLM", () => ({ executeGenerateTagTreeByLLM: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({
  default: {
    assetTag: mocks.assetTag,
    $transaction: mocks.transaction,
    team: { findUniqueOrThrow: async () => ({ id: 1, slug: "t/11" }) },
    teamConfig: {
      findUnique: async ({ where }: { where: { teamId_key: { key: string } } }) =>
        mocks.markers.get(where.teamId_key.key) ?? null,
      upsert: async ({ create }: { create: { key: string; value: unknown } }) =>
        mocks.markers.set(create.key, create.value),
      deleteMany: async ({ where }: { where: { key: string } }) => {
        mocks.markers.delete(where.key);
        return { count: 1 };
      },
    },
  },
}));

const rename: TagNode[] = [
  {
    id: 1,
    slug: "g/101",
    name: "品牌",
    children: [{ id: 2, slug: "g/202", name: "新名", verb: "update", children: [] }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed = true;
  mocks.local.splice(
    0,
    mocks.local.length,
    { id: 1, teamId: 1, slug: "g/101", name: "品牌", parentId: null, sort: 0 },
    { id: 2, teamId: 1, slug: "g/202", name: "旧名", parentId: 1, sort: 2 },
    { id: 3, teamId: 1, slug: "g/303", name: "同级", parentId: 1, sort: 1 },
  );
  mocks.remote.splice(0, mocks.remote.length, ...structuredClone(mocks.local));
  mocks.markers.clear();
  mocks.recover.mockReset().mockImplementation(async () => {
    mocks.local.splice(0, mocks.local.length, ...structuredClone(mocks.remote));
  });
  mocks.sync.mockReset().mockImplementation(async ({ tagsTree }: { tagsTree: TagNode[] }) => {
    const walk = (nodes: TagNode[]): unknown[] =>
      nodes.map((node) => {
        const row = mocks.remote.find((row) => row.id === node.id)!;
        if (node.verb === "update")
          Object.assign(row, {
            name: node.name,
            ...(node.sort !== undefined ? { sort: node.sort } : {}),
          });
        return {
          id: Number(row.slug.slice(2)),
          name: row.name,
          sort: row.sort,
          children: walk(node.children),
        };
      });
    return { tags: walk(tagsTree), createdTagMapping: new Map() };
  });
});

it("denies real write entry points before any remote or local mutation", async () => {
  mocks.allowed = false;
  expect(await saveTagsTree(rename)).toMatchObject({ success: false, code: "forbidden" });
  expect(await updateTagSort([{ id: 2, sort: 1 }])).toMatchObject({
    success: false,
    code: "forbidden",
  });
  expect(await updateTagExtra(2, { description: "不能越权修改" })).toMatchObject({ success: false, code: "forbidden" });
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.markers.size).toBe(0);
});

it("keeps a tree rename local and remote equal on success", async () => {
  expect(await saveTagsTree(rename)).toMatchObject({ success: true });
  expect(mocks.local).toEqual(mocks.remote);
  expect(mocks.local[1].name).toBe("新名");
  expect(mocks.bump).toHaveBeenCalledOnce();
  expect(mocks.recover).not.toHaveBeenCalled();
});

it("does not report success or write a new local name after upstream failure", async () => {
  mocks.sync.mockRejectedValueOnce(new Error("offline"));
  expect(await saveTagsTree(rename)).toMatchObject({ success: false });
  expect(mocks.local).toEqual(mocks.remote);
  expect(mocks.local[1].name).toBe("旧名");
  expect(mocks.assetTag.update).not.toHaveBeenCalled();
});

it("repairs remote success followed by local commit failure", async () => {
  mocks.assetTag.update.mockRejectedValueOnce(new Error("local commit failed"));
  expect(await saveTagsTree(rename)).toMatchObject({ success: false });
  expect(mocks.recover).toHaveBeenCalledOnce();
  expect(mocks.local).toEqual(mocks.remote);
  expect(mocks.local[1].name).toBe("新名");
});

it("does not expose a stale tree while a failed operation still needs recovery", async () => {
  mocks.sync.mockRejectedValueOnce(new Error("timeout"));
  mocks.recover.mockRejectedValue(new Error("offline"));
  expect(await saveTagsTree(rename)).toMatchObject({ success: false });
  expect(mocks.markers.size).toBe(1);
  await expect(fetchTeamTags()).rejects.toThrow("offline");
});

it("saves nested sorting once on the server with only its ancestor path", async () => {
  expect(
    await updateTagSort([
      { id: 3, sort: 2 },
      { id: 2, sort: 1 },
    ]),
  ).toMatchObject({ success: true });
  expect(mocks.sync).toHaveBeenCalledOnce();
  expect(mocks.sync.mock.calls[0][0].tagsTree).toMatchObject([
    {
      id: 1,
      children: [
        { id: 3, name: "同级", sort: 2, children: [] },
        { id: 2, name: "旧名", sort: 1, children: [] },
      ],
    },
  ]);
  expect(mocks.local).toEqual(mocks.remote);
});

it("leaves both old sort orders intact when upstream fails", async () => {
  mocks.sync.mockRejectedValueOnce(new Error("offline"));
  expect(
    await updateTagSort([
      { id: 3, sort: 2 },
      { id: 2, sort: 1 },
    ]),
  ).toMatchObject({ success: false });
  expect(mocks.assetTag.update).not.toHaveBeenCalled();
  expect(mocks.local).toEqual(mocks.remote);
});

it("recovers sort order from the master when local saving fails", async () => {
  mocks.sortWrite.mockRejectedValueOnce(new Error("local commit failed"));
  expect(
    await updateTagSort([
      { id: 3, sort: 2 },
      { id: 2, sort: 1 },
    ]),
  ).toMatchObject({ success: false });
  expect(mocks.local).toEqual(mocks.remote);
  expect(mocks.local[1].sort).toBe(1);
});

it("rejects foreign IDs, stale paths and duplicate names before sending upstream", async () => {
  const wrongPath = [{ ...rename[0].children[0] }];
  expect(await saveTagsTree(wrongPath)).toMatchObject({ success: false });
  expect(await updateTagSort([{ id: 999, sort: 1 }])).toMatchObject({ success: false });
  expect(
    await saveTagsTree([{ ...rename[0], children: [{ ...rename[0].children[0], name: "同级" }] }]),
  ).toMatchObject({ success: false });
  expect(mocks.sync).not.toHaveBeenCalled();
});

it("rejects sorting across parents or invalid numbers", async () => {
  for (const input of [
    [
      { id: 1, sort: 2 },
      { id: 2, sort: 1 },
    ],
    [{ id: 2, sort: NaN }],
    [
      { id: 2, sort: 1 },
      { id: 2, sort: 2 },
    ],
  ])
    expect(await updateTagSort(input)).toMatchObject({ success: false });
  expect(mocks.sync).not.toHaveBeenCalled();
});
