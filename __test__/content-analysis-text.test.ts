import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildContentAnalysisText,
  enforceLiteralEvidenceForMetadataTags,
  normalizeForMatch,
} from "@/app/(tagging)/predict";
import { SourceBasedTagPredictions } from "@/app/(tagging)/types";
import { TagWithChildren } from "@/prisma/client";

describe("buildContentAnalysisText", () => {
  it("keeps the legacy single-line form when only aiDescription is present", () => {
    expect(buildContentAnalysisText({ aiDescription: "一位女士在泳池边" })).toBe(
      "内容分析：一位女士在泳池边",
    );
  });

  it("adds the title and every key/value of the detailed description, but not aiTags", () => {
    const text = buildContentAnalysisText({
      aiDescription: "产品海报",
      aiTitle: "Ulike Air 10 促销海报",
      aiTags: "时尚, 清新, 促销",
      aiDetailedDescription: [
        { 画面文字: "618 狂欢 立减 200" },
        { 平台标识: "右下角 TikTok 水印", 主体: "脱毛仪" },
      ],
    });
    expect(text).toBe(
      [
        "内容分析：产品海报",
        "标题：Ulike Air 10 促销海报",
        "详细描述：",
        "- 画面文字：618 狂欢 立减 200",
        "- 平台标识：右下角 TikTok 水印",
        "- 主体：脱毛仪",
      ].join("\n"),
    );
    expect(text).not.toContain("清新");
  });

  it("tolerates unexpected shapes and empty values", () => {
    expect(buildContentAnalysisText(null)).toBe("");
    expect(buildContentAnalysisText("oops")).toBe("");
    expect(
      buildContentAnalysisText({
        aiDetailedDescription: [
          { 文字: ["US", "English"], 数量: 2, 空: "", 无: null },
          "画面左上角有 Amazon 字样",
        ],
      }),
    ).toBe("详细描述：\n- 文字：US、English\n- 数量：2\n- 画面左上角有 Amazon 字样");
  });

  it("caps very long detailed descriptions", () => {
    const text = buildContentAnalysisText({
      aiDetailedDescription: [{ 文字: "字".repeat(10_000) }],
    });
    expect(text.length).toBeLessThan(4100);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("literal tags backed by text recognised in the image", () => {
  const tree: TagWithChildren[] = [
    {
      id: 1,
      name: "业务规则标签",
      extra: { evidencePolicy: "literal" },
      children: [
        {
          id: 2,
          name: "营销活动",
          extra: { evidencePolicy: "literal", siblingsExclusive: true },
          children: [
            { id: 3, name: "618大促", extra: { evidencePolicy: "literal", keywords: ["618"] } },
          ],
        },
        {
          id: 4,
          name: "适用渠道",
          extra: { evidencePolicy: "literal" },
          children: [{ id: 5, name: "TikTok", extra: { evidencePolicy: "literal" } }],
        },
      ],
    },
  ];
  const predictions: SourceBasedTagPredictions = [
    {
      source: "contentAnalysis",
      tags: [
        {
          confidence: 0.85,
          leafTagId: 3,
          tagPath: ["业务规则标签", "营销活动", "618大促"],
          evidence: "618",
        },
        {
          confidence: 0.85,
          leafTagId: 5,
          tagPath: ["业务规则标签", "适用渠道", "TikTok"],
          evidence: "TikTok",
        },
      ],
    },
  ];

  it("accepts them when the text only appears in the detailed description", () => {
    const content = {
      aiDescription: "一张产品促销海报",
      aiDetailedDescription: [{ 画面文字: "618 狂欢" }, { 平台标识: "TikTok 水印" }],
    };
    const result = enforceLiteralEvidenceForMetadataTags(predictions, tree, {
      contentAnalysis: normalizeForMatch(buildContentAnalysisText(content)),
    });
    expect(result[0].tags.map((tag) => tag.leafTagId)).toEqual([3, 5]);
  });

  it("still drops them when nothing in the analysis mentions the text", () => {
    const result = enforceLiteralEvidenceForMetadataTags(predictions, tree, {
      contentAnalysis: normalizeForMatch(
        buildContentAnalysisText({ aiDescription: "一张色彩鲜艳、氛围热闹的促销海报" }),
      ),
    });
    expect(result[0].tags).toEqual([]);
  });
});
