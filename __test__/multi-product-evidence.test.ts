import { buildFeatureDecisionMessages, buildSourceRegionGroups } from "@/lib/feature-decision/prompts";
import type { FeatureDecisionCandidate } from "@/lib/feature-decision/types";
import { describe, expect, it } from "vitest";
const candidate = (id: string, name: string, regionIds: string[]): FeatureDecisionCandidate => ({
  candidateId: `product:${id}`, classId: id, featureType: "product", name, typeName: "Products",
  similarity: 0.96, regionIds,
});
describe("multi-product evidence ownership", () => {
  it("keeps competitors from other batches in the same region without exposing their output IDs", () => {
    const shampoo = candidate("shampoo", "RYO Shampoo", ["product:0"]);
    const conditioner = candidate("conditioner", "RYO Conditioner", ["product:0"]);
    const cream = candidate("cream", "AESTURA Cream", ["product:1"]);
    const groups = buildSourceRegionGroups([shampoo, conditioner, cream], new Set([shampoo.candidateId]));
    expect(groups.map(group => [group.regionId, group.candidates.map(row => row.name)]))
      .toEqual([["product:0", ["RYO Shampoo", "RYO Conditioner"]], ["product:1", ["AESTURA Cream"]]]);
    expect(groups[0].candidates[0].candidateId).toBe("product:shampoo");
    expect(groups[0].candidates[1]).not.toHaveProperty("candidateId");
  });
  it("uses each region observation instead of copying the candidate's global maximum", () => {
    const product = candidate("shampoo", "RYO Shampoo", ["product:0", "product:2"]);
    product.regionEvidence = [
      { regionId: "product:0", similarity: 0.96, imageSimilarity: 0.94, descriptionSimilarity: 0.1 },
      { regionId: "product:2", similarity: 0.64, imageSimilarity: 0.61, descriptionSimilarity: 0.15 },
    ];
    const groups = buildSourceRegionGroups([product], new Set([product.candidateId]));
    expect(groups.map(group => group.candidates[0].retrieval.score)).toEqual([0.96, 0.64]);
    expect(groups.map(group => group.candidates[0].retrieval.scoreScope)).toEqual(["region", "region"]);
  });
  it("marks OCR as whole-asset text without inventing OCR-to-object associations", () => {
    const shampoo = candidate("shampoo", "RYO Shampoo", ["product:0"]);
    const messages = buildFeatureDecisionMessages({ sourceImage: "private-image", imageMode: false,
      ocr: { source: "musedam", status: "completed", segments: ["RYO", "Shampoo", "innisfree", "BLACK TEA"] },
      candidates: [shampoo],
    });
    const text = messages[1].content as string;
    const payload = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    expect(payload.ocr).toMatchObject({ source: "musedam", scope: "whole_asset", spatiallyGrounded: false });
    expect(payload.sourceRegions[0]).not.toHaveProperty("ocr");
    expect(JSON.stringify(messages)).not.toContain("private-image");
    expect(messages[0].content).toContain("innisfree / BLACK TEA cannot be cited as affirmative AESTURA identity evidence");
  });
  it("does not mistake a whole-image fallback for one physical product", () => {
    const product = candidate("cream", "Cream", ["product:0"]);
    product.regionEvidence = [{ regionId: "product:0", wholeAssetFallback: true,
      similarity: 0.9, imageSimilarity: 0.9, descriptionSimilarity: 0 }];
    expect(buildSourceRegionGroups([product], new Set())[0].scope).toBe("whole_asset_fallback");
  });
});
