import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  detectAspectRatioGroups,
  mergeAiSizeTags,
  parseAspectRatioSpec,
  resolveAspectRatioTags,
} from "@/app/(tagging)/aspect-ratio";
import { dropPredictionsUnderAspectRatioGroups } from "@/app/(tagging)/predict";
import { SourceBasedTagPredictions, TagWithScore } from "@/app/(tagging)/types";
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
    expect(parseAspectRatioSpec("1:1")).toEqual({
      kind: "ratio",
      value: 1,
      label: "1:1",
      width: 1,
      height: 1,
    });
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

  it("ignores a trailing bracketed note, even when truncated", () => {
    expect(parseAspectRatioSpec("1:1（TTS详情页）")).toMatchObject({ kind: "ratio", label: "1:1" });
    expect(parseAspectRatioSpec("800×800（电商主图）")).toMatchObject({
      kind: "ratio",
      label: "1:1",
      width: 800,
      height: 800,
    });
    expect(parseAspectRatioSpec("1080x1920 (抖音")).toMatchObject({ kind: "ratio", label: "9:16" });
    expect(parseAspectRatioSpec("横版【主图】")).toMatchObject({ kind: "orientation" });
    expect(parseAspectRatioSpec("其他尺寸（自定义）")).toBeNull();
    expect(parseAspectRatioSpec("长1600、宽度自适应")).toBeNull();
    expect(parseAspectRatioSpec("（1:1）")).toBeNull();
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

// 客户真实标签树：物料制作标签 > 规格信息（图片） > 带用途备注的尺寸，夹杂"其他尺寸""长1600"这类无法解析的子标签
const annotatedTree: TagWithChildren[] = [
  {
    id: 100,
    name: "物料制作标签",
    extra: {},
    children: [
      {
        id: 101,
        name: "规格信息（图片）",
        extra: {},
        children: [
          { id: 110, name: "800×800（电商主图）", extra: {} },
          { id: 111, name: "1920×1080（横版视频封面）", extra: {} },
          { id: 112, name: "1080×1350（Instagram）", extra: {} },
          { id: 113, name: "1080×1920（抖音/快手）", extra: {} },
          { id: 114, name: "其他尺寸（自定义）", extra: {} },
          { id: 115, name: "1200×1200（TTS主图）", extra: {} },
          { id: 116, name: "长1600、宽度自适应（TTS详情页）", extra: {} },
          { id: 117, name: "1:1（TTS详情页）", extra: {} },
          { id: 118, name: "3:4（TTS详情页）", extra: {} },
          { id: 119, name: "4:3（TTS详情页）", extra: {} },
          { id: 120, name: "1080×1080（Meta）", extra: {} },
          { id: 121, name: "750×1334（EDM）", extra: {} },
        ],
      },
      {
        id: 130,
        name: "文件格式",
        extra: {},
        children: [
          { id: 131, name: "JPG", extra: {} },
          { id: 132, name: "PNG", extra: {} },
          { id: 133, name: "其他格式", extra: {} },
        ],
      },
    ],
  },
];

describe("annotated size groups", () => {
  const groups = detectAspectRatioGroups(annotatedTree);
  const resolve = (width: number, height: number) =>
    resolveAspectRatioTags({ groups, width, height }).map((tag) => tag.leafTagId);

  it("recognises the group despite notes and a few unparseable siblings", () => {
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      parentId: 101,
      fallbackChild: { id: 114 },
      unparsedChildren: [{ id: 116 }],
    });
    expect(groups[0].children).toHaveLength(10);
  });

  it("prefers the exact pixel size, then the plain ratio, among equal ratios", () => {
    expect(resolve(800, 800)).toEqual([110]);
    expect(resolve(1080, 1080)).toEqual([120]);
    expect(resolve(1254, 1254)).toEqual([117]);
    expect(resolve(3000, 4000)).toEqual([118]);
    expect(resolve(1080, 1920)).toEqual([113]);
    expect(resolve(3840, 2160)).toEqual([111]);
  });

  it("falls back to the 其他尺寸 child when no ratio is within tolerance", () => {
    expect(resolve(1000, 3000)).toEqual([114]);
  });

  it("keeps the model away from every child of the group, including unparseable ones", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [
          {
            confidence: 0.9,
            leafTagId: 116,
            tagPath: ["物料制作标签", "规格信息（图片）", "长1600、宽度自适应（TTS详情页）"],
          },
          {
            confidence: 0.8,
            leafTagId: 114,
            tagPath: ["物料制作标签", "规格信息（图片）", "其他尺寸（自定义）"],
          },
          {
            confidence: 0.8,
            leafTagId: 117,
            tagPath: ["物料制作标签", "规格信息（图片）", "1:1（TTS详情页）"],
          },
          { confidence: 0.8, leafTagId: 131, tagPath: ["物料制作标签", "文件格式", "JPG"] },
        ],
      },
    ];
    const result = dropPredictionsUnderAspectRatioGroups(predictions, annotatedTree);
    expect(result[0].tags.map((tag) => tag.leafTagId)).toEqual([131]);
  });

  it("still ignores groups where most children are not sizes", () => {
    const tree: TagWithChildren[] = [
      {
        id: 1,
        name: "混合",
        extra: {},
        children: [
          { id: 2, name: "1:1", extra: {} },
          { id: 3, name: "9:16", extra: {} },
          { id: 4, name: "洁面", extra: {} },
          { id: 5, name: "面霜", extra: {} },
        ],
      },
    ];
    expect(detectAspectRatioGroups(tree)).toEqual([]);
  });
});

describe("mergeAiSizeTags", () => {
  const groups = detectAspectRatioGroups(annotatedTree);
  const aiLongImage: TagWithScore = {
    leafTagId: 116,
    tagPath: ["物料制作标签", "规格信息（图片）", "长1600、宽度自适应（TTS详情页）"],
    confidenceBySources: {},
    score: 90,
    origin: "sizeAI",
  };

  it("replaces the 其他尺寸 fallback when the model recognised a specific size", () => {
    const systemTags = resolveAspectRatioTags({ groups, width: 750, height: 1600 });
    expect(systemTags.map((tag) => tag.leafTagId)).toEqual([114]);
    const merged = mergeAiSizeTags({ groups, systemTags, aiTags: [aiLongImage] });
    expect(merged.map((tag) => tag.leafTagId)).toEqual([116]);
  });

  it("keeps a matched ratio alongside the AI size tag", () => {
    const systemTags = resolveAspectRatioTags({ groups, width: 1200, height: 1600 });
    expect(systemTags.map((tag) => tag.leafTagId)).toEqual([118]);
    const merged = mergeAiSizeTags({ groups, systemTags, aiTags: [aiLongImage] });
    expect(merged.map((tag) => tag.leafTagId)).toEqual([118, 116]);
  });

  it("returns the system tags untouched when the model found nothing", () => {
    const systemTags = resolveAspectRatioTags({ groups, width: 750, height: 1600 });
    expect(mergeAiSizeTags({ groups, systemTags, aiTags: [] })).toBe(systemTags);
  });
});
