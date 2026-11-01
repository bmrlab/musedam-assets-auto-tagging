import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getBrandRecommendationTagIdsFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { getIpRecommendationTagIdsFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import { getProductRecommendationTagIdsFromQueueResult } from "@/app/(tagging)/product-recommendation";
import { createBatchTagsTreeLoader } from "@/app/(tagging)/queue";
import { FEATURE_CONFIDENCE_MIN } from "@/lib/tagging/feature-confidence";
import type { TaggingProductBestMatch } from "@/prisma/client";

vi.mock("@/prisma/prisma", () => ({ default: {} }));

function recommendation(confidence: number) {
  return {
    bestMatch: { confidence },
    recommendedTags: [{ assetTagId: 10 }, { assetTagId: 11 }],
  };
}

function productMatch(
  assetProductId: string,
  confidence: number,
  tagIds: number[],
): TaggingProductBestMatch {
  return {
    assetProductId,
    productName: assetProductId,
    productTypeId: null,
    productTypeName: "Product",
    description: "",
    generalCategory: "",
    confidence,
    similarity: confidence / 100,
    imageSimilarity: confidence / 100,
    descriptionSimilarity: 0,
    detectionIndex: 0,
    recommendedTags: tagIds.map((assetTagId) => ({ assetTagId, tagPath: [String(assetTagId)] })),
  };
}

describe("direct mode feature-library thresholds (shared with review path)", () => {
  it("brand: below threshold yields no tag ids, at threshold yields them", () => {
    const min = FEATURE_CONFIDENCE_MIN.brand;
    expect(
      getBrandRecommendationTagIdsFromQueueResult({ brandRecommendation: recommendation(min - 1) }),
    ).toEqual([]);
    expect(
      getBrandRecommendationTagIdsFromQueueResult({ brandRecommendation: recommendation(min) }),
    ).toEqual([10, 11]);
  });

  it("ip: below threshold yields no tag ids, at threshold yields them", () => {
    const min = FEATURE_CONFIDENCE_MIN.ip;
    expect(
      getIpRecommendationTagIdsFromQueueResult({ ipRecommendation: recommendation(min - 1) }),
    ).toEqual([]);
    expect(
      getIpRecommendationTagIdsFromQueueResult({ ipRecommendation: recommendation(min) }),
    ).toEqual([10, 11]);
  });

  it("product: below threshold yields no tag ids, at threshold yields them", () => {
    const min = FEATURE_CONFIDENCE_MIN.product;
    expect(
      getProductRecommendationTagIdsFromQueueResult({
        productRecommendation: {
          ...recommendation(min - 1),
          bestMatch: productMatch("legacy-product", min - 1, []),
        },
      }),
    ).toEqual([]);
    expect(
      getProductRecommendationTagIdsFromQueueResult({
        productRecommendation: {
          ...recommendation(min),
          bestMatch: productMatch("legacy-product", min, []),
        },
      }),
    ).toEqual([10, 11]);
  });

  it("unions each accepted product's own tags using its own confidence", () => {
    expect(
      getProductRecommendationTagIdsFromQueueResult({
        productRecommendation: {
          noConfidentMatch: false,
          bestMatch: productMatch("weak-alias", 50, [99]),
          matches: [
            productMatch("phone", 92, [10, 11]),
            productMatch("headphones", 80, [11, 12]),
            productMatch("bottle", 79, [13]),
          ],
          recommendedTags: [{ assetTagId: 999, tagPath: ["Unrelated aggregate tag"] }],
        },
      }),
    ).toEqual([10, 11, 12]);
  });

  it("does not resurrect a legacy bestMatch when the matches array is empty", () => {
    expect(
      getProductRecommendationTagIdsFromQueueResult({
        productRecommendation: {
          bestMatch: productMatch("legacy-product", 95, [10]),
          matches: [],
          recommendedTags: [{ assetTagId: 10 }],
        },
      }),
    ).toEqual([]);
  });

  it("does not use aggregate tags for a new accepted product without linked tags", () => {
    expect(
      getProductRecommendationTagIdsFromQueueResult({
        productRecommendation: {
          matches: [productMatch("phone", 92, [])],
          recommendedTags: [{ assetTagId: 99 }],
        },
      }),
    ).toEqual([]);
  });

  it("null recommendation yields no tag ids", () => {
    expect(getBrandRecommendationTagIdsFromQueueResult({ brandRecommendation: null })).toEqual([]);
  });
});

describe("createBatchTagsTreeLoader", () => {
  it("loads each team's tag tree once per batch, even under concurrent calls", async () => {
    const load = vi.fn(async (teamId: number) => [{ id: teamId, name: `t${teamId}`, extra: null }]);
    const loader = createBatchTagsTreeLoader(load);

    const [a, b, c] = await Promise.all([loader(1), loader(1), loader(2)]);

    expect(load).toHaveBeenCalledTimes(2);
    expect(a).toBe(b);
    expect(c[0].id).toBe(2);
  });

  it("does not cache a failed load, so the next call retries", async () => {
    let calls = 0;
    const load = vi.fn(async (teamId: number) => {
      calls++;
      if (calls === 1) throw new Error("db down");
      return [{ id: teamId, name: "ok", extra: null }];
    });
    const loader = createBatchTagsTreeLoader(load);

    await expect(loader(1)).rejects.toThrow("db down");
    await expect(loader(1)).resolves.toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
