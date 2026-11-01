// @vitest-environment node

import type { ProductTopMatch } from "@/lib/product/product-classification";
import { classifyAssetProductRecommendation } from "@/lib/product/tagging-product-classification";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  detect: vi.fn(),
  classify: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: { productVector: { count: mocks.count } } }));
vi.mock("@/lib/product/product-classification", () => ({
  detectProductFigureBoxes: mocks.detect,
  classifyProductImageRegions: mocks.classify,
}));

const imageInput = {
  width: 100,
  height: 100,
  mimeType: "image/jpeg",
  byteLength: 1,
  buffer: Buffer.from([0]),
  dataUrl: "data:image/jpeg;base64,AA==",
};
function box(index: number) {
  return { xMin: index, yMin: 0, xMax: index + 1, yMax: 10, score: 0.9, label: "product" };
}
function match(
  id: string,
  confidence: number,
  tagIds: number[],
  detectionIndex = 0,
): ProductTopMatch {
  return {
    assetProductId: id,
    productName: id,
    productTypeId: null,
    productTypeName: "Products",
    description: "",
    generalCategory: "phone",
    similarity: confidence / 100,
    confidence,
    detectionIndex,
    imageSimilarity: confidence / 100,
    descriptionSimilarity: 0,
    recommendedTags: tagIds.map((assetTagId) => ({
      id: `tag-${assetTagId}`,
      assetTagId,
      tagPath: [String(assetTagId)],
    })),
  };
}

describe("automatic product recommendations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.count.mockResolvedValue(1);
  });

  it("passes every detector box to classification and unions only accepted products' tags", async () => {
    const boxes = Array.from({ length: 12 }, (_, index) => box(index));
    const first = { ...match("phone", 92, [1, 2]), detectionIndices: [0, 2] };
    const second = { ...match("headphones", 85, [2, 3], 1), detectionIndices: [1] };
    const weak = match("bottle", 74, [4], 3);
    mocks.detect.mockResolvedValue({ detections: boxes, found: true });
    mocks.classify.mockResolvedValue({
      matches: [first, second],
      bestMatch: first,
      topMatches: [first, second, weak],
      noConfidentMatch: false,
      winningDetectionIndex: 0,
      rawDetections: boxes,
      detections: [first, second, weak].map((candidate) => ({
        box: boxes[candidate.detectionIndex],
        detectionIndex: candidate.detectionIndex,
        sourceDetectionIndices: [candidate.detectionIndex],
        bestMatch: candidate,
        topMatches: [candidate],
        noConfidentMatch: candidate.confidence < 80,
      })),
    });
    const result = await classifyAssetProductRecommendation({ teamId: 7, imageInput });
    expect(mocks.classify).toHaveBeenCalledExactlyOnceWith({
      teamId: 7,
      imageInput,
      boxes,
    });
    expect(result?.rawDetections).toEqual(boxes);
    expect(result?.matches?.map((candidate) => candidate.assetProductId)).toEqual([
      "phone",
      "headphones",
    ]);
    expect(result?.recommendedTags.map((tag) => tag.assetTagId)).toEqual([1, 2, 3]);
    expect(result?.matches?.[1].recommendedTags.map((tag) => tag.assetTagId)).toEqual([2, 3]);
    expect(result?.detections?.[2].bestMatch?.assetProductId).toBe("bottle");
  });

  it("persists raw boxes and group provenance when duplicate detections consolidate", async () => {
    const boxes = [box(0), box(10), { ...box(0), label: "cosmetics" }];
    const accepted = { ...match("phone", 92, [1]), detectionIndices: [0, 2] };
    mocks.detect.mockResolvedValue({ detections: boxes, found: true });
    mocks.classify.mockResolvedValue({
      matches: [accepted],
      bestMatch: accepted,
      topMatches: [accepted],
      noConfidentMatch: false,
      winningDetectionIndex: 0,
      rawDetections: boxes,
      detections: [
        {
          box: boxes[0],
          detectionIndex: 0,
          sourceDetectionIndices: [0, 2],
          bestMatch: accepted,
          topMatches: [accepted],
          noConfidentMatch: false,
        },
      ],
    });

    const result = await classifyAssetProductRecommendation({ teamId: 7, imageInput });

    expect(mocks.classify).toHaveBeenCalledExactlyOnceWith({ teamId: 7, imageInput, boxes });
    expect(result?.rawDetections).toEqual(boxes);
    expect(result?.detections).toHaveLength(1);
    expect(result?.detections?.[0].sourceDetectionIndices).toEqual([0, 2]);
    expect(result?.matches?.[0].detectionIndices).toEqual([0, 2]);
  });

  it("keeps low candidates diagnostic-only when no product qualifies", async () => {
    const weak = match("bottle", 74, [4]);
    mocks.detect.mockResolvedValue({ detections: [], found: false });
    mocks.classify.mockResolvedValue({
      matches: [],
      bestMatch: weak,
      topMatches: [weak],
      detections: [],
      noConfidentMatch: true,
      winningDetectionIndex: 0,
    });
    const result = await classifyAssetProductRecommendation({ teamId: 7, imageInput });
    expect(result).toMatchObject({ matches: [], recommendedTags: [], noConfidentMatch: true });
    expect(result?.bestMatch?.assetProductId).toBe("bottle");
    expect(mocks.classify).toHaveBeenCalledExactlyOnceWith({
      teamId: 7,
      imageInput,
      boxes: [
        {
          xMin: 0,
          yMin: 0,
          xMax: imageInput.width,
          yMax: imageInput.height,
          score: 1,
          label: "whole image fallback",
        },
      ],
    });
  });

  it("skips detection when there are no completed product reference vectors", async () => {
    mocks.count.mockResolvedValue(0);
    expect(await classifyAssetProductRecommendation({ teamId: 7, imageInput })).toBeNull();
    expect(mocks.detect).not.toHaveBeenCalled();
  });
});
