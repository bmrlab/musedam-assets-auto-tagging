import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: mocks.request }));

import {
  MERGE_TAG_BATCH_SIZE,
  mergeTagsInBatches,
  type MergeTag,
} from "@/musedam/tags/mergeTagsInBatches";

const leaf = (name: string): MergeTag => ({ name, operation: 2 });
const count = (nodes: MergeTag[]): number =>
  nodes.reduce((n, node) => n + 1 + count(node.children ?? []), 0);

beforeEach(() => {
  vi.resetAllMocks();
  let nextId = 1;
  const respond = (nodes: MergeTag[]): MergeTag[] =>
    nodes.map((node) => ({
      ...node,
      id: node.id ?? nextId++,
      sort: node.sort ?? 10,
      ...(node.children ? { children: respond(node.children) } : {}),
    }));
  mocks.request.mockImplementation(async (_path, { body }) => ({ tags: respond(body.tags) }));
});

describe("mergeTagsInBatches", () => {
  it("keeps small trees in a single request and preserves response IDs and sort", async () => {
    const tags = [{ ...leaf("group"), children: [leaf("child")] }];
    const result = await mergeTagsInBatches(tags, "key");
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith("/api/muse/merge-tags", {
      method: "POST",
      headers: { Authorization: "Bearer key" },
      body: { tags },
    });
    expect(result.tags[0]).toMatchObject({ id: 1, sort: 10, children: [{ id: 2, sort: 10 }] });
  });

  it("splits a 4270-tag group and reuses the created parent without creating it again", async () => {
    const children = Array.from({ length: 4270 }, (_, i) => leaf(`SKU-${i}`));
    const result = await mergeTagsInBatches([{ ...leaf("SKU"), children }], "key");
    const requests = mocks.request.mock.calls.map(([, options]) => options.body.tags as MergeTag[]);
    expect(requests.length).toBeGreaterThan(40);
    for (const request of requests)
      expect(count(request)).toBeLessThanOrEqual(MERGE_TAG_BATCH_SIZE);
    expect(requests[0]).toEqual([leaf("SKU")]);
    for (const request of requests.slice(1)) {
      expect(request[0]).toMatchObject({ name: "SKU", id: 1, operation: 0 });
    }
    expect(result.tags[0].children?.map((tag) => tag.name)).toEqual(
      children.map((tag) => tag.name),
    );
    expect(new Set(result.tags[0].children?.map((tag) => tag.id)).size).toBe(4270);
    // The caller's tree must remain available for tempId mapping.
    expect(children[0].id).toBeUndefined();
  });

  it("preserves four levels and same-name children under different parents", async () => {
    const tags: MergeTag[] = [
      {
        id: 900,
        name: "root",
        operation: 0,
        children: [
          {
            ...leaf("A"),
            children: [
              { ...leaf("same"), children: Array.from({ length: 120 }, (_, i) => leaf(`${i}`)) },
            ],
          },
          { ...leaf("B"), children: [{ ...leaf("same"), children: [leaf("last")] }] },
        ],
      },
    ];
    const result = await mergeTagsInBatches(tags, "key");
    const a = result.tags[0].children![0];
    const b = result.tags[0].children![1];
    expect(a.children![0].children).toHaveLength(120);
    expect(b.children![0].children![0].name).toBe("last");
    expect(a.children![0].id).not.toBe(b.children![0].id);
    for (const [, options] of mocks.request.mock.calls) {
      expect(count(options.body.tags)).toBeLessThanOrEqual(MERGE_TAG_BATCH_SIZE);
    }
  });

  it("splits root deletions without changing their operations", async () => {
    const tags: MergeTag[] = Array.from({ length: 201 }, (_, i) => ({
      id: i + 1,
      name: `${i}`,
      operation: 3,
    }));
    const result = await mergeTagsInBatches(tags, "key");
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(result.tags.map((tag) => tag.id)).toEqual(tags.map((tag) => tag.id));
    expect(result.tags.every((tag) => tag.operation === 3)).toBe(true);
  });

  it("stops on a failed batch without automatically retrying creates", async () => {
    mocks.request.mockRejectedValueOnce(new Error("upstream timeout"));
    await expect(
      mergeTagsInBatches(
        Array.from({ length: 201 }, (_, i) => leaf(`${i}`)),
        "key",
      ),
    ).rejects.toThrow("upstream timeout");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("does not submit an empty tree", async () => {
    expect(await mergeTagsInBatches([], "key")).toEqual({ tags: [] });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

it("skips unchanged subtrees and uses an existing oversized parent only as child context", async () => {
  const children = Array.from({ length: 200 }, (_, i) => leaf(`new-${i}`));
  const unchanged: MergeTag = { id: 900, name: "unchanged", operation: 0 };
  const result = await mergeTagsInBatches(
    [unchanged, { id: 901, name: "existing-parent", operation: 0, children }],
    "key",
  );
  expect(result.tags[0]).toEqual(unchanged);
  expect(mocks.request).toHaveBeenCalledTimes(3);
  for (const [, options] of mocks.request.mock.calls) {
    expect(options.body.tags).toHaveLength(1);
    expect(options.body.tags[0]).toMatchObject({ id: 901, operation: 0 });
    expect(options.body.tags[0].children.length).toBeGreaterThan(0);
  }
});
