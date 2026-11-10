import { getBrandRecommendationTagIdsFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { collectFeatureTagCandidates } from "@/app/(tagging)/exclusive-siblings";
import { getIpRecommendationTagIdsFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import {
  featureKey,
  getReviewFeatures,
  hydrateReviewFeatures,
  type ReviewFeature,
} from "@/app/(tagging)/tagging/review/feature-review";
import {
  getAcceptedBrandMatches,
  getAcceptedIpMatches,
  getBrandMatches,
} from "@/lib/feature-decision/match-policy";
import { collectMuseFeatureIdentifierIdsForQueueItem } from "@/musedam/collect-muse-feature-identifier-ids";
import type {
  TaggingBrandBestMatch,
  TaggingBrandRecommendation,
  TaggingIpBestMatch,
  TaggingIpRecommendation,
} from "@/prisma/client";
import { describe, expect, it } from "vitest";

function brand(id: string, confidence: number, tagIds: number[]): TaggingBrandBestMatch {
  return {
    assetLogoId: id,
    logoName: id,
    logoTypeId: null,
    logoTypeName: "Logo",
    confidence,
    similarity: 0.99,
    detectionIndex: 0,
    recommendedTags: tagIds.map((assetTagId) => ({ assetTagId, tagPath: [String(assetTagId)] })),
  };
}

function ip(id: string, confidence: number, tagIds: number[]): TaggingIpBestMatch {
  return {
    assetIpId: id,
    ipName: id,
    ipTypeId: null,
    ipTypeName: "IP",
    description: "Original",
    confidence,
    similarity: 0.99,
    imageSimilarity: 0.98,
    descriptionSimilarity: 0.8,
    detectionIndex: 0,
    recommendedTags: tagIds.map((assetTagId) => ({ assetTagId, tagPath: [String(assetTagId)] })),
  };
}

function brands(matches: TaggingBrandBestMatch[]): TaggingBrandRecommendation {
  return {
    noConfidentMatch: matches.length === 0,
    matches,
    bestMatch: brand("embedding-winner", 99, [999]),
    recommendedTags: [{ assetTagId: 999, tagPath: ["Unrelated aggregate"] }],
  };
}

function ips(matches: TaggingIpBestMatch[]): TaggingIpRecommendation {
  return {
    noConfidentMatch: matches.length === 0,
    matches,
    bestMatch: ip("embedding-winner", 99, [999]),
    recommendedTags: [{ assetTagId: 999, tagPath: ["Unrelated aggregate"] }],
  };
}

describe("final logo and IP match policy", () => {
  it("never revives a high-scoring embedding winner after an explicit no-match decision", () => {
    const source = { brandRecommendation: brands([]), ipRecommendation: ips([]) };
    expect(getAcceptedBrandMatches(source.brandRecommendation)).toEqual([]);
    expect(getAcceptedIpMatches(source.ipRecommendation)).toEqual([]);
    expect(getBrandRecommendationTagIdsFromQueueResult(source)).toEqual([]);
    expect(getIpRecommendationTagIdsFromQueueResult(source)).toEqual([]);
    expect(getReviewFeatures(source)).toEqual([]);
    expect(collectFeatureTagCandidates(source)).toEqual([]);
  });

  it("unions each accepted identity's own tags and confidence, excluding aggregate tags", () => {
    const source = {
      brandRecommendation: brands([
        brand("a", 92, [10]),
        brand("b", 60, [11]),
        brand("weak", 59, [12]),
        brand("a", 90, [10]),
      ]),
      ipRecommendation: ips([ip("x", 94, [20]), ip("y", 60, [21]), ip("weak", 59, [22])]),
    };
    expect(getBrandRecommendationTagIdsFromQueueResult(source)).toEqual([10, 11]);
    expect(getIpRecommendationTagIdsFromQueueResult(source)).toEqual([20, 21]);
    expect(collectFeatureTagCandidates(source)).toEqual([
      { featureType: "brand", leafTagId: 10, confidence: 92 },
      { featureType: "brand", leafTagId: 11, confidence: 60 },
      { featureType: "ip", leafTagId: 20, confidence: 94 },
      { featureType: "ip", leafTagId: 21, confidence: 60 },
    ]);
    expect(getReviewFeatures(source).map((feature) => feature.id)).toEqual(["a", "b", "x", "y"]);
  });

  it("binds multiple accepted identities only when their own tags were applied", () => {
    expect(
      collectMuseFeatureIdentifierIdsForQueueItem({
        brandRecommendation: brands([brand("a", 92, [10]), brand("b", 90, [11])]),
        ipRecommendation: ips([ip("x", 94, [20]), ip("y", 81, [20]), ip("weak", 59, [20])]),
        productRecommendation: null,
        personRecommendation: null,
        brandTagIds: [10, 999],
        ipTagIds: [20],
        productTagIds: [],
        personTagIds: [],
      }),
    ).toEqual(["a", "x", "y"]);
    expect(
      collectMuseFeatureIdentifierIdsForQueueItem({
        brandRecommendation: brands([]),
        ipRecommendation: ips([]),
        productRecommendation: null,
        personRecommendation: null,
        brandTagIds: [999],
        ipTagIds: [999],
        productTagIds: [],
        personTagIds: [],
      }),
    ).toEqual([]);
  });

  it("hydrates every accepted identity independently while preserving classification evidence", () => {
    const features = new Map<string, ReviewFeature>([
      [
        featureKey("brand", "a"),
        {
          featureType: "brand",
          id: "a",
          name: "Current A",
          typeId: null,
          typeName: "Current",
          tags: [{ assetTagId: 30, tagPath: ["A current"] }],
        },
      ],
      [
        featureKey("ip", "x"),
        {
          featureType: "ip",
          id: "x",
          name: "Current X",
          typeId: null,
          typeName: "Current",
          description: "Current description",
          tags: [{ assetTagId: 40, tagPath: ["X current"] }],
        },
      ],
      [
        featureKey("ip", "y"),
        {
          featureType: "ip",
          id: "y",
          name: "Current Y",
          typeId: null,
          typeName: "Current",
          tags: [],
        },
      ],
    ]);
    const source = {
      brandRecommendation: brands([brand("a", 92, [10]), brand("deleted", 95, [11])]),
      ipRecommendation: ips([ip("x", 94, [20]), ip("y", 80, [21])]),
    };
    const result = hydrateReviewFeatures(source, features);
    expect(result.brandRecommendation?.matches).toEqual([
      expect.objectContaining({
        assetLogoId: "a",
        logoName: "Current A",
        confidence: 92,
        similarity: 0.99,
      }),
    ]);
    expect(result.ipRecommendation?.matches?.map((match) => match.ipName)).toEqual([
      "Current X",
      "Current Y",
    ]);
    expect(result.ipRecommendation?.recommendedTags).toEqual([
      { assetTagId: 40, tagPath: ["X current"] },
    ]);
    expect(source.brandRecommendation.matches).toHaveLength(2);
    const empty = hydrateReviewFeatures(
      { brandRecommendation: brands([]), ipRecommendation: ips([]) },
      features,
    );
    expect(empty.brandRecommendation?.matches).toEqual([]);
    expect(empty.brandRecommendation?.bestMatch).toBeNull();
    expect(getReviewFeatures(empty)).toEqual([]);
  });

  it("preserves legacy single-match results with tags stored only at recommendation level", () => {
    const legacyBrand: TaggingBrandRecommendation = {
      noConfidentMatch: true,
      bestMatch: brand("legacy", 90, []),
      recommendedTags: [{ assetTagId: 10, tagPath: ["Legacy"] }],
    };
    const legacyIp: TaggingIpRecommendation = {
      noConfidentMatch: true,
      bestMatch: ip("legacy", 90, []),
      recommendedTags: [{ assetTagId: 20, tagPath: ["Legacy"] }],
    };
    expect(
      getBrandRecommendationTagIdsFromQueueResult({ brandRecommendation: legacyBrand }),
    ).toEqual([10]);
    expect(getIpRecommendationTagIdsFromQueueResult({ ipRecommendation: legacyIp })).toEqual([20]);
    expect(getBrandMatches(legacyBrand)[0]).toMatchObject({
      referenceMatchStrategy: "highest",
      matchedReferenceImageId: null,
    });
  });
});
