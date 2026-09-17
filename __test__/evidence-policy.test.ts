import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  applyContentOnlyRejection,
  applyEvidencePoliciesToTree,
  collectTagsMissingEvidencePolicy,
  CONTENT_ONLY_REJECTION_AUTO_LITERAL_THRESHOLD,
  isContentOnlySupport,
  resolveEvidencePolicy,
} from "@/app/(tagging)/evidence-policy";
import {
  enforceLiteralEvidenceForMetadataTags,
  isPlausibleEvidenceQuoteForTag,
} from "@/app/(tagging)/predict";
import { SourceBasedTagPredictions } from "@/app/(tagging)/types";
import { buildTagStructureText, LITERAL_EVIDENCE_TAG_MARK } from "@/app/(tagging)/utils";
import { TagWithChildren } from "@/prisma/client";

function makeTree(): TagWithChildren[] {
  return [
    {
      id: 1,
      name: "投放平台",
      extra: { evidencePolicy: "literal" },
      children: [
        {
          id: 2,
          name: "社交媒体",
          extra: { evidencePolicy: "literal" },
          children: [
            { id: 3, name: "小红书", extra: { evidencePolicy: "literal", keywords: ["xhs"] } },
            { id: 4, name: "抖音", extra: { evidencePolicy: "literal" } },
          ],
        },
      ],
    },
    {
      id: 10,
      name: "品类",
      extra: { evidencePolicy: "content" },
      children: [
        {
          id: 11,
          name: "护肤",
          extra: { evidencePolicy: "content" },
          children: [{ id: 12, name: "面霜", extra: { evidencePolicy: "content" } }],
        },
      ],
    },
    {
      id: 20,
      name: "渠道",
      extra: null,
      children: [{ id: 21, name: "线下", extra: null, children: [{ id: 22, name: "门店", extra: null }] }],
    },
  ];
}

describe("resolveEvidencePolicy", () => {
  it("prefers the explicit policy stored in extra", () => {
    expect(resolveEvidencePolicy({ evidencePolicy: "literal" }, ["品类", "护肤", "面霜"])).toBe("literal");
    expect(resolveEvidencePolicy({ evidencePolicy: "content" }, ["渠道", "线下", "门店"])).toBe("content");
  });

  it("falls back to the legacy 渠道 category heuristic when no policy is set", () => {
    expect(resolveEvidencePolicy(null, ["渠道", "线下", "门店"])).toBe("literal");
    expect(resolveEvidencePolicy(null, ["投放平台", "社交媒体", "小红书"])).toBe("content");
    expect(resolveEvidencePolicy(undefined, ["品类"])).toBe("content");
  });
});

describe("collectTagsMissingEvidencePolicy / applyEvidencePoliciesToTree", () => {
  it("lists every level lacking a policy and applies results in memory", () => {
    const tree = makeTree();
    const missing = collectTagsMissingEvidencePolicy(tree);
    expect(missing.map((node) => node.id)).toEqual([20, 21, 22]);
    expect(missing[2].tagPath).toEqual(["渠道", "线下", "门店"]);

    applyEvidencePoliciesToTree(tree, new Map([[22, "literal"]]));
    expect(collectTagsMissingEvidencePolicy(tree).map((node) => node.id)).toEqual([20, 21]);
    expect(resolveEvidencePolicy(tree[2].children![0].children![0].extra, [])).toBe("literal");
  });
});

describe("buildTagStructureText literal mark", () => {
  it("marks literal-policy tags and legacy 渠道 tags, but not content tags", () => {
    const text = buildTagStructureText(makeTree());
    expect(text).toContain(`小红书 ${LITERAL_EVIDENCE_TAG_MARK}`);
    expect(text).toContain(`门店 ${LITERAL_EVIDENCE_TAG_MARK}`);
    expect(text).not.toContain(`面霜 ${LITERAL_EVIDENCE_TAG_MARK}`);
  });
});

