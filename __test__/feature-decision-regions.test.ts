import { selectFeatureRegions } from "@/lib/feature-decision/regions";
import { describe, expect, it } from "vitest";

const meta = { width: 1000, height: 1000 };
function box(index: number, score = 0.9) {
  return { xMin: index * 100, yMin: 0, xMax: index * 100 + 80, yMax: 80, score, label: "object" };
}

describe("independent asset retrieval regions", () => {
  it("retains all distinct regions across tasks with stable task coverage", () => {
    const input = {
      logo: Array.from({ length: 6 }, (_, i) => box(i)),
      product: Array.from({ length: 6 }, (_, i) => box(i)),
      ip: Array.from({ length: 6 }, (_, i) => box(i)),
    };
    const result = selectFeatureRegions(input, meta);
    expect(result.selected).toHaveLength(18);
    expect(new Set(result.selected.map((region) => region.featureType)).size).toBe(3);
    expect(result.regionsDetected).toBe(18);
    expect(result.regionsOmitted).toBe(0);
    expect(selectFeatureRegions(input, meta)).toEqual(result);
  });

  it("deduplicates within a task while retaining overlapping logo/product retrieval", () => {
    const result = selectFeatureRegions({ logo: [box(0), box(0)], product: [box(0)] }, meta);
    expect(result.selected).toHaveLength(2);
    expect(result.regionsDeduplicated).toBe(1);
    expect(result.selected[0].sourceDetectionIndices).toEqual([0, 1]);
  });

  it("retains whole-image fallbacks without displacing distinct products", () => {
    const result = selectFeatureRegions(
      {
        logo: [],
        ip: [{ ...box(0), xMax: -1 }],
        product: Array.from({ length: 8 }, (_, i) => box(i)),
      },
      meta,
    );
    expect(result.selected).toHaveLength(10);
    expect(result.selected.filter((region) => region.fallback)).toHaveLength(2);
    expect(result.regionsOmitted).toBe(0);
  });
});
