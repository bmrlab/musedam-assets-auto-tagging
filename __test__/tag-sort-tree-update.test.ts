import { applySavedTagSort } from "@/app/tags/tagSort";
import type { TagNode } from "@/app/tags/types";
import { expect, it } from "vitest";
const node = (id: number, sort: number, children: TagNode[] = []): TagNode => ({
  id,
  slug: `g/${id}`,
  name: String(id),
  sort,
  children,
});
it("updates the actual sorted siblings even when the user has changed selection during saving", () => {
  const tree = [node(1, 3, [node(2, 2, [node(9, 1)]), node(3, 1)]), node(4, 2, [node(5, 1)])];
  const updated = applySavedTagSort(tree, [
    { id: 3, sort: 10 },
    { id: 2, sort: 5 },
  ]);
  expect(updated[0].children.map((item) => item.id)).toEqual([3, 2]);
  expect(updated[0].children[1].children[0].id).toBe(9);
  expect(updated[1]).toBe(tree[1]);
  expect(updated[0].children[1].children).toBe(tree[0].children[0].children);
  expect(tree[0].children.map((item) => item.id)).toEqual([2, 3]);
});
it("reuses the whole tree when none of the confirmed IDs are present", () => {
  const tree = [node(1, 1, [node(2, 1)])];
  expect(applySavedTagSort(tree, [{ id: 99, sort: 2 }])).toBe(tree);
});
it("keeps local drafts and orders the root using only confirmed sort values", () => {
  const draft: TagNode = { name: "draft", slug: null, tempId: "new", children: [] };
  const updated = applySavedTagSort(
    [node(1, 2), node(2, 1), draft],
    [
      { id: 2, sort: 100 },
      { id: 1, sort: 50 },
    ],
  );
  expect(updated.map((item) => item.id ?? item.tempId)).toEqual([2, 1, "new"]);
  expect(updated[2]).toEqual(draft);
});
