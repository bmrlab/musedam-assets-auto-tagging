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
  it("always tells the model to report its full candidate range instead of self-filtering by mode", () => {
    // 门槛校验放在代码层（filterTagsWithScoreByRecognitionAccuracy），不是靠模型自觉在生成阶段截断——
    // 否则精准模式下模型会把 0.8 以下的候选直接吞掉，代码层就没有候选可以兜底，导致素材彻底不打标。
    for (const mode of ["precise", "balanced", "broad"] as const) {
      const prompt = tagPredictionSystemPrompt(mode);
      expect(prompt).toContain("低于 0.40 视为噪声，不要输出");
      expect(prompt).toContain("不是你的工作");
    }
  });

  it("defaults to balanced mode guidance when no mode is passed", () => {
    const prompt = tagPredictionSystemPrompt();
    expect(prompt).toContain("平衡模式");
    expect(prompt).toContain("最终会保留置信度≥0.60的标签");
  });

  it("injects precise-mode guidance describing the 0.80 retention floor", () => {
    const prompt = tagPredictionSystemPrompt("precise");
    expect(prompt).toContain("精准模式");
    expect(prompt).toContain("最终只会保留置信度≥0.80的高把握标签");
  });

  it("injects broad-mode guidance describing the 0.40 retention floor", () => {
    const prompt = tagPredictionSystemPrompt("broad");
    expect(prompt).toContain("宽泛模式");
    expect(prompt).toContain("最终会保留置信度≥0.40的标签");
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

  it("falls back to the single best candidate instead of returning nothing when precise mode's floor excludes everything", () => {
    const weakCandidates: TagWithScore[] = [
      { leafTagId: 3, tagPath: ["c"], confidenceBySources: {}, score: 50 },
      { leafTagId: 4, tagPath: ["d"], confidenceBySources: {}, score: 65 },
    ];
    const result = filterTagsWithScoreByRecognitionAccuracy(weakCandidates, "precise");
    expect(result).toEqual([weakCandidates[1]]);
  });

  it("stays empty when the model genuinely found no candidates at all, instead of fabricating a tag", () => {
    const result = filterTagsWithScoreByRecognitionAccuracy([], "precise");
    expect(result).toEqual([]);
  });
});
