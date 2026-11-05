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
import type { MergeTag } from "@/musedam/tags/mergeTagsInBatches";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";

it("maps every tempId to the returned remote ID across a split four-level import", async () => {
  let nextId = 1;
  const remoteIds = new Map<string, number>();
  const respond = (tags: MergeTag[]): MergeTag[] =>
    tags.map((tag) => {
      const id = tag.id ?? nextId++;
      if (tag.operation === 2) remoteIds.set(tag.name, id);
      return { ...tag, id, ...(tag.children ? { children: respond(tag.children) } : {}) };
    });
  mocks.request.mockImplementation(async (_path, { body }) => ({ tags: respond(body.tags) }));
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
          Array.from({ length: 250 }, (_, i) => leaf(`item-${i}`)),
        ),
      ]),
    ]),
  ];
  const result = await syncTagsToMuseDAM({ team: { id: 1, slug: "team" }, tagsTree });
  expect(mocks.request.mock.calls.length).toBeGreaterThan(1);
  expect(result.createdTagMapping.size).toBe(253);
  for (const [name, id] of remoteIds) {
    expect(result.createdTagMapping.get(`temp-${name}`)?.toString()).toBe(String(id));
  }
});
