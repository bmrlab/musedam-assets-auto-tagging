import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  enforceLiteralEvidenceForMetadataTags,
  enhancePredictionsByBasicInfoHardMatch,
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

  it("does not hard-match POP-UP视频 for a path that mentions pop-up but never video (real customer bug)", () => {
    const predictions: SourceBasedTagPredictions = [];
    const result = enhancePredictionsByMaterializedPathHardMatch(
      predictions,
      tagsTree,
      "assets/pop_up/product-shot.png",
    );
    const matched = result.flatMap((p) => p.tags).find((t) => t.leafTagId === 3);
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

describe("enhancePredictionsByBasicInfoHardMatch", () => {
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
          children: [{ id: 3, name: "POP-UP", extra: null }],
        },
      ],
    },
  ];

  it("hard-matches a tag whose keyword literally appears in the filename (real customer case)", () => {
    const predictions: SourceBasedTagPredictions = [];
    const result = enhancePredictionsByBasicInfoHardMatch(
      predictions,
      tagsTree,
      "LANEIGE x Sephora Pop-up-Confirm Version",
    );
    const matched = result.find((p) => p.source === "basicInfo")?.tags.find((t) => t.leafTagId === 3);
    expect(matched).toBeDefined();
    expect(matched?.confidence).toBe(0.9);
  });

  it("does not force-add the POP-UP视频 tag for a filename that merely contains 'popup' as a substring", () => {
    const tagsTreeWithVideoTag: TagWithChildren[] = [
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
    const result = enhancePredictionsByBasicInfoHardMatch(
      [],
      tagsTreeWithVideoTag,
      "20260728_TM_SWS_POPUP_门面.png",
    );
    const matched = result.flatMap((p) => p.tags).find((t) => t.leafTagId === 3);
    expect(matched).toBeUndefined();
  });

  it("merges into an existing basicInfo prediction from the model rather than duplicating it", () => {
    const predictions: SourceBasedTagPredictions = [
      { source: "basicInfo", tags: [{ leafTagId: 3, tagPath: ["素材类型", "线下物料", "POP-UP"], confidence: 0.6 }] },
    ];
    const result = enhancePredictionsByBasicInfoHardMatch(predictions, tagsTree, "Sephora Pop-up.mp4");
    const basicInfoTags = result.find((p) => p.source === "basicInfo")?.tags;
    expect(basicInfoTags).toHaveLength(1);
    expect(basicInfoTags?.[0].confidence).toBe(0.9);
  });

  it("is a no-op when the filename/description text carries no keyword hit", () => {
    const predictions: SourceBasedTagPredictions = [];
    const result = enhancePredictionsByBasicInfoHardMatch(predictions, tagsTree, "夏日新品上市.mp4");
    expect(result).toEqual(predictions);
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

  it("drops image-only tags such as 产品组合图 / 白底图 for a video asset (real customer case)", () => {
    const videoPredictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [
          { leafTagId: 10, tagPath: ["素材类型", "产品资产", "产品组合图"], confidence: 0.81 },
          { leafTagId: 11, tagPath: ["素材类型", "产品资产", "白底图"], confidence: 0.7 },
          { leafTagId: 12, tagPath: ["素材类型", "视频资产"], confidence: 0.81 },
          { leafTagId: 13, tagPath: ["内容主题", "产品体验", "使用演示"], confidence: 0.83 },
        ],
      },
    ];
    const result = filterPredictionsByRealExtension(videoPredictions, "mp4");
    const ids = result.flatMap((p) => p.tags).map((t) => t.leafTagId);
    expect(ids).toEqual([12, 13]);
  });

  it("keeps 图-suffixed tags for an image asset", () => {
    const imagePredictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [{ leafTagId: 10, tagPath: ["素材类型", "产品资产", "产品组合图"], confidence: 0.81 }],
      },
    ];
    expect(filterPredictionsByRealExtension(imagePredictions, "jpg")).toEqual(imagePredictions);
  });

  it("keeps unrelated content tags untouched", () => {
    const result = filterPredictionsByRealExtension(predictions, "png");
    const ids = result.flatMap((p) => p.tags).map((t) => t.leafTagId);
    expect(ids).toContain(4);
  });

  it("is a no-op when the real extension is unknown and no fallback text is given", () => {
    const result = filterPredictionsByRealExtension(predictions, undefined);
    expect(result).toEqual(predictions);
  });

  it("falls back to filename/description text to drop a 视频 tag when the real extension is missing", () => {
    const result = filterPredictionsByRealExtension(
      predictions,
      undefined,
      "product_shot_final.png 棉片产品图",
    );
    const ids = result.flatMap((p) => p.tags).map((t) => t.leafTagId);
    expect(ids).not.toContain(3);
    expect(ids).toContain(4);
  });

  it("stays a no-op when the real extension is missing and fallback text carries no format signal either", () => {
    const result = filterPredictionsByRealExtension(predictions, undefined, "夏日新品上市");
    expect(result).toEqual(predictions);
  });
});

