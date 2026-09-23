import {
  groupProductDetectionBoxes,
  type ProductDetectionBox,
} from "@/lib/product/detection-box-groups";
import { describe, expect, it } from "vitest";

function box(
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
  overrides: Partial<ProductDetectionBox> = {},
): ProductDetectionBox {
  return { xMin, yMin, xMax, yMax, score: 0.9, label: "bottle", ...overrides };
}

function sourceGroups(boxes: ProductDetectionBox[]) {
  return groupProductDetectionBoxes(boxes).map((group) => group.sourceDetectionIndices);
}

describe("product detection box grouping", () => {
  it("consolidates the six twin.jpeg detections into the two physical bottles", () => {
    // Recorded detector response: each bottle was independently returned for
    // bottle, lotion/emulsion, and cosmetics. Cross-bottle IoU is about 0.015.
    const left = box(251.904, 417.28, 489.472, 1021.44, { score: 0.98 });
    const right = box(481.28, 293.12, 726.016, 1002.24, { score: 0.98 });
    const boxes = [
      left,
      right,
      { ...left, label: "lotion", score: 0.95 },
      { ...right, label: "emulsion", score: 0.95 },
      { ...left, label: "cosmetics", score: 0.92 },
      { ...right, label: "cosmetics", score: 0.92 },
    ];

    expect(groupProductDetectionBoxes(boxes)).toEqual([
      { box: left, detectionIndex: 0, sourceDetectionIndices: [0, 2, 4] },
      { box: right, detectionIndex: 1, sourceDetectionIndices: [1, 3, 5] },
    ]);
  });

  it("chooses the geometry medoid over a higher-scoring shifted duplicate", () => {
    const boxes = [
      box(0, 0, 100, 200, { score: 0.99 }),
      box(8, 0, 108, 200, { score: 0.6 }),
      box(16, 0, 116, 200, { score: 0.98 }),
    ];

    expect(groupProductDetectionBoxes(boxes)).toEqual([
      { box: boxes[1], detectionIndex: 1, sourceDetectionIndices: [0, 1, 2] },
    ]);
  });

  it("groups centered nested boxes with IoU below 0.70 but similar dimensions", () => {
    // IoU 0.64, full containment, and 0.80 width/height ratios.
    expect(sourceGroups([box(0, 0, 100, 200), box(10, 20, 90, 180)])).toEqual([[0, 1]]);
  });

  it("keeps a contained product part separate", () => {
    expect(sourceGroups([box(0, 0, 100, 200), box(20, 0, 80, 50)])).toEqual([[0], [1]]);
  });

  it("guards containment with both dimensions, area, and center alignment", () => {
    const outer = box(0, 0, 100, 200);
    for (const contained of [
      box(15, 10, 85, 190), // Width ratio too small, despite similar area.
      box(12.5, 25, 87.5, 175), // Side ratios pass, but area ratio is only 0.5625.
      box(0, 0, 78, 160), // Similar area/sides, but center is shifted too far.
    ]) {
      expect(sourceGroups([outer, contained])).toEqual([[0], [1]]);
    }
  });

  it("preserves neighboring actual products whose boxes overlap", () => {
    // Real overlapping products can share pixels without describing the same
    // region (here IoU is 0.538 and neither contains the other).
    expect(sourceGroups([box(0, 0, 100, 200), box(30, 0, 130, 200)])).toEqual([[0], [1]]);
  });

  it("does not join two products through one broad box covering both", () => {
    expect(sourceGroups([box(0, 0, 200, 200), box(0, 0, 100, 200), box(100, 0, 200, 200)])).toEqual(
      [[0], [1], [2]],
    );
  });

  it("does not merge a transitive A-B-C overlap chain", () => {
    // A-B and B-C each have IoU 0.739; A-C has IoU 0.538.
    const a = box(0, 0, 100, 100);
    const b = box(15, 0, 115, 100);
    const c = box(30, 0, 130, 100);
    expect(sourceGroups([a, b, c])).toEqual([[0, 1], [2]]);
    expect(sourceGroups([b, a, c])).toEqual([[0, 1], [2]]);
  });

  it("uses score only to break equal geometry, then earliest original index", () => {
    const boxes = [
      box(0, 0, 100, 200, { score: 0.7 }),
      box(0, 0, 100, 200, { score: 0.99 }),
      box(0, 0, 100, 200, { score: 0.99 }),
    ];
    expect(groupProductDetectionBoxes(boxes)[0]).toEqual({
      box: boxes[1],
      detectionIndex: 1,
      sourceDetectionIndices: [0, 1, 2],
    });
    expect(sourceGroups(boxes.map((item) => ({ ...item, score: 0.1 })))).toEqual([[0, 1, 2]]);
  });

  it("does not limit the count or merge separate products sharing a label", () => {
    const boxes = Array.from({ length: 12 }, (_, index) =>
      box(index * 110, 0, index * 110 + 100, 200),
    );
    expect(sourceGroups(boxes)).toEqual(boxes.map((_, index) => [index]));
  });

  it("ignores label differences when deciding groups", () => {
    const boxes = [box(0, 0, 100, 200), box(2, 2, 102, 202)];
    const relabeled = boxes.map((item, index) => ({
      ...item,
      label: index ? "completely different category" : "",
    }));
    expect(sourceGroups(relabeled)).toEqual(sourceGroups(boxes));
    expect(sourceGroups(relabeled)).toEqual([[0, 1]]);
  });

  it("sorts groups by representative index and keeps original indices", () => {
    const boxes = [
      box(0, 0, 100, 200, { score: 0.8 }),
      box(200, 0, 300, 200),
      box(0, 0, 100, 200, { score: 0.95 }),
    ];
    const groups = groupProductDetectionBoxes(boxes);
    expect(groups.map((group) => group.detectionIndex)).toEqual([1, 2]);
    expect(groups.map((group) => group.sourceDetectionIndices)).toEqual([[1], [0, 2]]);
  });

  it("drops nonfinite and degenerate boxes without renumbering valid boxes", () => {
    const valid = box(0, 0, 100, 200);
    const boxes = [
      box(NaN, 0, 100, 200),
      box(0, 0, Infinity, 200),
      box(0, 10, 100, 10),
      box(100, 0, 0, 200),
      box(0, 0, 100, 200, { score: Infinity }),
      box(-Number.MAX_VALUE, 0, Number.MAX_VALUE, 200),
      valid,
    ];
    expect(groupProductDetectionBoxes(boxes)).toEqual([
      { box: valid, detectionIndex: 6, sourceDetectionIndices: [6] },
    ]);
    expect(groupProductDetectionBoxes(boxes.slice(0, 6))).toEqual([]);
    expect(groupProductDetectionBoxes([])).toEqual([]);
  });

  it("is deterministic and does not modify its input", () => {
    const boxes = [box(0, 0, 100, 200), box(2, 2, 102, 202), box(200, 0, 300, 200)];
    const original = structuredClone(boxes);
    const first = groupProductDetectionBoxes(boxes);
    expect(groupProductDetectionBoxes(boxes)).toEqual(first);
    expect(boxes).toEqual(original);
  });
});
