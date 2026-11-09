import { selectProductRegionWinners } from "@/lib/product/product-match-policy";
import { rethresholdFeatures } from "@/lib/tagging/rethreshold-features";
import type { TaggingQueueItemResult } from "@/prisma/client";
import { describe, expect, it } from "vitest";
const match = (id: string, confidence: number, detectionIndex = 0, similarity = 0.9) => ({
  assetProductId: id, confidence, detectionIndex, detectionIndices: [detectionIndex], similarity,
});
const region = (index: number, ids: string[], originals = [index]) => ({
  detectionIndex: index, sourceDetectionIndices: originals,
  topMatches: ids.map(id => ({ assetProductId: id, similarity: 0.9 })),
});
describe("one product identity per source region", () => {
  it("keeps one of eight competing products, with confidence taking priority over similarity", () => {
    const candidates = Array.from({ length: 8 }, (_, index) => match(`p${index}`, 90 - index, 0, 0.8 + index / 100));
    expect(selectProductRegionWinners(candidates, [region(0, candidates.map(c => c.assetProductId))]))
      .toEqual([expect.objectContaining({ assetProductId: "p0", confidence: 90, detectionIndices: [0] })]);
  });
  it("preserves distinct products in separate regions and attributes only the winning observations", () => {
    const candidates = [match("a", 95), match("b", 90, 1), match("c", 85, 1)];
    const selected = selectProductRegionWinners(candidates, [region(0, ["a"]), region(1, ["b", "c"], [1, 3])]);
    expect(selected.map(m => [m.assetProductId, m.detectionIndices])).toEqual([["a", [0]], ["b", [1, 3]]]);
  });
  it("does not let aggregate detection indices borrow support from a different region", () => {
    const a = { ...match("a", 99), detectionIndices: [0, 1] };
    const b = match("b", 90, 1);
    const selected = selectProductRegionWinners([a, b], [region(0, ["a"]), region(1, ["b"])]);
    expect(selected.map(m => [m.assetProductId, m.detectionIndices])).toEqual([["a", [0]], ["b", [1]]]);
  });

  it("deduplicates the same winning product across several regions", () => {
    expect(selectProductRegionWinners([match("same", 90), match("same", 92, 1)], [region(0, ["same"]), region(1, ["same"])]))
      .toEqual([expect.objectContaining({ assetProductId: "same", confidence: 92, detectionIndices: [0, 1] })]);
  });
  it("uses regional similarity as a stable tie-break rather than a candidate's global maximum", () => {
    const r = region(0, ["a", "b"]);
    r.topMatches[0].similarity = 0.81; r.topMatches[1].similarity = 0.93;
    expect(selectProductRegionWinners([match("a", 90, 0, 0.99), match("b", 90, 0, 0.94)], [r])[0].assetProductId).toBe("b");
  });
  it("removes losing product predictions and candidate lists when refreshing pending history", () => {
    const productMatch = (id: string, confidence: number) => ({ ...match(id, confidence),
      productName: id, productTypeId: null, productTypeName: "Product", description: "", generalCategory: "",
      imageSimilarity: 0.9, descriptionSimilarity: 0, recommendedTags: [],
    });
    const candidates = [productMatch("winner", 92), productMatch("loser", 85)];
    const source: TaggingQueueItemResult = {
      productRecommendation: { decisionSource: "llm", matches: candidates, bestMatch: candidates[0], recommendedTags: [], noConfidentMatch: false,
        detections: [{ ...region(0, ["winner", "loser"]), topMatches: candidates, bestMatch: candidates[0], noConfidentMatch: false,
          box: { xMin: 0, yMin: 0, xMax: 100, yMax: 100, score: 1, label: "product" } }],
      },
      featureDecision: { mode: "llm", ocr: { status: "empty", segments: [] }, decision: { status: "completed", result: {
        outcome: "matched", matches: candidates.map(c => ({ candidateId: `product:${c.assetProductId}`, confidence: c.confidence,
          reason: "Product", evidence: ["retrieval"], conflicts: [], specificityLimit: null })),
      } } },
    };
    const refreshed = rethresholdFeatures(source, { brand: 60, product: 60, ip: 60, person: 60 });
    expect(refreshed.productRecommendation?.matches?.map(m => m.assetProductId)).toEqual(["winner"]);
    expect(refreshed.productRecommendation?.detections?.[0].topMatches.map(m => m.assetProductId)).toEqual(["winner"]);
    expect(refreshed.featureDecision?.decision.result?.matches.map(m => m.candidateId)).toEqual(["product:winner"]);
    expect(source.productRecommendation?.matches).toHaveLength(2);
    expect(source.featureDecision?.decision.result?.matches).toHaveLength(2);
  });
});
