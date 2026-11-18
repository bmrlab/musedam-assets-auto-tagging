import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  calculateTagScore,
  enhancePredictionsByBasicInfoHardMatch,
  enhancePredictionsByMaterializedPathHardMatch,
  enhancePredictionsByTagKeywordsHardMatch,
  resolveExclusiveSiblings,
} from "@/app/(tagging)/predict";
import type { SourceBasedTagPredictions } from "@/app/(tagging)/types";
import type { TagWithChildren } from "@/prisma/client";

const tree: TagWithChildren[] = [
  {
    id: 1,
    name: "产品品类",
    extra: { siblingsExclusive: true },
    children: [
      { id: 2, name: "喷雾", extra: { evidencePolicy: "content", keywords: ["喷雾"] } },
      { id: 3, name: "水乳套装", extra: { evidencePolicy: "content" } },
    ],
  },
  {
    id: 4,
    name: "渠道触点",
    extra: {},
    children: [
      // 即使旧策略把渠道下的 AI短剧视为字面型，目录关键词也不能直接确认视频类型。
      { id: 5, name: "AI短剧", extra: { keywords: ["短剧"] } },
      { id: 6, name: "抖音", extra: { evidencePolicy: "literal", keywords: ["DY"] } },
    ],
  },
  {
    id: 7,
    name: "SKU",
    extra: {},
    children: [{ id: 8, name: "KF12.0066", extra: { evidencePolicy: "literal" } }],
  },
  {
    id: 9,
    name: "营销活动",
    extra: {},
    children: [{ id: 10, name: "520", extra: { evidencePolicy: "literal" } }],
  },
];
const ids = (predictions: SourceBasedTagPredictions) =>
  predictions.flatMap((p) => p.tags.map((t) => t.leafTagId));
const mist = (
  source: "materializedPath" | "tagKeywords",
  confidence: number,
): SourceBasedTagPredictions => [
  { source, tags: [{ leafTagId: 2, tagPath: ["产品品类", "喷雾"], confidence }] },
];

