import { buildFeatureDecisionPrompt, buildSourceRegionGroups } from "@/lib/feature-decision/prompts";
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
    const groups = buildSourceRegionGroups([shampoo, conditioner, cream], new Map([[shampoo.candidateId, "C1"]]));
    expect(groups.map(group => [group.regionId, group.candidates.map(row => row.name)]))
      .toEqual([["product:0", ["RYO Shampoo", "RYO Conditioner"]], ["product:1", ["AESTURA Cream"]]]);
    expect(groups[0].candidates[0].candidateId).toBe("C1");
    expect(groups[0].candidates[1]).not.toHaveProperty("candidateId");
  });
  it("uses each region observation instead of copying the candidate's global maximum", () => {
    const product = candidate("shampoo", "RYO Shampoo", ["product:0", "product:2"]);
    product.regionEvidence = [
      { regionId: "product:0", similarity: 0.96, imageSimilarity: 0.94, descriptionSimilarity: 0.1 },
      { regionId: "product:2", similarity: 0.64, imageSimilarity: 0.61, descriptionSimilarity: 0.15 },
    ];
    const groups = buildSourceRegionGroups([product], new Map([[product.candidateId, "C1"]]));
    expect(groups.map(group => group.candidates[0].retrieval.score)).toEqual([0.96, 0.64]);
    expect(groups.map(group => group.candidates[0].retrieval.scoreScope)).toEqual(["region", "region"]);
  });
  it("marks OCR as whole-asset text without inventing OCR-to-object associations", () => {
    const shampoo = candidate("shampoo", "RYO Shampoo", ["product:0"]);
    const { messages } = buildFeatureDecisionPrompt({ sourceImage: "private-image", imageMode: false,
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
    expect(buildSourceRegionGroups([product], new Map())[0].scope).toBe("whole_asset_fallback");
  });
});

it("binds catalog identity names directly to their own reference images", () => {
  const emulsion = { ...candidate("emulsion", "雪花秀滋盈琉光润颜乳", []), referenceImage: "emulsion-reference" };
  const brightening = { ...candidate("brightening", "雪花秀滋晶臻白精华乳", []), referenceImage: "brightening-reference" };
  const { messages, candidateIdsByReference } = buildFeatureDecisionPrompt({ sourceImage: "source", imageMode: true,
    ocr: { status: "empty", segments: [] }, candidates: [emulsion, brightening] });
  const parts = messages[1].content as Array<{type: string; text?: string; image_url?: {url: string}}>;
  for (const [reference, item] of [["C1", emulsion], ["C2", brightening]] as const) {
    expect(candidateIdsByReference.get(reference)).toBe(item.candidateId);
    const index = parts.findIndex(part => part.type === "text" && part.text?.startsWith("REFERENCE ") && part.text.includes(`candidateId: ${reference}`));
    expect(parts[index].text).toContain(item.name);
    expect(parts[index + 1].image_url?.url).toBe(item.referenceImage);
  }
});

it("does not expose Logo context as output choices in a product comparison batch", () => {
  const product = candidate("emulsion", "琉光乳", ["product:0"]);
  const logo = { ...candidate("brand", "Sulwhasoo Logo", ["logo:0"]), featureType: "logo" as const, candidateId: "logo:brand" };
  const { messages } = buildFeatureDecisionPrompt({ sourceImage: "source", imageMode: false,
    ocr: { status: "empty", segments: [] }, candidates: [product], contextCandidates: [logo, product] });
  const userText = messages[1].content as string;
  expect(userText).not.toContain("Sulwhasoo Logo");
  expect(userText).not.toContain("logo:0");
  expect(userText).toContain('"candidateId":"C1"');
  expect(userText).not.toContain("product:emulsion");
});
