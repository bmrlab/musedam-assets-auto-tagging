import { fetchMetadataReviewAssets } from "@/app/(tagging)/tagging/review/metadata-actions";
import { defaultMetadataReviewFilters as filters } from "@/app/(tagging)/tagging/review/metadata-review-query";
import { beforeEach, expect, it, vi } from "vitest";
import { prediction } from "../development/metadata-preview/actions";
const mocks = vi.hoisted(() => ({
  groups: vi.fn(),
  rows: vi.fn(),
  context: vi.fn(),
  tags: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (fn: (c: unknown) => unknown) =>
    fn({ team: { id: 7, slug: "t/135" }, user: { id: 1 } }),
}));
vi.mock("@/app/(auth)/lib", () => ({ checkUserPermission: vi.fn() }));
vi.mock("@/musedam/metadata", () => ({
  fetchMetadataContext: mocks.context,
  fetchMetadataValues: vi.fn(),
  applyMetadataPredictions: vi.fn(),
}));
vi.mock("@/prisma/prisma", () => ({
  default: {
    $queryRaw: mocks.tags,
    metadataAuditItem: { groupBy: mocks.groups, findMany: mocks.rows },
  },
}));
vi.mock("@/app/(tagging)/tagging/settings/lib", () => ({ getTaggingSettings: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it("paginates materials and keeps their matching fields together, using one context per material", async () => {
  mocks.groups
    .mockResolvedValueOnce([{ assetObjectId: 42 }])
    .mockResolvedValueOnce([{ assetObjectId: 42 }, { assetObjectId: 43 }]);
  mocks.rows.mockResolvedValue(
    [1, 2].map((id) => ({
      id,
      assetObjectId: 42,
      status: "pending",
      fieldId: "f",
      prediction,
      assetObject: { id: 42, slug: "a/42", name: "Poster", extra: {} },
      queueItem: { createdAt: new Date() },
    })),
  );
  mocks.context.mockResolvedValue({
    enabled: true,
    fields: [{ fieldId: "f", fieldVersion: 2, options: [{ id: "a" }] }],
  });
  const result = await fetchMetadataReviewAssets(2, 40, filters);
  expect(result.total).toBe(2);
  expect(result.assets).toHaveLength(1);
  expect(result.assets[0].rows.map((r) => r.id)).toEqual([1, 2]);
  expect(result.assets[0].rows.every((r) => r.available)).toBe(true);
  expect(mocks.context).toHaveBeenCalledTimes(1);
  expect(mocks.groups.mock.calls[0][0]).toMatchObject({ where: { teamId: 7 }, skip: 40, take: 40 });
  expect(mocks.rows.mock.calls[0][0].where).toMatchObject({
    teamId: 7,
    assetObjectId: { in: [42] },
  });
});
it("does not query other asset records when the page is empty and rejects unsupported page sizes", async () => {
  mocks.groups.mockResolvedValue([]);
  expect((await fetchMetadataReviewAssets(1, 40, filters)).assets).toEqual([]);
  expect(mocks.rows).not.toHaveBeenCalled();
  await expect(fetchMetadataReviewAssets(1, 10000, filters)).rejects.toThrow("Invalid query");
});
it("searches existing tag paths with literal wildcard escaping and keeps both queries team-scoped", async () => {
  mocks.tags.mockResolvedValue([{ id: 42 }]);
  mocks.groups.mockResolvedValue([]);
  await fetchMetadataReviewAssets(1, 40, { ...filters, search: "100%_tag" });
  expect(mocks.tags.mock.calls[0][0].values).toEqual([7, "%100\\%\\_tag%"]);
  const where = mocks.groups.mock.calls[0][0].where;
  expect(where.teamId).toBe(7);
  expect(where.AND[0].OR).toContainEqual({ assetObjectId: { in: [42] } });
});