describe("folder words are evidence, not content recognition", () => {
  it("also leaves unconfigured content labels to the model", () => {
    const unconfigured: TagWithChildren[] = [
      { id: 1, name: "品类", extra: {}, children: [{ id: 2, name: "喷雾", extra: {} }] },
    ];
    expect(enhancePredictionsByMaterializedPathHardMatch([], unconfigured, "/喷雾")).toEqual([]);
  });

  it("preserves channel-name directory matches when configured as literal", () => {
    const result = enhancePredictionsByMaterializedPathHardMatch([], tree, "/抖音");
    expect(ids(result)).toEqual([6]);
    expect(calculateTagScore(result)[0].score).toBe(94);
  });

  it("does not add a source when the model only supports a content-analysis prediction", () => {
    const model: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [{ leafTagId: 2, tagPath: ["产品品类", "喷雾"], confidence: 0.7 }],
      },
    ];
    const result = enhancePredictionsByMaterializedPathHardMatch(model, tree, "/喷雾");
    expect(result).toEqual(model);
    expect(calculateTagScore(result)).toEqual(calculateTagScore(model));
  });

  it("does not invent a 94-point mist prediction from any of the asset's folders", () => {
    for (const path of ["/喷雾/Resources/local | /水乳套装", "/水乳套装 | /喷雾/Resources/local"]) {
      expect(enhancePredictionsByMaterializedPathHardMatch([], tree, path)).toEqual([]);
    }
  });

  it("preserves a model's uncertainty and records the actual folder hit without mutating input", () => {
    const original = mist("materializedPath", 0.45);
    const result = enhancePredictionsByMaterializedPathHardMatch(original, tree, "/喷雾");
    expect(result[0].tags[0]).toMatchObject({ confidence: 0.45, matchedKeywords: ["喷雾"] });
    expect(original[0].tags[0].matchedKeywords).toBeUndefined();
    expect(calculateTagScore(result)[0].score).toBeLessThan(80);
  });

  it("does not add another keyword source for a directory-only content hint", () => {
    const model = mist("materializedPath", 0.45);
    const result = enhancePredictionsByTagKeywordsHardMatch(model, tree, {
      basicInfo: "hash.mp4",
      materializedPath: "/喷雾",
    });
    expect(result).toEqual(model);
    expect(result.some((p) => p.source === "tagKeywords")).toBe(false);
  });

  it("does not turn a shared drama directory into a 90-point AI drama prediction", () => {
    expect(
      enhancePredictionsByTagKeywordsHardMatch([], tree, {
        basicInfo: "hash.mp4",
        materializedPath: "/短剧素材池/Resources/local",
      }),
    ).toEqual([]);
  });

  it("annotates existing directory-keyword predictions without raising their confidence", () => {
    const model: SourceBasedTagPredictions = [
      {
        source: "tagKeywords",
        tags: [{ leafTagId: 5, tagPath: ["渠道触点", "AI短剧"], confidence: 0.4 }],
      },
    ];
    const result = enhancePredictionsByTagKeywordsHardMatch(model, tree, {
      basicInfo: "hash.mp4",
      materializedPath: "/短剧素材池",
    });
    expect(result[0].tags[0]).toMatchObject({ confidence: 0.4, matchedKeywords: ["短剧"] });
    expect(calculateTagScore(result)[0].score).toBeLessThan(60);
  });

  it("does not override semantic scoring for a content keyword even in the filename", () => {
    const result = enhancePredictionsByTagKeywordsHardMatch(
      mist("tagKeywords", 0.45),
      tree,
      "喷雾.mp4",
    );
    expect(result[0].tags[0].confidence).toBe(0.45);
  });

  it("keeps a stronger water/emulsion content prediction over a weak path prediction", () => {
    let predictions: SourceBasedTagPredictions = [
      ...mist("materializedPath", 0.45),
      {
        source: "contentAnalysis",
        tags: [{ leafTagId: 3, tagPath: ["产品品类", "水乳套装"], confidence: 0.9 }],
      },
    ];
    predictions = enhancePredictionsByMaterializedPathHardMatch(predictions, tree, "/喷雾");
    predictions = enhancePredictionsByTagKeywordsHardMatch(predictions, tree, {
      basicInfo: "hash.mp4",
      materializedPath: "/喷雾",
    });
    expect(ids(resolveExclusiveSiblings(predictions, tree, "/喷雾"))).toEqual([3]);
  });

  it("retains genuinely strong content predictions", () => {
    const model = mist("materializedPath", 0.96);
    expect(
      enhancePredictionsByMaterializedPathHardMatch(model, tree, "/喷雾")[0].tags[0].confidence,
    ).toBe(0.96);
  });

  it("preserves explicit literal SKU and campaign matches from directories", () => {
    const result = enhancePredictionsByMaterializedPathHardMatch([], tree, "/KF12.0066/520");
    expect(ids(result)).toEqual([8, 10]);
    expect(calculateTagScore(result).every((t) => t.score === 94)).toBe(true);
  });

  it("preserves filename keyword aliases for literal business tags", () => {
    const result = enhancePredictionsByTagKeywordsHardMatch([], tree, {
      basicInfo: "DY_水乳.mp4",
      materializedPath: "/共享",
    });
    expect(ids(result)).toEqual([6]);
    expect(calculateTagScore(result)[0].score).toBe(90);
  });

  it("preserves filename hard matches and caller-configured source weights", () => {
    const result = enhancePredictionsByBasicInfoHardMatch([], tree, "喷雾.mp4");
    expect(ids(result)).toEqual([2]);
    expect(calculateTagScore(result, { basicInfo: 0.2 })[0].score).toBeLessThan(
      calculateTagScore(result)[0].score,
    );
  });
});
