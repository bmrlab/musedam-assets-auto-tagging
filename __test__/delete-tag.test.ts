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
    team: { findUniqueOrThrow: vi.fn(async () => ({ id: 7, slug: "team" })) },
    $transaction: vi.fn(async (callback: (tx: { assetTag: typeof assetTag }) => Promise<void>) =>
      callback({ assetTag }),
    ),
  };
  return { prisma, syncTagsToMuseDAM: vi.fn() };
});
vi.mock("@/prisma/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (callback: (args: { team: { id: number } }) => Promise<unknown>) =>
    callback({ team: { id: 7 } }),
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

  it("explicitly deletes all descendants despite the SET NULL parent foreign key", async () => {
    await deleteTagAndDescendants(1);
    expect(mocks.prisma.assetTag.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { teamId: 7, id: { in: [1, 2, 3] } },
    });
    expect(mocks.prisma.assetTag.update).not.toHaveBeenCalled();
  });

  it("rejects tags outside the authenticated team's rows", async () => {
    expect(await deleteTagAndDescendants(999)).toMatchObject({ success: false });
    expect(mocks.prisma.assetTag.findMany).toHaveBeenCalledWith({ where: { teamId: 7 } });
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

  it("builds deepest-first MuseDAM deletions with correct ancestor context", () => {
    const syncedRows = rows.map((row) => ({ ...row, slug: String(row.id) }));
    const tree = buildCascadeDeletionTree(syncedRows, buildTagDeletionPlan(syncedRows, 1));
    expect(tree.map((node) => node.id)).toEqual([1, 1, 1]);
    expect(tree[0].verb).toBeUndefined();
    expect(tree[0].children[0].children[0]).toMatchObject({ id: 3, verb: "delete" });
    expect(tree[1].children[0]).toMatchObject({ id: 2, verb: "delete" });
    expect(tree[2]).toMatchObject({ id: 1, verb: "delete" });
  });

  it("allows deletion of a synced leaf", async () => {
    mocks.prisma.assetTag.findMany.mockResolvedValue(
      rows.map((row) => ({ ...row, slug: String(row.id) })),
    );
    expect(await deleteTagAndDescendants(3)).toMatchObject({ success: true });
    expect(mocks.syncTagsToMuseDAM).toHaveBeenCalledOnce();
  });
});
