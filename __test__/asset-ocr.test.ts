import { getAssetOcrSegments } from "@/lib/feature-decision/asset-ocr";
import { describe, expect, it } from "vitest";

describe("MuseDAM OCR reuse", () => {
  it("collects explicit OCR fields without using generated captions as text evidence", () => {
    expect(
      getAssetOcrSegments(
        {
          ocrContent: "Sulwhasoo",
          imageContentAnalysis: { aiOcr: ["LANEIGE", "Sulwhasoo"], aiDescription: "HERA" },
        },
        { aiOcr: "innisfree" },
      ),
    ).toEqual(["Sulwhasoo", "LANEIGE", "innisfree"]);
    expect(getAssetOcrSegments({ ocrContent: null }, { aiDescription: "A logo" })).toEqual([]);
  });
});
