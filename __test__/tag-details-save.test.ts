// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  sync: vi.fn(),
  apply: vi.fn(),
  transaction: vi.fn(async (run: (tx: unknown) => unknown) => run({ transaction: true })),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (run: (session: unknown) => unknown) => run({ team: { id: 1 }, user: { id: "u1" } }),
}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    assetTag: { findFirst: mocks.findFirst },
    team: { findUniqueOrThrow: async () => ({ id: 1, slug: "t/team" }) },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/musedam/tags/syncToMuseDAM", () => ({
  syncTagsToMuseDAM: mocks.sync,
  syncTagsToMuseDAMWithCurrentSystemAsBase: vi.fn(),
}));
vi.mock("@/musedam/tags/syncFromMuseDAM", () => ({ syncTagsFromMuseDAM: vi.fn() }));
vi.mock("@/musedam/tags/importTagTree", () => ({ importTagTreeSynchronously: vi.fn() }));
vi.mock("@/lib/tagging/import-tag-config", () => ({ applyTagConfigImportChunk: mocks.apply }));
vi.mock("@/app/tags/generateTagTreeLLM", () => ({ executeGenerateTagTreeByLLM: vi.fn() }));

import { updateTagExtra } from "@/app/tags/actions";

const tag = { id: 3, teamId: 1, slug: "g/303", name: "宣传海报", parentId: 2 };
const parent = { id: 2, teamId: 1, slug: "g/202", name: "模特", parentId: 1 };
const root = { id: 1, teamId: 1, slug: "g/101", name: "VESPER", parentId: null };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockReset();
  mocks.sync.mockReset().mockResolvedValue({ tags: [], createdTagMapping: new Map() });
  mocks.findFirst.mockImplementation(async ({ where }) => {
    if (typeof where.id !== "number") return null; // duplicate-name lookup
    return (
      [tag, parent, root].find((row) => row.id === where.id && row.teamId === where.teamId) ?? null
    );
  });
});

it("syncs a details rename with only its ancestor path before saving the name and AI configuration", async () => {
  const fields = { name: " 1 ", description: "描述", keywords: ["海报"], taggingEnabled: false };
  expect(await updateTagExtra(3, fields)).toMatchObject({ success: true });
  expect(mocks.sync).toHaveBeenCalledExactlyOnceWith({
    team: { id: 1, slug: "t/team" },
    tagsTree: [
      {
        id: 1,
        slug: root.slug,
        name: root.name,
        children: [
          {
            id: 2,
            slug: parent.slug,
            name: parent.name,
            children: [{ id: 3, slug: tag.slug, name: "1", verb: "update", children: [] }],
          },
        ],
      },
    ],
  });
  expect(mocks.apply).toHaveBeenCalledWith(
    { transaction: true },
    1,
    [{ tag: { id: 3 }, record: { fields }, data: { name: "1", taggingEnabled: false } }],
    false,
  );
  expect(mocks.sync.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.apply.mock.invocationCallOrder[0],
  );
});

it("renames a root without submitting its children", async () => {
  expect(await updateTagExtra(1, { name: "新根" })).toMatchObject({ success: true });
  expect(mocks.sync.mock.calls[0][0].tagsTree).toEqual([
    { id: 1, slug: root.slug, name: "新根", verb: "update", children: [] },
  ]);
});

it.each([{ description: "仅描述" }, { keywords: [] }])(
  "keeps unchanged names and AI-only edits local: %j",
  async (fields) => {
    expect(await updateTagExtra(3, fields)).toMatchObject({ success: true });
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  },
);

it("returns remote failures without writing any local fields", async () => {
  mocks.sync.mockRejectedValueOnce(new Error("主站同步失败"));
  expect(await updateTagExtra(3, { name: "1", description: "不能部分保存" })).toEqual({
    success: false,
    message: "主站同步失败",
  });
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
});

it("rejects blank names and duplicate sibling names before syncing", async () => {
  expect(await updateTagExtra(3, { name: "   " })).toMatchObject({ success: false });
  mocks.findFirst.mockResolvedValueOnce(tag).mockResolvedValueOnce({ id: 4 });
  expect(await updateTagExtra(3, { name: "重复" })).toMatchObject({ success: false });
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
});

it("rejects missing, deleted or other-team tags and parents", async () => {
  expect(await updateTagExtra(999, { name: "1" })).toMatchObject({ success: false });
  mocks.findFirst
    .mockResolvedValueOnce(tag)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);
  expect(await updateTagExtra(3, { name: "1" })).toMatchObject({ success: false });
  expect(mocks.findFirst).toHaveBeenCalledWith({ where: { deletedAt: null, id: 2, teamId: 1 } });
  expect(mocks.sync).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
});

vi.mock("@/app/tags/tagManagementAuth", async () => {
  const { withAuth } = await import("@/app/(auth)/withAuth");
  return { withTagManagementAuth: withAuth };
});
vi.mock("@/app/tags/tagMutation", async () => {
  const { withAuth } = await import("@/app/(auth)/withAuth");
  return {
    withTagMutation: withAuth,
    ensureTagMutationRecovered: vi.fn(),
    isTagMutationActive: () => true,
  };
});

it("syncs an explicitly resaved name to repair historic local-only changes", async () => {
  expect(await updateTagExtra(3, { name: " 宣传海报 " })).toMatchObject({ success: true });
  expect(mocks.sync).toHaveBeenCalledOnce();
});

vi.mock("@/lib/tagging/tag-import-lock", () => ({ assertTagImportOwnership: vi.fn() }));
