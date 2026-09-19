import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  collectFeatureTagCandidates,
  isContentInferredOnly,
  resolveExclusiveSiblingsAcrossSources,
} from "@/app/(tagging)/exclusive-siblings";
import { TagWithScore } from "@/app/(tagging)/types";
import { TaggingProductRecommendation, TagWithChildren } from "@/prisma/client";

// 客户案例结构：品牌产品线（互斥）> 雪花秀 / 悦诗风吟 > 系列
const tagsTree: TagWithChildren[] = [
  {
    id: 100,
    name: "品牌产品线",
    extra: { siblingsExclusive: true },
    children: [
      {
        id: 101,
        name: "雪花秀",
        extra: {},
        children: [{ id: 102, name: "人参系列", extra: {} }],
      },
      {
        id: 111,
        name: "悦诗风吟",
        extra: {},
        children: [{ id: 112, name: "洁面", extra: {} }],
      },
    ],
  },
  {
    id: 200,
    name: "渠道触点",
    extra: { siblingsExclusive: false },
    children: [
      { id: 201, name: "抖音", extra: {} },
      { id: 202, name: "天猫", extra: {} },
    ],
  },
];

const inferred = (leafTagId: number, tagPath: string[], score: number): TagWithScore => ({
  leafTagId,
  tagPath,
  confidenceBySources: { contentAnalysis: score / 100 },
  score,
});
const anchored = (leafTagId: number, tagPath: string[], score: number): TagWithScore => ({
  leafTagId,
  tagPath,
  confidenceBySources: { basicInfo: 0.9, contentAnalysis: 0.8 },
  score,
});

describe("isContentInferredOnly", () => {
  it("is true only when contentAnalysis is the sole source", () => {
    expect(isContentInferredOnly(inferred(1, [], 80))).toBe(true);
    expect(isContentInferredOnly(anchored(1, [], 80))).toBe(false);
    expect(
      isContentInferredOnly({ leafTagId: 1, tagPath: [], confidenceBySources: {}, score: 0 }),
    ).toBe(false);
  });
});

describe("resolveExclusiveSiblingsAcrossSources", () => {
  it("drops an AI-inferred sibling when the feature library hit another branch of an exclusive group", () => {
    const result = resolveExclusiveSiblingsAcrossSources({
      tagsTree,
      tagsWithScore: [
        inferred(112, ["品牌产品线", "悦诗风吟", "洁面"], 94),
        inferred(201, ["渠道触点", "抖音"], 90),
      ],
      featureCandidates: [{ leafTagId: 101, confidence: 85, featureType: "product" }],
    });
    expect(result.tagsWithScore.map((tag) => tag.leafTagId)).toEqual([201]);
    expect(result.dropped).toEqual([
      expect.objectContaining({
        leafTagId: 112,
        winnerLeafTagId: 101,
        reason: "feature-over-inferred",
      }),
    ]);
  });

  it("keeps a text-anchored AI sibling unless the feature confidence is higher", () => {
    const keep = resolveExclusiveSiblingsAcrossSources({
      tagsTree,
      tagsWithScore: [anchored(112, ["品牌产品线", "悦诗风吟", "洁面"], 94)],
      featureCandidates: [{ leafTagId: 101, confidence: 85, featureType: "brand" }],
    });
    expect(keep.tagsWithScore.map((tag) => tag.leafTagId)).toEqual([112]);
    expect(keep.dropped).toEqual([]);

    const drop = resolveExclusiveSiblingsAcrossSources({
      tagsTree,
      tagsWithScore: [anchored(112, ["品牌产品线", "悦诗风吟", "洁面"], 80)],
      featureCandidates: [{ leafTagId: 101, confidence: 99, featureType: "brand" }],
    });
    expect(drop.tagsWithScore).toEqual([]);
    expect(drop.dropped[0]?.reason).toBe("feature-higher-score");
  });

  it("leaves AI tags in the same branch as the feature hit, and non-exclusive groups, untouched", () => {
    const tags = [
      inferred(102, ["品牌产品线", "雪花秀", "人参系列"], 96),
      inferred(202, ["渠道触点", "天猫"], 70),
    ];
    const result = resolveExclusiveSiblingsAcrossSources({
      tagsTree,
      tagsWithScore: tags,
      featureCandidates: [
        { leafTagId: 101, confidence: 90, featureType: "product" },
        { leafTagId: 201, confidence: 90, featureType: "brand" },
      ],
    });
    expect(result.tagsWithScore).toEqual(tags);
  });

  it("is a no-op without feature candidates or exclusive parents", () => {
    const tags = [inferred(112, ["品牌产品线", "悦诗风吟", "洁面"], 94)];
    expect(
      resolveExclusiveSiblingsAcrossSources({
        tagsTree,
        tagsWithScore: tags,
        featureCandidates: [],
      }).tagsWithScore,
    ).toBe(tags);
    expect(
      resolveExclusiveSiblingsAcrossSources({
        tagsTree: [{ id: 1, name: "x", extra: {}, children: [] }],
        tagsWithScore: tags,
        featureCandidates: [{ leafTagId: 101, confidence: 99, featureType: "brand" }],
      }).tagsWithScore,
    ).toBe(tags);
  });
});

describe("collectFeatureTagCandidates", () => {
  it("only collects tags whose recommendation passed the feature confidence gate", () => {
    const product = (confidence: number): TaggingProductRecommendation => ({
      noConfidentMatch: false,
      bestMatch: {
        assetProductId: "p1",
        productName: "御时参养水乳套装",
        productTypeId: null,
        productTypeName: "主推产品",
        description: "",
        generalCategory: "",
        similarity: 0.7,
        confidence,
        detectionIndex: 0,
        imageSimilarity: 0.7,
        descriptionSimilarity: 0,
        recommendedTags: [],
      },
      recommendedTags: [{ assetTagId: 101, tagPath: ["品牌产品线", "雪花秀"] }],
    });
    expect(collectFeatureTagCandidates({ productRecommendation: product(90) })).toEqual([
      { leafTagId: 101, confidence: 90, featureType: "product" },
    ]);
    expect(collectFeatureTagCandidates({ productRecommendation: product(50) })).toEqual([]);
    expect(collectFeatureTagCandidates({})).toEqual([]);
  });
});
