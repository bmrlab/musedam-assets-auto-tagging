import {
  DETECTION_LABEL_TOKEN_LIMIT,
  getDetectionLabelTokenUpperBound,
  isDetectionLabelWithinTokenLimit,
  truncateDetectionLabelToTokenLimit,
} from "@/lib/detection-label";
import { describe, expect, it } from "vitest";

describe("detection label token limit", () => {
  it("includes detector special tokens in the conservative upper bound", () => {
    expect(getDetectionLabelTokenUpperBound("shoe . bag .")).toBe(11);
  });

  it("leaves labels that are already within the limit unchanged", () => {
    expect(truncateDetectionLabelToTokenLimit("shoe . bag")).toBe("shoe . bag .");
  });

  it("truncates oversized labels and preserves the required suffix", () => {
    const result = truncateDetectionLabelToTokenLimit("a".repeat(400));

    expect(result.endsWith(" .")).toBe(true);
    expect(isDetectionLabelWithinTokenLimit(result)).toBe(true);
    expect(getDetectionLabelTokenUpperBound(result)).toBe(DETECTION_LABEL_TOKEN_LIMIT);
  });
});
