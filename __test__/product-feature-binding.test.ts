import { collectMuseFeatureIdentifierIdsForQueueItem } from "@/musedam/collect-muse-feature-identifier-ids";
import type { TaggingProductBestMatch, TaggingProductRecommendation } from "@/prisma/client";
import { describe, expect, it } from "vitest";

function match(
  assetProductId: string,
  confidence: number,
  tagIds: number[],
  detectionIndex = 0,
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
    detectionIndex,
    recommendedTags: tagIds.map((assetTagId) => ({ assetTagId, tagPath: [String(assetTagId)] })),
  };
}

function bindProducts(
  productRecommendation: TaggingProductRecommendation,
  productTagIds: number[],
) {
  return collectMuseFeatureIdentifierIdsForQueueItem({
    brandRecommendation: null,
    ipRecommendation: null,
    productRecommendation,
    personRecommendation: null,
    brandTagIds: [],
    ipTagIds: [],
    productTagIds,
    personTagIds: [],
  });
}

describe("product feature identifier binding", () => {
  it("binds every accepted product whose own tags were applied and deduplicates repeated boxes", () => {
    expect(
      bindProducts(
        {
          noConfidentMatch: false,
          bestMatch: null,
          matches: [
            match("phone", 92, [10]),
            match("headphones", 85, [20], 1),
            match("phone", 90, [10], 2),
            match("bottle", 79, [30], 3),
          ],
          recommendedTags: [],
        },
        [10, 20, 30],
      ),
    ).toEqual(["phone", "headphones"]);
  });

  it("does not bind another accepted product because an aggregate tag overlaps", () => {
    expect(
      bindProducts(
        {
          noConfidentMatch: false,
          bestMatch: match("phone", 92, [10]),
          matches: [match("phone", 92, [10]), match("headphones", 85, [20], 1)],
          recommendedTags: [{ assetTagId: 10, tagPath: ["Phone tag"] }],
        },
        [10],
      ),
    ).toEqual(["phone"]);
  });

  it("binds two accepted features sharing a tag, but excludes weak features sharing that tag", () => {
    expect(
      bindProducts(
        {
          noConfidentMatch: false,
          bestMatch: null,
          matches: [
            match("phone", 92, [10]),
            match("headphones", 80, [10], 1),
            match("weak", 79, [10], 2),
          ],
          recommendedTags: [],
        },
        [10],
      ),
    ).toEqual(["phone", "headphones"]);
  });

  it("does not fall back to a legacy alias when matches is explicitly empty", () => {
    expect(
      bindProducts(
        {
          noConfidentMatch: true,
          bestMatch: match("legacy", 95, [10]),
          matches: [],
          recommendedTags: [{ assetTagId: 10, tagPath: ["Old tag"] }],
        },
        [10],
      ),
    ).toEqual([]);
  });

  it("supports historical single-product results with tags stored only at the top level", () => {
    expect(
      bindProducts(
        {
          noConfidentMatch: false,
          bestMatch: match("legacy", 95, []),
          recommendedTags: [{ assetTagId: 10, tagPath: ["Old tag"] }],
        },
        [10],
      ),
    ).toEqual(["legacy"]);
  });
});
