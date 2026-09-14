import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { filterTagsWithScoreByRecognitionAccuracy } from "@/app/(tagging)/predict";
import { RECOGNITION_ACCURACY_CONFIG, tagPredictionSystemPrompt } from "@/app/(tagging)/prompt";
import { TagWithScore } from "@/app/(tagging)/types";

describe("RECOGNITION_ACCURACY_CONFIG", () => {
  it("matches the thresholds advertised to customers in the settings/test UI copy (≥80% / ≥60% / ≥40%)", () => {
    expect(RECOGNITION_ACCURACY_CONFIG.precise.minConfidence).toBe(0.8);
    expect(RECOGNITION_ACCURACY_CONFIG.balanced.minConfidence).toBe(0.6);
    expect(RECOGNITION_ACCURACY_CONFIG.broad.minConfidence).toBe(0.4);
  });
});

describe("tagPredictionSystemPrompt", () => {
  it("defaults to balanced mode guidance and threshold when no mode is passed", () => {
    const prompt = tagPredictionSystemPrompt();
    expect(prompt).toContain("平衡模式");
    expect(prompt).toContain("只输出置信度≥0.6的预测");
  });

  it("injects precise-mode guidance and the 0.8 floor", () => {
    const prompt = tagPredictionSystemPrompt("precise");
    expect(prompt).toContain("精准模式");
    expect(prompt).toContain("只输出置信度≥0.8的预测");
  });

  it("injects broad-mode guidance and the 0.4 floor", () => {
    const prompt = tagPredictionSystemPrompt("broad");
    expect(prompt).toContain("宽泛模式");
    expect(prompt).toContain("只输出置信度≥0.4的预测");
  });
});

describe("filterTagsWithScoreByRecognitionAccuracy", () => {
  const tagsWithScore: TagWithScore[] = [
    { leafTagId: 1, tagPath: ["a"], confidenceBySources: {}, score: 90 },
    { leafTagId: 2, tagPath: ["b"], confidenceBySources: {}, score: 70 },
    { leafTagId: 3, tagPath: ["c"], confidenceBySources: {}, score: 50 },
    { leafTagId: 4, tagPath: ["d"], confidenceBySources: {}, score: 30 },
  ];

  it("precise mode keeps only tags scoring >= 80", () => {
    const result = filterTagsWithScoreByRecognitionAccuracy(tagsWithScore, "precise");
    expect(result.map((t) => t.leafTagId)).toEqual([1]);
  });

  it("balanced mode keeps tags scoring >= 60", () => {
    const result = filterTagsWithScoreByRecognitionAccuracy(tagsWithScore, "balanced");
    expect(result.map((t) => t.leafTagId)).toEqual([1, 2]);
  });

  it("broad mode keeps tags scoring >= 40", () => {
    const result = filterTagsWithScoreByRecognitionAccuracy(tagsWithScore, "broad");
    expect(result.map((t) => t.leafTagId)).toEqual([1, 2, 3]);
  });

  it("defaults to balanced mode when none is given", () => {
    const result = filterTagsWithScoreByRecognitionAccuracy(tagsWithScore);
    expect(result.map((t) => t.leafTagId)).toEqual([1, 2]);
  });
});
