import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  detectAspectRatioGroups,
  parseAspectRatioSpec,
  resolveAspectRatioTags,
} from "@/app/(tagging)/aspect-ratio";
import { dropPredictionsUnderAspectRatioGroups } from "@/app/(tagging)/predict";
import { SourceBasedTagPredictions } from "@/app/(tagging)/types";
import { TagWithChildren } from "@/prisma/client";

// 客户标签树：素材属性 > 画幅/尺寸 > 1:1 / 9:16 / 16:9 / 3:4
const tagsTree: TagWithChildren[] = [
  {
    id: 1,
    name: "素材属性",
    extra: {},
    children: [
      {
        id: 2,
        name: "画幅/尺寸",
        extra: {},
        children: [
          { id: 3, name: "1:1", extra: {} },
          { id: 4, name: "9:16", extra: {} },
          { id: 5, name: "16:9", extra: {} },
          { id: 6, name: "3:4", extra: {} },
        ],
      },
      {
        id: 7,
        name: "素材来源",
        extra: {},
        children: [
          { id: 8, name: "自制", extra: {} },
          { id: 9, name: "采购", extra: {} },
        ],
      },
    ],
  },
  {
    id: 20,
    name: "构图方向",
    extra: {},
    children: [
      { id: 21, name: "横版", extra: {} },
      { id: 22, name: "竖版", extra: {} },
      { id: 23, name: "方图", extra: {} },
    ],
  },
];

describe("parseAspectRatioSpec", () => {
  it("parses numeric ratios with various separators and reduces by gcd", () => {
    expect(parseAspectRatioSpec("1:1")).toEqual({ kind: "ratio", value: 1, label: "1:1" });
    expect(parseAspectRatioSpec("16：9")).toMatchObject({ kind: "ratio", label: "16:9" });
    expect(parseAspectRatioSpec("1920x1080")).toMatchObject({ kind: "ratio", label: "16:9" });
    expect(parseAspectRatioSpec(" 3 × 4 ")).toMatchObject({ kind: "ratio", label: "3:4" });
  });

  it("parses orientation words and rejects everything else", () => {
    expect(parseAspectRatioSpec("横版")).toMatchObject({ kind: "orientation", value: "landscape" });
    expect(parseAspectRatioSpec("Portrait")).toMatchObject({
      kind: "orientation",
      value: "portrait",
    });
    expect(parseAspectRatioSpec("正方形")).toMatchObject({ kind: "orientation", value: "square" });
    expect(parseAspectRatioSpec("洁面")).toBeNull();
    expect(parseAspectRatioSpec("0:5")).toBeNull();
    expect(parseAspectRatioSpec("2024")).toBeNull();
  });
});

describe("detectAspectRatioGroups", () => {
  it("finds only the categories whose children all parse as ratios or orientations", () => {
    const groups = detectAspectRatioGroups(tagsTree);
    expect(groups.map((group) => group.parentId).sort()).toEqual([2, 20]);
    expect(groups.find((group) => group.parentId === 2)?.children.map((child) => child.id)).toEqual(
      [3, 4, 5, 6],
    );
  });

  it("ignores single-child categories and categories with nested children", () => {
    const tree: TagWithChildren[] = [
      { id: 1, name: "画幅", extra: {}, children: [{ id: 2, name: "1:1", extra: {} }] },
      {
        id: 3,
        name: "尺寸",
        extra: {},
        children: [
          { id: 4, name: "1:1", extra: {}, children: [{ id: 5, name: "小图", extra: {} }] },
          { id: 6, name: "9:16", extra: {} },
        ],
      },
    ];
    expect(detectAspectRatioGroups(tree)).toEqual([]);
  });
});

describe("resolveAspectRatioTags", () => {
  const groups = detectAspectRatioGroups(tagsTree);

  it("customer case: 1254×1254 lands on 1:1 with score 100 and origin aspectRatio", () => {
    const tags = resolveAspectRatioTags({ groups, width: 1254, height: 1254 });
    expect(tags).toEqual([
      expect.objectContaining({
        leafTagId: 3,
        tagPath: ["素材属性", "画幅/尺寸", "1:1"],
        score: 100,
        origin: "aspectRatio",
      }),
      expect.objectContaining({
        leafTagId: 23,
        tagPath: ["构图方向", "方图"],
        origin: "aspectRatio",
      }),
    ]);
  });

  it("picks the nearest ratio within tolerance and the matching orientation", () => {
    const vertical = resolveAspectRatioTags({ groups, width: 1080, height: 1920 });
    expect(vertical.map((tag) => tag.leafTagId)).toEqual([4, 22]);
    const nearlyWide = resolveAspectRatioTags({ groups, width: 1920, height: 1100 });
    expect(nearlyWide.map((tag) => tag.leafTagId)).toEqual([5, 21]);
  });

  it("emits nothing for a ratio group when no child is within tolerance, but still resolves orientation", () => {
    const tags = resolveAspectRatioTags({ groups, width: 1000, height: 1400 }); // 5:7，离 3:4 约 7% 以内? 0.714 vs 0.75 → 4.9%
    expect(tags.map((tag) => tag.leafTagId)).toEqual([6, 22]);
    const odd = resolveAspectRatioTags({ groups, width: 1000, height: 1200 }); // 5:6 = 0.833，离 3:4(0.75) 10.5%，离 1:1 18%
    expect(odd.map((tag) => tag.leafTagId)).toEqual([22]);
  });

  it("returns nothing without valid dimensions", () => {
    expect(resolveAspectRatioTags({ groups, width: undefined, height: 100 })).toEqual([]);
    expect(resolveAspectRatioTags({ groups, width: 0, height: 100 })).toEqual([]);
    expect(resolveAspectRatioTags({ groups: [], width: 100, height: 100 })).toEqual([]);
  });
});

describe("dropPredictionsUnderAspectRatioGroups", () => {
  it("removes model guesses for ratio-group children and parents, keeps other tags", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [
          { confidence: 0.9, leafTagId: 4, tagPath: ["素材属性", "画幅/尺寸", "9:16"] },
          { confidence: 0.8, leafTagId: 2, tagPath: ["素材属性", "画幅/尺寸"] },
          { confidence: 0.7, leafTagId: 8, tagPath: ["素材属性", "素材来源", "自制"] },
          { confidence: 0.7, leafTagId: 21, tagPath: ["构图方向", "横版"] },
        ],
      },
    ];
    const result = dropPredictionsUnderAspectRatioGroups(predictions, tagsTree);
    expect(result[0].tags.map((tag) => tag.leafTagId)).toEqual([8]);
  });
});