describe("enforceLiteralEvidenceForMetadataTags", () => {
  const tagsTree: TagWithChildren[] = [
    {
      id: 1,
      name: "渠道触点",
      extra: null,
      children: [
        {
          id: 2,
          name: "触点",
          extra: null,
          children: [
            { id: 3, name: "抖音", extra: null },
            { id: 4, name: "小红书", extra: { keywords: ["种草笔记"] } },
          ],
        },
      ],
    },
    {
      id: 5,
      name: "品牌产品线",
      extra: null,
      children: [
        {
          id: 6,
          name: "品牌",
          extra: null,
          children: [{ id: 7, name: "兰芝", extra: null }],
        },
      ],
    },
  ];

  const predictionsWithHallucinatedChannel: SourceBasedTagPredictions = [
    {
      source: "contentAnalysis",
      tags: [
        { leafTagId: 3, tagPath: ["渠道触点", "触点", "抖音"], confidence: 0.9 },
        { leafTagId: 7, tagPath: ["品牌产品线", "品牌", "兰芝"], confidence: 0.95 },
      ],
    },
    {
      source: "tagKeywords",
      tags: [{ leafTagId: 4, tagPath: ["渠道触点", "触点", "小红书"], confidence: 0.9 }],
    },
  ];

  it("drops contentAnalysis-sourced channel tag when the platform name never literally appears in the analysis text", () => {
    const result = enforceLiteralEvidenceForMetadataTags(predictionsWithHallucinatedChannel, tagsTree, {
      contentAnalysis: "视频画面充满活力与趣味，色彩鲜艳，适合吸引年轻消费者关注快闪活动",
      tagKeywords: "laneige x sephora pop-up-confirm version",
    });
    const contentAnalysisIds = result
      .find((p) => p.source === "contentAnalysis")
      ?.tags.map((t) => t.leafTagId);
    expect(contentAnalysisIds).not.toContain(3); // 抖音: no literal evidence, dropped
    expect(contentAnalysisIds).toContain(7); // 兰芝: not a metadata tag, untouched

    const tagKeywordsIds = result.find((p) => p.source === "tagKeywords")?.tags.map((t) => t.leafTagId);
    expect(tagKeywordsIds).not.toContain(4); // 小红书: configured keyword "种草笔记" not present literally
  });

  it("keeps a contentAnalysis channel tag when the platform name literally appears in the analysis text (e.g. visible watermark)", () => {
    const result = enforceLiteralEvidenceForMetadataTags(predictionsWithHallucinatedChannel, tagsTree, {
      contentAnalysis: "画面右下角出现抖音的水印标识",
    });
    const contentAnalysisIds = result
      .find((p) => p.source === "contentAnalysis")
      ?.tags.map((t) => t.leafTagId);
    expect(contentAnalysisIds).toContain(3);
  });

  it("keeps a tagKeywords channel tag when the configured keyword literally appears in filename/description/path text", () => {
    const result = enforceLiteralEvidenceForMetadataTags(predictionsWithHallucinatedChannel, tagsTree, {
      tagKeywords: "小红书种草笔记合集.mp4",
    });
    const tagKeywordsIds = result.find((p) => p.source === "tagKeywords")?.tags.map((t) => t.leafTagId);
    expect(tagKeywordsIds).toContain(4);
  });

  it("is a no-op for basicInfo/materializedPath sources regardless of evidence text", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [{ leafTagId: 3, tagPath: ["渠道触点", "触点", "抖音"], confidence: 0.9 }],
      },
    ];
    const result = enforceLiteralEvidenceForMetadataTags(predictions, tagsTree, {});
    expect(result).toEqual(predictions);
  });
});
