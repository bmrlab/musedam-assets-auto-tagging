import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  enhancePredictionsByMaterializedPathHardMatch,
  filterPredictionsByRealExtension,
  pathIncludesKeyword,
} from "@/app/(tagging)/predict";
import { TagWithChildren } from "@/prisma/client";
import { SourceBasedTagPredictions } from "@/app/(tagging)/types";

describe("pathIncludesKeyword", () => {
  it("does not match a short ascii keyword inside a larger word (pop vs popup)", () => {
    expect(pathIncludesKeyword("20260728_tm_sws_popup_门面+tmall logo", "pop")).toBe(false);
  });

  it("still matches the ascii keyword when it is a standalone token", () => {
    expect(pathIncludesKeyword("brand/pop/banner.png", "pop")).toBe(true);
    expect(pathIncludesKeyword("brand-pop-banner.png", "pop")).toBe(true);
  });

  it("keeps plain substring matching for CJK keywords", () => {
    expect(pathIncludesKeyword("门店视觉/pop物料", "pop物料")).toBe(true);
  });
});

describe("enhancePredictionsByMaterializedPathHardMatch", () => {
  const tagsTree: TagWithChildren[] = [
    {
      id: 1,
      name: "素材类型",
      extra: null,
      children: [
        {
          id: 2,
          name: "线下物料",
          extra: null,
          children: [{ id: 3, name: "POP-UP视频", extra: null }],
        },
      ],
    },
  ];

  it("does not force-add the POP-UP视频 tag for a filename that merely contains 'popup' as a substring", () => {
    const predictions: SourceBasedTagPredictions = [];
    const result = enhancePredictionsByMaterializedPathHardMatch(
      predictions,
      tagsTree,
      "20260728_TM_SWS_POPUP_门面+tmall logo",
    );
    const matched = result
      .flatMap((p) => p.tags)
      .find((t) => t.leafTagId === 3);
    expect(matched).toBeUndefined();
  });

  it("still hard-matches when the keyword appears as a standalone token", () => {
    const predictions: SourceBasedTagPredictions = [];
    const result = enhancePredictionsByMaterializedPathHardMatch(
      predictions,
      tagsTree,
      "assets/pop-up/video-01.mp4",
    );
    const matched = result.flatMap((p) => p.tags).find((t) => t.leafTagId === 3);
    expect(matched).toBeDefined();
  });

  it("skips a candidate keyword that review feedback has added to the tag's negativeKeywords", () => {
    const tagsTreeWithNegativeKeyword: TagWithChildren[] = [
      {
        id: 1,
        name: "素材类型",
        extra: null,
        children: [
          {
            id: 2,
            name: "线下物料",
            extra: null,
            children: [
              { id: 3, name: "POP-UP视频", extra: { negativeKeywords: ["pop"] } },
            ],
          },
        ],
      },
    ];

    const predictions: SourceBasedTagPredictions = [];
    const result = enhancePredictionsByMaterializedPathHardMatch(
      predictions,
      tagsTreeWithNegativeKeyword,
      "assets/pop-up/video-01.mp4",
    );
    const matched = result.flatMap((p) => p.tags).find((t) => t.leafTagId === 3);
    expect(matched).toBeUndefined();
  });
});

describe("filterPredictionsByRealExtension", () => {
  const predictions: SourceBasedTagPredictions = [
    {
      source: "basicInfo",
      tags: [
        { leafTagId: 1, tagPath: ["素材属性", "文件格式", "JPG"], confidence: 0.9 },
        { leafTagId: 2, tagPath: ["素材属性", "文件格式", "PNG"], confidence: 0.6 },
        { leafTagId: 3, tagPath: ["素材类型", "线下物料", "POP-UP视频"], confidence: 0.94 },
        { leafTagId: 4, tagPath: ["产品品类", "护肤", "棉片"], confidence: 0.98 },
      ],
    },
  ];

  it("drops a format tag that contradicts the real extension (PNG asset tagged JPG)", () => {
    const result = filterPredictionsByRealExtension(predictions, "PNG");
    const ids = result.flatMap((p) => p.tags).map((t) => t.leafTagId);
    expect(ids).not.toContain(1);
    expect(ids).toContain(2);
  });

  it("drops a 视频 category tag for an image asset", () => {
    const result = filterPredictionsByRealExtension(predictions, "png");
    const ids = result.flatMap((p) => p.tags).map((t) => t.leafTagId);
    expect(ids).not.toContain(3);
  });

  it("keeps unrelated content tags untouched", () => {
    const result = filterPredictionsByRealExtension(predictions, "png");
    const ids = result.flatMap((p) => p.tags).map((t) => t.leafTagId);
    expect(ids).toContain(4);
  });

  it("is a no-op when the real extension is unknown", () => {
    const result = filterPredictionsByRealExtension(predictions, undefined);
    expect(result).toEqual(predictions);
  });
});
