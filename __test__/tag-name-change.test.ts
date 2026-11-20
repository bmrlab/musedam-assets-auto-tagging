import { buildTagNameChange } from "@/app/tags/tagNameChange";
import type { TagNode } from "@/app/tags/types";
import { idToSlug } from "@/lib/slug";
import { MuseDAMID } from "@/musedam/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), findMany: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: mocks.request }));
vi.mock("@/musedam/apiKey", () => ({
  retrieveTeamCredentials: vi.fn(async () => ({ apiKey: "key" })),
}));
vi.mock("@/prisma/prisma", () => ({
  default: { assetTag: { findMany: mocks.findMany, update: vi.fn() } },
}));

import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";

beforeEach(() => vi.clearAllMocks());

const node = (id: number, children: TagNode[] = []): TagNode => ({
  id,
  slug: idToSlug("assetTag", MuseDAMID.from(id)),
  name: `tag-${id}`,
  originalName: `tag-${id}`,
  children,
});

describe("single tag name changes", () => {
  it("prunes unrelated siblings at every level even when a caller supplies the full tree", async () => {
    vi.clearAllMocks();
    const tree = [node(1, [node(2, Array.from({ length: 20000 }, (_, i) => node(i + 10))), { ...node(3), name: "新名称", verb: "update" as const }])];
    mocks.findMany.mockResolvedValue([tree[0], tree[0].children[1]]);
    mocks.request.mockImplementation(async (_path, { body }) => ({ tags: body.tags }));
    await syncTagsToMuseDAM({ team: { id: 7, slug: "t/77" }, tagsTree: tree });
    expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { deletedAt: null, teamId: 7, id: { in: [1, 3] } },
      select: { id: true, slug: true },
    });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith("/api/muse/merge-tags", expect.objectContaining({
      body: { tags: [{ id: 1, name: "tag-1", operation: 0, children: [{ id: 3, name: "新名称", operation: 1 }] }] },
    }));
    expect(tree[0].children[0].children).toHaveLength(20000);
  });

  it("deletes a parent without submitting any descendant operations", async () => {
    vi.clearAllMocks();
    const target = { ...node(1, [{ ...node(2), verb: "update" as const }]), verb: "delete" as const };
    mocks.findMany.mockResolvedValue([target]);
    mocks.request.mockResolvedValue({ tags: [] });
    await syncTagsToMuseDAM({ team: { id: 7, slug: "t/77" }, tagsTree: [target] });
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith("/api/muse/merge-tags", expect.objectContaining({
      body: { tags: [{ id: 1, name: "tag-1", operation: 3 }] },
    }));
  });

  it("handles 20000 sibling update receipts with bounded upstream batches", async () => {
    vi.clearAllMocks();
    const children = Array.from({ length: 20000 }, (_, i) => ({ ...node(i + 2), verb: "update" as const, sort: i }));
    const parent = node(1, children);
    mocks.findMany.mockResolvedValue([parent, ...children]);
    mocks.request.mockImplementation(async (_path, { body }) => ({ tags: body.tags }));
    const result = await syncTagsToMuseDAM({ team: { id: 7, slug: "t/77" }, tagsTree: [parent] });
    expect(mocks.request).toHaveBeenCalledTimes(21);
    expect(result.tags[0].children).toHaveLength(20000);
    expect(result.tags[0].children?.[19999]).toMatchObject({ id: 20001, sort: 19999 });
    for (const [, { body }] of mocks.request.mock.calls)
      expect(body.tags[0].children.length).toBeLessThanOrEqual(999);
  });

  it("creates a root tag without submitting existing tags", () => {
    const draft: TagNode = { slug: null, name: "", tempId: "temp_new", children: [] };
    expect(buildTagNameChange([node(1), draft], "temp_new", "新标签")).toEqual([
      { slug: null, name: "新标签", tempId: "temp_new", verb: "create", children: [] },
    ]);
  });

  it("renames a parent without submitting descendants or sibling changes", () => {
    const target = node(2, [node(3)]);
    const tree = [node(1, [target, { ...node(4), verb: "delete" as const }]), node(5)];
    const change = buildTagNameChange(tree, "2", "新名称");
    expect(change).toEqual([
      {
        id: 1,
        slug: tree[0].slug,
        name: "tag-1",
        children: [
          {
            id: 2,
            slug: target.slug,
            name: "新名称",
            verb: "update",
            children: [],
          },
        ],
      },
    ]);
    expect(target.name).toBe("tag-2");
    expect(target.children).toHaveLength(1);
    expect(buildTagNameChange(tree, "missing", "名称")).toEqual([]);
  });

  it("keeps the save payload small for a tag tree exceeding the failed request size", () => {
    const tree = [
      node(
        1,
        Array.from({ length: 20000 }, (_, i) => node(i + 2)),
      ),
    ];
    expect(Buffer.byteLength(JSON.stringify(tree))).toBeGreaterThan(1538481);
    const change = buildTagNameChange(tree, "10000", "新名称");
    expect(Buffer.byteLength(JSON.stringify(change))).toBeLessThan(1024);
    expect(change[0].children[0].id).toBe(10000);
  });

  it("sends only the ancestor path and new child to merge-tags and maps the returned ID", async () => {
    const parent = node(10);
    const draft: TagNode = { slug: null, name: "", tempId: "temp_new", children: [] };
    mocks.findMany.mockResolvedValue([parent]);
    mocks.request.mockImplementation(async (path, { body }) => {
      if (path === "/api/muse/query-tag-tree") {
        return [{ id: 10, name: parent.name, children: [] }];
      }
      return { tags: [{ ...body.tags[0], children: [{ ...body.tags[0].children[0], id: 20 }] }] };
    });
    const result = await syncTagsToMuseDAM({
      team: { id: 1, slug: idToSlug("team", MuseDAMID.from(77)) },
      tagsTree: buildTagNameChange(
        [node(99), { ...parent, children: [node(11), draft] }],
        "temp_new",
        "新标签",
      ),
    });
    const merge = mocks.request.mock.calls.find(([path]) => path === "/api/muse/merge-tags");
    expect(merge?.[1].body.tags).toEqual([
      {
        id: 10,
        name: parent.name,
        operation: 0,
        children: [{ name: "新标签", operation: 2 }],
      },
    ]);
    expect(result.createdTagMapping.get("temp_new")?.toString()).toBe("20");
  });
});
