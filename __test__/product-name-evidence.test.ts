// @vitest-environment node
import { findProductNameMatches } from "@/lib/product/product-name-evidence";
import { beforeEach, expect, it, vi } from "vitest";
const products = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: { assetProduct: { findMany: products } } }));
beforeEach(() => vi.resetAllMocks());
it("finds the reported filename identity with tag associations and no invented detection region", async () => {
  products.mockResolvedValue([
    {
      id: "415",
      name: "赫妍魅感裸透镜彩唇釉 415",
      productTypeId: null,
      productTypeName: "主推产品",
      description: "",
      generalCategory: "lip gloss",
      tags: [{ id: "t1", assetTagId: 3196, tagPath: ["产品品类", "唇妆"] }],
    },
  ]);
  const matches = await findProductNameMatches(1, "赫妍魅感裸透镜彩唇釉415_试色图");
  expect(matches).toEqual([
    expect.objectContaining({
      assetProductId: "415",
      matchingSource: "assetName",
      confidence: 100,
      detectionIndex: -1,
      detectionIndices: [],
      imageSimilarity: 0,
      recommendedTags: [{ id: "t1", assetTagId: 3196, tagPath: ["产品品类", "唇妆"] }],
    }),
  ]);
  expect(products).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { teamId: 1, enabled: true, status: "completed" },
      select: expect.objectContaining({
        tags: expect.objectContaining({
          where: { assetTag: { teamId: 1, deletedAt: null } },
        }),
      }),
    }),
  );
});
it("does not load the catalog when filename evidence is disabled", async () => {
  expect(await findProductNameMatches(1, undefined)).toEqual([]);
  expect(products).not.toHaveBeenCalled();
});
