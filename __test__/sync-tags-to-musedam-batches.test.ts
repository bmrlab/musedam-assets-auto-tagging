import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: mocks.request }));
vi.mock("@/musedam/apiKey", () => ({
  retrieveTeamCredentials: vi.fn(async () => ({ apiKey: "key" })),
}));
vi.mock("@/prisma/prisma", () => ({
  default: { assetTag: { findMany: vi.fn(async () => []), update: vi.fn() } },
}));

import type { TagNode } from "@/app/tags/types";
import { idToSlug } from "@/lib/slug";
import type { MergeTag } from "@/musedam/tags/mergeTagsInBatches";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";
import { MuseDAMID } from "@/musedam/types";

it("maps every tempId to the returned remote ID across a split four-level import", async () => {
  let nextId = 1;
  const remoteIds = new Map<string, number>();
  const respond = (tags: MergeTag[]): MergeTag[] =>
    tags.map((tag) => {
      const id = tag.id ?? nextId++;
      if (tag.operation === 2) remoteIds.set(tag.name, id);
      return { ...tag, id, ...(tag.children ? { children: respond(tag.children) } : {}) };
    });
  mocks.request.mockImplementation(async (path, { body }) =>
    path === "/api/muse/query-tag-tree" ? [] : { tags: respond(body.tags) },
  );
  const node = (name: string, children: TagNode[] = []): TagNode => ({
    name,
    slug: null,
    tempId: `temp-${name}`,
    verb: "create" as const,
    children,
  });
  function leaf(name: string): TagNode {
    return node(name);
  }
  const tagsTree = [
    node("group", [
      node("series", [
        node(
          "SKU",
          Array.from({ length: 2500 }, (_, i) => leaf(`item-${i}`)),
        ),
      ]),
    ]),
  ];
  const result = await syncTagsToMuseDAM({
    team: { id: 1, slug: idToSlug("team", MuseDAMID.from(77)) },
    tagsTree,
  });
  expect(mocks.request.mock.calls.length).toBeGreaterThan(1);
  expect(result.createdTagMapping.size).toBe(2503);
  for (const [name, id] of remoteIds) {
    expect(result.createdTagMapping.get(`temp-${name}`)?.toString()).toBe(String(id));
  }
});

it("reuses remote tags after a partial import instead of recreating duplicate names", async () => {
  mocks.request.mockClear();
  let nextId = 100;
  const respond = (tags: MergeTag[]): MergeTag[] =>
    tags.map((tag) => ({
      ...tag,
      id: tag.id ?? nextId++,
      ...(tag.children ? { children: respond(tag.children) } : {}),
    }));
  mocks.request.mockImplementation(async (path, { body }) =>
    path === "/api/muse/query-tag-tree"
      ? [{ id: 10, name: "品牌", children: [{ id: 20, name: "Logo", children: [] }] }]
      : { tags: respond(body.tags) },
  );
  const result = await syncTagsToMuseDAM({
    team: { id: 1, slug: idToSlug("team", MuseDAMID.from(77)) },
    tagsTree: [
      {
        name: "品牌",
        slug: null,
        tempId: "root",
        verb: "create",
        children: [
          { name: "Logo", slug: null, tempId: "existing", verb: "create", children: [] },
          { name: "新品", slug: null, tempId: "new", verb: "create", children: [] },
        ],
      },
    ],
  });
  const mergeCall = mocks.request.mock.calls.find(([path]) => path === "/api/muse/merge-tags")!;
  expect(mergeCall[1].body.tags[0]).toMatchObject({
    id: 10,
    operation: 0,
    children: [{ id: 20, operation: 0 }, { operation: 2 }],
  });
  expect(result.createdTagMapping.get("root")?.toString()).toBe("10");
  expect(result.createdTagMapping.get("existing")?.toString()).toBe("20");
  expect(result.createdTagMapping.get("new")?.toString()).toBe("100");
});

it("uses existing remote IDs directly without a merge request when all imported paths exist", async () => {
  mocks.request.mockClear();
  mocks.request.mockResolvedValue([
    { id: 10, name: "品牌", sort: 8, children: [{ id: 20, name: "Logo", sort: 7, children: [] }] },
  ]);
  const result = await syncTagsToMuseDAM({
    team: { id: 1, slug: idToSlug("team", MuseDAMID.from(77)) },
    tagsTree: [
      {
        name: "品牌",
        slug: null,
        tempId: "root",
        verb: "create",
        children: [{ name: "Logo", slug: null, tempId: "child", verb: "create", children: [] }],
      },
    ],
  });
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(mocks.request.mock.calls[0][0]).toBe("/api/muse/query-tag-tree");
  expect(result.createdTagMapping.get("root")?.toString()).toBe("10");
  expect(result.createdTagMapping.get("child")?.toString()).toBe("20");
  expect(result.tags[0]).toMatchObject({ id: 10, sort: 8, children: [{ id: 20, sort: 7 }] });
});

it("does not reuse a same-name tag under a different parent", async () => {
  mocks.request.mockClear();
  const respond = (tags: MergeTag[]): MergeTag[] =>
    tags.map((tag) => ({
      ...tag,
      id: tag.id ?? 100,
      ...(tag.children ? { children: respond(tag.children) } : {}),
    }));
  mocks.request.mockImplementation(async (path, { body }) =>
    path === "/api/muse/query-tag-tree"
      ? [
          { id: 10, name: "品牌A", children: [{ id: 20, name: "Logo", children: [] }] },
          { id: 30, name: "品牌B", children: [] },
        ]
      : { tags: respond(body.tags) },
  );
  const result = await syncTagsToMuseDAM({
    team: { id: 1, slug: idToSlug("team", MuseDAMID.from(77)) },
    tagsTree: [
      {
        name: "品牌B",
        slug: null,
        tempId: "root",
        verb: "create",
        children: [{ name: "Logo", slug: null, tempId: "child", verb: "create", children: [] }],
      },
    ],
  });
  expect(result.createdTagMapping.get("root")?.toString()).toBe("30");
  expect(result.createdTagMapping.get("child")?.toString()).toBe("100");
  expect(mocks.request.mock.calls[1][1].body.tags[0].children[0].operation).toBe(2);
});

it("backfills a reused remote ID on an existing local tag without destructive reconciliation", async () => {
  const { default: prisma } = await import("@/prisma/prisma");
  vi.mocked(prisma.assetTag.update).mockClear();
  mocks.request.mockClear();
  mocks.request.mockResolvedValue([{ id: 10, name: "品牌", sort: 8, children: [] }]);
  const result = await syncTagsToMuseDAM({
    team: { id: 1, slug: "t/77" },
    tagsTree: [
      { id: 1, name: "品牌", slug: null, verb: "update", tempId: "existing", children: [] },
    ],
  });
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(result.createdTagMapping.get("existing")?.toString()).toBe("10");
  expect(prisma.assetTag.update).toHaveBeenCalledWith({
    where: { deletedAt: null, id: 1, teamId: 1 },
    data: { slug: "g/10" },
  });
});
