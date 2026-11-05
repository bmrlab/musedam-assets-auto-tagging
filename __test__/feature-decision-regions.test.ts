import { selectFeatureRegions } from "@/lib/feature-decision/regions";
import { describe, expect, it } from "vitest";

const meta = { width: 1000, height: 1000 };
function box(index: number, score = 0.9) {
  return { xMin: index * 100, yMin: 0, xMax: index * 100 + 80, yMax: 80, score, label: "object" };
}

describe("shared asset retrieval budget", () => {
  it("selects at most five regions across tasks with stable task coverage", () => {
    const input = {
      logo: Array.from({ length: 6 }, (_, i) => box(i)),
      product: Array.from({ length: 6 }, (_, i) => box(i)),
      ip: Array.from({ length: 6 }, (_, i) => box(i)),
    };
    const result = selectFeatureRegions(input, meta);
    expect(result.selected).toHaveLength(5);
    expect(new Set(result.selected.map((region) => region.featureType)).size).toBe(3);
    expect(result.regionsDetected).toBe(18);
    expect(result.regionsOmitted).toBe(13);
    expect(selectFeatureRegions(input, meta)).toEqual(result);
  });

  it("deduplicates within a task while retaining overlapping logo/product retrieval", () => {
    const result = selectFeatureRegions({ logo: [box(0), box(0)], product: [box(0)] }, meta);
    expect(result.selected).toHaveLength(2);
    expect(result.regionsDeduplicated).toBe(1);
    expect(result.selected[0].sourceDetectionIndices).toEqual([0, 1]);
  });

  it("charges whole-image fallbacks to the same cap and ignores invalid regions", () => {
    const result = selectFeatureRegions(
      {
        logo: [],
        ip: [{ ...box(0), xMax: -1 }],
        product: Array.from({ length: 8 }, (_, i) => box(i)),
      },
      meta,
    );
    expect(result.selected).toHaveLength(5);
    expect(result.selected.filter((region) => region.fallback)).toHaveLength(2);
    expect(result.regionsOmitted).toBe(5);
  });
});
