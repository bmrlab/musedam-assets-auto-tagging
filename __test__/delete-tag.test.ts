vi.mock("server-only", () => ({}));
vi.mock("@/lib/tagging/tag-import-lock", () => ({
  runTagImportExclusive: (_t: number, _u: number, run: () => Promise<unknown>) => run(),
  assertTagImportOwnership: vi.fn(),
}));
import { deleteTagAndDescendants } from "@/app/tags/delete-tag";
import {
  buildCascadeDeletionTree,
  buildTagDeletionPlan,
  type DeletableTag,
} from "@/app/tags/delete-tag-plan";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const availableRows: DeletableTag[] = [];
  const assetTag = {
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  };
  const prisma = {
    assetTag,
    $executeRaw: vi.fn(async () => 3),
    $queryRaw: vi.fn(async (sql: TemplateStringsArray, teamId?: number, tagId?: number) => {
      if (!sql.join("").includes("WITH RECURSIVE target")) return [];
      const selected = new Set<number>();
      const target = availableRows.find((row) => row.id === tagId);
      if (!target || teamId !== 7) return [];
      selected.add(target.id);
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of availableRows) {
          if (row.parentId !== null && selected.has(row.parentId) && !selected.has(row.id)) {
            selected.add(row.id);
            changed = true;
          }
        }
      }
      let parentId = target.parentId;
      while (parentId !== null && !selected.has(parentId)) {
        selected.add(parentId);
        parentId = availableRows.find((row) => row.id === parentId)?.parentId ?? null;
      }
      return availableRows.filter((row) => selected.has(row.id));
    }),
    team: { findUniqueOrThrow: vi.fn(async () => ({ id: 7, slug: "team" })) },
    $transaction: vi.fn(
      async (
        callback: (tx: {
          assetTag: typeof assetTag;
          $executeRaw: typeof prisma.$executeRaw;
          $queryRaw: typeof prisma.$queryRaw;
        }) => Promise<void>,
      ) => callback({ assetTag, $executeRaw: prisma.$executeRaw, $queryRaw: prisma.$queryRaw }),
    ),
  };
  return { prisma, availableRows, syncTagsToMuseDAM: vi.fn() };
});
vi.mock("@/prisma/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (
    callback: (args: { user: { id: number }; team: { id: number } }) => Promise<unknown>,
  ) => callback({ user: { id: 1 }, team: { id: 7 } }),
}));
vi.mock("@/musedam/tags/syncToMuseDAM", () => ({ syncTagsToMuseDAM: mocks.syncTagsToMuseDAM }));

const tag = (
  id: number,
  parentId: number | null,
  level: number,
  name = `tag${id}`,
): DeletableTag => ({
  id,
  parentId,
  level,
  name,
  slug: null,
  sort: 0,
});
const rows = [tag(1, null, 1), tag(2, 1, 2), tag(3, 2, 3), tag(4, null, 1)];

describe("tag deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.availableRows.splice(0, mocks.availableRows.length, ...rows);
    mocks.syncTagsToMuseDAM.mockResolvedValue({ tags: [], createdTagMapping: new Map() });
  });

  it("soft-deletes the subtree without clearing historical foreign keys", async () => {
    await deleteTagAndDescendants(1);
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(3);
    expect(mocks.prisma.assetTag.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.assetTag.update).not.toHaveBeenCalled();
  });

  it("rejects tags outside the authenticated team's rows", async () => {
    expect(await deleteTagAndDescendants(999)).toMatchObject({ success: false });
    expect(mocks.prisma.assetTag.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([7, 999, 7, 7]);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps local data untouched on MuseDAM failure", async () => {
    mocks.availableRows.splice(
      0,
      mocks.availableRows.length,
      ...rows.map((row) => ({ ...row, slug: String(row.id) })),
    );
    mocks.syncTagsToMuseDAM.mockRejectedValueOnce(new Error("remote failure"));
    expect(await deleteTagAndDescendants(1)).toEqual({
      success: false,
      message: "remote failure",
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("asks MuseDAM to delete the synced parent once and cascade its children", () => {
    const syncedRows = rows.map((row) => ({ ...row, slug: String(row.id) }));
    const tree = buildCascadeDeletionTree(syncedRows, buildTagDeletionPlan(syncedRows, 1));
    expect(tree).toEqual([expect.objectContaining({ id: 1, verb: "delete", children: [] })]);
  });

  it("sends only the target delete while retaining ancestor context for a nested subtree", () => {
    const syncedRows = rows.map((row) => ({ ...row, slug: String(row.id) }));
    const tree = buildCascadeDeletionTree(syncedRows, buildTagDeletionPlan(syncedRows, 2));
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ id: 1 });
    expect(tree[0].verb).toBeUndefined();
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0]).toMatchObject({ id: 2, verb: "delete", children: [] });
  });

  it("rejects a synced descendant beneath an unsynced target instead of losing its remote deletion", () => {
    const inconsistent = rows.map((row) => ({ ...row, slug: row.id === 3 ? "3" : null }));
    expect(() =>
      buildCascadeDeletionTree(inconsistent, buildTagDeletionPlan(inconsistent, 1)),
    ).toThrow("尚未与 MuseDAM 同步");
  });

  it("can retry remote deletion after local saving fails", async () => {
    mocks.availableRows.splice(
      0,
      mocks.availableRows.length,
      ...rows.map((row) => ({ ...row, slug: String(row.id) })),
    );
    mocks.prisma.$executeRaw.mockRejectedValueOnce(new Error("local save failed"));
    expect(await deleteTagAndDescendants(1)).toMatchObject({ success: false });
    expect(await deleteTagAndDescendants(1)).toMatchObject({ success: true });
    expect(mocks.syncTagsToMuseDAM).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.syncTagsToMuseDAM.mock.calls) {
      expect(request.tagsTree).toMatchObject([{ id: 1, verb: "delete", children: [] }]);
    }
  });

  it("reads only a leaf and its ancestors when 20000 unrelated tags exist", async () => {
    mocks.availableRows.splice(
      0,
      mocks.availableRows.length,
      ...rows.map((row) => ({ ...row, slug: String(row.id) })),
      ...Array.from({ length: 20000 }, (_, i) => tag(i + 100, 4, 2)),
    );
    expect(await deleteTagAndDescendants(3)).toMatchObject({ success: true });
    const result = await mocks.prisma.$queryRaw.mock.results[0].value;
    expect(result.map((row: DeletableTag) => row.id)).toEqual([1, 2, 3]);
    expect(mocks.prisma.assetTag.findMany).not.toHaveBeenCalled();
    expect(mocks.syncTagsToMuseDAM.mock.calls[0][0].tagsTree).toMatchObject([
      { id: 1, children: [{ id: 2, children: [{ id: 3, verb: "delete", children: [] }] }] },
    ]);
  });

  it("allows deletion of a synced leaf", async () => {
    mocks.availableRows.splice(
      0,
      mocks.availableRows.length,
      ...rows.map((row) => ({ ...row, slug: String(row.id) })),
    );
    expect(await deleteTagAndDescendants(3)).toMatchObject({ success: true });
    expect(mocks.syncTagsToMuseDAM).toHaveBeenCalledOnce();
  });
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
