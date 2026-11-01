import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { calculateTagScore } from "@/app/(tagging)/predict";
import {
  DEFAULT_TAGGING_SETTINGS,
  SourceBasedTagPredictions,
  taggingSettingsSchema,
} from "@/app/(tagging)/types";

const predictions: SourceBasedTagPredictions = [
  { source: "basicInfo", tags: [{ leafTagId: 1, tagPath: ["a"], confidence: 0.6 }] },
  { source: "contentAnalysis", tags: [{ leafTagId: 2, tagPath: ["b"], confidence: 0.6 }] },
];

const scoreOf = (tags: ReturnType<typeof calculateTagScore>, id: number) =>
  tags.find((t) => t.leafTagId === id)!.score;

describe("calculateTagScore with sourceWeights", () => {
  it("keeps the default scores when all weights are 1", () => {
    expect(calculateTagScore(predictions, DEFAULT_TAGGING_SETTINGS.sourceWeights)).toEqual(
      calculateTagScore(predictions),
    );
  });

  it("raises the score of a source with a higher weight and lowers it with a lower weight", () => {
    const base = calculateTagScore(predictions);
    const weighted = calculateTagScore(predictions, { basicInfo: 2, contentAnalysis: 0.5 });
    expect(scoreOf(weighted, 1)).toBeGreaterThan(scoreOf(base, 1));
    expect(scoreOf(weighted, 2)).toBeLessThan(scoreOf(base, 2));
    weighted.forEach((t) => expect(t.score).toBeLessThanOrEqual(100));
  });
});

describe("sourceWeights schema", () => {
  it("rejects weights outside 0.1 - 5", () => {
    const shape = taggingSettingsSchema.shape.sourceWeights;
    expect(
      shape.safeParse({ ...DEFAULT_TAGGING_SETTINGS.sourceWeights, basicInfo: 0 }).success,
    ).toBe(false);
    expect(
      shape.safeParse({ ...DEFAULT_TAGGING_SETTINGS.sourceWeights, basicInfo: 6 }).success,
    ).toBe(false);
    expect(shape.safeParse(DEFAULT_TAGGING_SETTINGS.sourceWeights).success).toBe(true);
  });
});
