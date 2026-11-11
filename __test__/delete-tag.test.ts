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
  const assetTag = {
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  };
  const prisma = {
    assetTag,
    $executeRaw: vi.fn(async () => 3),
    $queryRaw: vi.fn(async () => []),
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
  return { prisma, syncTagsToMuseDAM: vi.fn() };
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
    mocks.prisma.assetTag.findMany.mockResolvedValue(rows);
    mocks.syncTagsToMuseDAM.mockResolvedValue({ tags: [], createdTagMapping: new Map() });
  });

  it("soft-deletes the subtree without clearing historical foreign keys", async () => {
    await deleteTagAndDescendants(1);
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.assetTag.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.assetTag.update).not.toHaveBeenCalled();
  });

  it("rejects tags outside the authenticated team's rows", async () => {
    expect(await deleteTagAndDescendants(999)).toMatchObject({ success: false });
    expect(mocks.prisma.assetTag.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, teamId: 7 },
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps local data untouched on MuseDAM failure", async () => {
    mocks.prisma.assetTag.findMany.mockResolvedValue(
      rows.map((row) => ({ ...row, slug: String(row.id) })),
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
    expect(tree).toEqual([
      expect.objectContaining({ id: 1, verb: "delete", children: [] }),
    ]);
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
    mocks.prisma.assetTag.findMany.mockResolvedValue(
      rows.map((row) => ({ ...row, slug: String(row.id) })),
    );
    mocks.prisma.$executeRaw.mockRejectedValueOnce(new Error("local save failed"));
    expect(await deleteTagAndDescendants(1)).toMatchObject({ success: false });
    expect(await deleteTagAndDescendants(1)).toMatchObject({ success: true });
    expect(mocks.syncTagsToMuseDAM).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.syncTagsToMuseDAM.mock.calls) {
      expect(request.tagsTree).toMatchObject([{ id: 1, verb: "delete", children: [] }]);
    }
  });

  it("allows deletion of a synced leaf", async () => {
    mocks.prisma.assetTag.findMany.mockResolvedValue(
      rows.map((row) => ({ ...row, slug: String(row.id) })),
    );
    expect(await deleteTagAndDescendants(3)).toMatchObject({ success: true });
    expect(mocks.syncTagsToMuseDAM).toHaveBeenCalledOnce();
  });
});