describe("enforceLiteralEvidenceForMetadataTags with evidence policies", () => {
  const tree = makeTree();

  it("drops a literal tag whose quote is in the text but unrelated to the tag (vibe-based citation)", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [
          { confidence: 0.7, leafTagId: 3, tagPath: ["投放平台", "社交媒体", "小红书"], evidence: "清新风格" },
          { confidence: 0.8, leafTagId: 12, tagPath: ["品类", "护肤", "面霜"] },
        ],
      },
    ];
    const result = enforceLiteralEvidenceForMetadataTags(predictions, tree, {
      contentAnalysis: "一张清新风格的面霜产品图，白色背景",
    });
    expect(result[0].tags.map((tag) => tag.leafTagId)).toEqual([12]);
  });

  it("keeps a literal tag when a CJK quote overlaps the tag name and appears in the text", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [{ confidence: 0.8, leafTagId: 3, tagPath: ["投放平台", "社交媒体", "小红书"], evidence: "红书 app 界面" }],
      },
    ];
    const result = enforceLiteralEvidenceForMetadataTags(predictions, tree, {
      contentAnalysis: "截图显示红书 app 界面，右上角有分享按钮",
    });
    expect(result[0].tags.map((tag) => tag.leafTagId)).toEqual([3]);
  });

  it("keeps a literal tag when the model's quoted evidence literally appears in the source text (alias resolution)", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [{ confidence: 0.9, leafTagId: 4, tagPath: ["投放平台", "社交媒体", "抖音"], evidence: "dy_feed" }],
      },
    ];
    const result = enforceLiteralEvidenceForMetadataTags(predictions, tree, {
      basicInfo: "20260901_dy_feed_banner.png",
    });
    expect(result[0].tags.map((tag) => tag.leafTagId)).toEqual([4]);
  });

  it("rejects a quoted evidence that is not actually in the source text", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [{ confidence: 0.9, leafTagId: 4, tagPath: ["投放平台", "社交媒体", "抖音"], evidence: "抖音" }],
      },
    ];
    const result = enforceLiteralEvidenceForMetadataTags(predictions, tree, {
      basicInfo: "20260901_summer_banner.png",
    });
    expect(result[0].tags).toEqual([]);
  });

  it("rejects a single-character quote so trivial substrings cannot pass", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "materializedPath",
        tags: [{ confidence: 0.9, leafTagId: 4, tagPath: ["投放平台", "社交媒体", "抖音"], evidence: "a" }],
      },
    ];
    const result = enforceLiteralEvidenceForMetadataTags(predictions, tree, {
      materializedPath: "/brand/a/banner",
    });
    expect(result[0].tags).toEqual([]);
  });

  it("still accepts configured keywords without a quote (backward compatible)", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "tagKeywords",
        tags: [{ confidence: 0.9, leafTagId: 3, tagPath: ["投放平台", "社交媒体", "小红书"] }],
      },
    ];
    const result = enforceLiteralEvidenceForMetadataTags(predictions, tree, {
      tagKeywords: "xhs_0901_kv.jpg",
    });
    expect(result[0].tags.map((tag) => tag.leafTagId)).toEqual([3]);
  });

  it("skips sources whose evidence text was not provided", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "materializedPath",
        tags: [{ confidence: 0.9, leafTagId: 4, tagPath: ["投放平台", "社交媒体", "抖音"] }],
      },
    ];
    expect(enforceLiteralEvidenceForMetadataTags(predictions, tree, {})).toEqual(predictions);
  });
});

describe("isPlausibleEvidenceQuoteForTag", () => {
  it("trusts short ascii aliases but not long ascii phrases", () => {
    expect(isPlausibleEvidenceQuoteForTag("xhs", ["小红书"])).toBe(true);
    expect(isPlausibleEvidenceQuoteForTag("TMALL", ["天猫"])).toBe(true);
    expect(isPlausibleEvidenceQuoteForTag("1111", ["双十一"])).toBe(true);
    expect(isPlausibleEvidenceQuoteForTag("a beautiful summer campaign", ["天猫"])).toBe(false);
  });

  it("requires CJK quotes to overlap the tag name or keywords", () => {
    expect(isPlausibleEvidenceQuoteForTag("清新风格", ["小红书"])).toBe(false);
    expect(isPlausibleEvidenceQuoteForTag("红书", ["小红书"])).toBe(true);
    expect(isPlausibleEvidenceQuoteForTag("双11大促", ["双十一", "双11"])).toBe(true);
    expect(isPlausibleEvidenceQuoteForTag("x", ["小红书"])).toBe(false);
  });
});

describe("content-only rejection feedback", () => {
  it("detects predictions supported only by contentAnalysis", () => {
    expect(isContentOnlySupport({ contentAnalysis: 0.7 })).toBe(true);
    expect(isContentOnlySupport({ contentAnalysis: 0.7, basicInfo: 0.9 })).toBe(false);
    expect(isContentOnlySupport({ basicInfo: 0.9 })).toBe(false);
    expect(isContentOnlySupport(undefined)).toBe(false);
  });

  it("downgrades to literal once the threshold is reached, and never counts explicit literal tags", () => {
    let extra = applyContentOnlyRejection({ keywords: ["a"] }).extra;
    for (let i = 1; i < CONTENT_ONLY_REJECTION_AUTO_LITERAL_THRESHOLD - 1; i++) {
      extra = applyContentOnlyRejection(extra).extra;
    }
    expect(extra.evidencePolicy).toBeUndefined();

    const final = applyContentOnlyRejection(extra);
    expect(final.downgraded).toBe(true);
    expect(final.extra).toMatchObject({
      keywords: ["a"],
      evidencePolicy: "literal",
      evidencePolicySource: "feedback",
      contentOnlyRejectionCount: CONTENT_ONLY_REJECTION_AUTO_LITERAL_THRESHOLD,
    });

    const again = applyContentOnlyRejection(final.extra);
    expect(again.downgraded).toBe(false);
    expect(again.extra).toEqual(final.extra);
  });
});
