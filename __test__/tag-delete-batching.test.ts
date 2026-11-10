// @vitest-environment node
import { buildCascadeDeletionTree, buildTagDeletionPlan } from "@/app/tags/delete-tag-plan";
import { mergeTagsInBatches, type MergeTag } from "@/musedam/tags/mergeTagsInBatches";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  request: vi.fn(async (_path, { body }) => ({ tags: body.tags })),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: state.request }));
it("submits one root deletion for a 20000-node subtree", async () => {
  const rows = Array.from({ length: 20000 }, (_, i) => ({
    id: i + 1,
    name: String(i),
    slug: String(i),
    sort: 0,
    level: i ? 2 : 1,
    parentId: i ? 1 : null,
  }));
  const legacy: MergeTag[] = rows.slice(1).map((row) => ({
    id: 1,
    name: "0",
    operation: 0,
    children: [{ id: row.id, name: row.name, operation: 3 }],
  }));
  legacy.push({ id: 1, name: "0", operation: 3 });
  await mergeTagsInBatches(legacy, "test-only");
  const before = state.request.mock.calls.length;
  state.request.mockClear();
  const convert = (nodes: ReturnType<typeof buildCascadeDeletionTree>): MergeTag[] =>
    nodes.map((node) => ({
      id: node.id,
      name: node.name,
      operation: node.verb === "delete" ? 3 : 0,
      children: convert(node.children),
    }));
  await mergeTagsInBatches(
    convert(buildCascadeDeletionTree(rows, buildTagDeletionPlan(rows, 1))),
    "test-only",
  );
  const after = state.request.mock.calls.length;
  const operations = state.request.mock.calls.flatMap(([, { body }]) => {
    const flatten = (nodes: MergeTag[]): number[] =>
      nodes.flatMap((node) => [
        ...(node.operation === 3 ? [node.id!] : []),
        ...flatten(node.children ?? []),
      ]);
    return flatten(body.tags);
  });
  expect(operations).toEqual([1]);
  expect(after).toBe(1);
  expect(before).toBe(40);
  console.log("DELETE_REQUEST_COUNTS", { nodes: rows.length, before, after });
});
