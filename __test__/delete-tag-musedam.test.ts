import { buildCascadeDeletionTree, buildTagDeletionPlan } from "@/app/tags/delete-tag-plan";
import { idToSlug } from "@/lib/slug";
import { syncTagsToMuseDAM } from "@/musedam/tags/syncToMuseDAM";
import { MuseDAMID } from "@/musedam/types";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), request: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: { assetTag: { findMany: mocks.findMany } } }));
vi.mock("@/musedam/apiKey", () => ({
  retrieveTeamCredentials: async () => ({ apiKey: "test-key" }),
}));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: mocks.request }));

it("sends explicit third-, second-, and first-level deletions to the MuseDAM merge API", async () => {
  const rows = [1, 2, 3].map((id) => ({
    id,
    name: `tag${id}`,
    parentId: id === 1 ? null : id - 1,
    level: id,
    sort: 0,
    slug: idToSlug("assetTag", MuseDAMID.from(id + 100)),
  }));
  mocks.findMany.mockResolvedValue(rows);
  mocks.request.mockResolvedValue({ tags: [] });
  await syncTagsToMuseDAM({
    team: { id: 7, slug: "team" },
    tagsTree: buildCascadeDeletionTree(rows, buildTagDeletionPlan(rows, 1)),
  });
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith("/api/muse/merge-tags", {
    method: "POST",
    headers: { Authorization: "Bearer test-key" },
    body: {
      tags: [
        {
          id: 101,
          name: "tag1",
          operation: 0,
          sort: 0,
          children: [
            {
              id: 102,
              name: "tag2",
              operation: 0,
              sort: 0,
              children: [{ id: 103, name: "tag3", operation: 3, sort: 0 }],
            },
          ],
        },
        {
          id: 101,
          name: "tag1",
          operation: 0,
          sort: 0,
          children: [{ id: 102, name: "tag2", operation: 3, sort: 0 }],
        },
        { id: 101, name: "tag1", operation: 3, sort: 0 },
      ],
    },
  });
});
