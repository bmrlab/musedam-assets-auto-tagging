import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  calculateTagScore,
  enforceTextualSourceEvidence,
  enhancePredictionsByBasicInfoHardMatch,
  EXCLUSIVE_SIBLING_LOSER_CONFIDENCE,
  filterTagsWithScoreByRecognitionAccuracy,
  resolveExclusiveSiblings,
} from "@/app/(tagging)/predict";
import { SourceBasedTagPredictions } from "@/app/(tagging)/types";
import { buildTagStructureText, SIBLINGS_EXCLUSIVE_TAG_MARK } from "@/app/(tagging)/utils";
import { TagWithChildren } from "@/prisma/client";

// 复现客户案例：文件名 20260727_TM_AES_修护霜_七夕场景_J，路径里没有任何品类词
const tagsTree: TagWithChildren[] = [
  {
    id: 1,
    name: "产品品类",
    extra: { evidencePolicy: "content", siblingsExclusive: false },
    children: [
      {
        id: 2,
        name: "护肤",
        extra: { evidencePolicy: "content", siblingsExclusive: true },
        children: [
          { id: 3, name: "洁面", extra: { evidencePolicy: "content" } },
          { id: 4, name: "面霜", extra: { evidencePolicy: "content" } },
          { id: 5, name: "喷雾", extra: { evidencePolicy: "content" } },
        ],
      },
    ],
  },
  {
    id: 10,
    name: "风格",
    extra: { evidencePolicy: "content", siblingsExclusive: false },
    children: [
      {
        id: 11,
        name: "视觉风格",
        extra: { evidencePolicy: "content", siblingsExclusive: false },
        children: [
          { id: 12, name: "极简", extra: { evidencePolicy: "content" } },
          { id: 13, name: "复古", extra: { evidencePolicy: "content" } },
        ],
      },
    ],
  },
];

const path = "/dc content/2) dc1 content/交付内容/aes/2026.07";
const basicInfo = "20260727_tm_aes_修护霜_七夕场景_j";

describe("enforceTextualSourceEvidence", () => {
  it("drops a materializedPath source the model invented for 洁面 (path never mentions it)", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "materializedPath",
        tags: [{ confidence: 0.85, leafTagId: 3, tagPath: ["产品品类", "护肤", "洁面"] }],
      },
      {
        source: "contentAnalysis",
        tags: [{ confidence: 0.8, leafTagId: 3, tagPath: ["产品品类", "护肤", "洁面"] }],
      },
    ];
    const result = enforceTextualSourceEvidence(predictions, tagsTree, { materializedPath: path });
    expect(result[0].tags).toEqual([]);
    expect(result[1].tags).toHaveLength(1); // contentAnalysis 不受此规则约束
  });

  it("keeps a basicInfo prediction whose quoted evidence really appears in the filename (synonym 修护霜 → 面霜)", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [
          { confidence: 0.9, leafTagId: 4, tagPath: ["产品品类", "护肤", "面霜"], evidence: "修护霜" },
          { confidence: 0.7, leafTagId: 3, tagPath: ["产品品类", "护肤", "洁面"], evidence: "洁面" },
        ],
      },
    ];
    const result = enforceTextualSourceEvidence(predictions, tagsTree, { basicInfo: basicInfo });
    expect(result[0].tags.map((tag) => tag.leafTagId)).toEqual([4]);
  });

  it("keeps a textual prediction without a quote when the tag name itself appears in the text", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [{ confidence: 0.9, leafTagId: 5, tagPath: ["产品品类", "护肤", "喷雾"] }],
      },
    ];
    const result = enforceTextualSourceEvidence(predictions, tagsTree, { basicInfo: "aes_喷雾_kv" });
    expect(result[0].tags).toHaveLength(1);
  });

  it("skips sources whose evidence text was not provided", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "materializedPath",
        tags: [{ confidence: 0.85, leafTagId: 3, tagPath: ["产品品类", "护肤", "洁面"] }],
      },
    ];
    expect(enforceTextualSourceEvidence(predictions, tagsTree, {})).toEqual(predictions);
  });
});

describe("resolveExclusiveSiblings", () => {
  it("keeps the sibling anchored by the filename and demotes content-only siblings", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [{ confidence: 0.9, leafTagId: 4, tagPath: ["产品品类", "护肤", "面霜"], evidence: "修护霜" }],
      },
      {
        source: "contentAnalysis",
        tags: [
          { confidence: 0.91, leafTagId: 3, tagPath: ["产品品类", "护肤", "洁面"] },
          { confidence: 0.87, leafTagId: 4, tagPath: ["产品品类", "护肤", "面霜"] },
          { confidence: 0.83, leafTagId: 5, tagPath: ["产品品类", "护肤", "喷雾"] },
        ],
      },
    ];
    const result = resolveExclusiveSiblings(predictions, tagsTree);
    const content = result[1].tags;
    expect(content.find((tag) => tag.leafTagId === 3)?.confidence).toBe(EXCLUSIVE_SIBLING_LOSER_CONFIDENCE);
    expect(content.find((tag) => tag.leafTagId === 4)?.confidence).toBe(0.87);
    expect(content.find((tag) => tag.leafTagId === 5)?.confidence).toBe(EXCLUSIVE_SIBLING_LOSER_CONFIDENCE);
    expect(result[0].tags[0].confidence).toBe(0.9);
  });

  it("keeps only the top-scored sibling when nothing is anchored", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [
          { confidence: 0.8, leafTagId: 3, tagPath: ["产品品类", "护肤", "洁面"] },
          { confidence: 0.7, leafTagId: 4, tagPath: ["产品品类", "护肤", "面霜"] },
        ],
      },
    ];
    const result = resolveExclusiveSiblings(predictions, tagsTree);
    expect(result[0].tags.map((tag) => tag.confidence)).toEqual([0.8, EXCLUSIVE_SIBLING_LOSER_CONFIDENCE]);
  });

  it("leaves non-exclusive groups alone even when several siblings are predicted", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [
          { confidence: 0.8, leafTagId: 12, tagPath: ["风格", "视觉风格", "极简"] },
          { confidence: 0.7, leafTagId: 13, tagPath: ["风格", "视觉风格", "复古"] },
        ],
      },
    ];
    expect(resolveExclusiveSiblings(predictions, tagsTree)).toEqual(predictions);
  });

  it("keeps two anchored siblings when the filename genuinely names both", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [
          { confidence: 0.9, leafTagId: 3, tagPath: ["产品品类", "护肤", "洁面"], evidence: "洁面" },
          { confidence: 0.9, leafTagId: 4, tagPath: ["产品品类", "护肤", "面霜"], evidence: "面霜" },
        ],
      },
      {
        source: "contentAnalysis",
        tags: [{ confidence: 0.83, leafTagId: 5, tagPath: ["产品品类", "护肤", "喷雾"] }],
      },
    ];
    const result = resolveExclusiveSiblings(predictions, tagsTree);
    expect(result[0].tags.map((tag) => tag.confidence)).toEqual([0.9, 0.9]);
    expect(result[1].tags[0].confidence).toBe(EXCLUSIVE_SIBLING_LOSER_CONFIDENCE);
  });
});

describe("end-to-end on the customer case (balanced mode)", () => {
  it("only 面霜 survives among the skincare siblings", () => {
    let predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [{ confidence: 0.9, leafTagId: 4, tagPath: ["产品品类", "护肤", "面霜"], evidence: "修护霜" }],
      },
      {
        source: "materializedPath",
        tags: [{ confidence: 0.85, leafTagId: 3, tagPath: ["产品品类", "护肤", "洁面"] }],
      },
      {
        source: "contentAnalysis",
        tags: [
          { confidence: 0.91, leafTagId: 3, tagPath: ["产品品类", "护肤", "洁面"] },
          { confidence: 0.87, leafTagId: 4, tagPath: ["产品品类", "护肤", "面霜"] },
          { confidence: 0.83, leafTagId: 5, tagPath: ["产品品类", "护肤", "喷雾"] },
        ],
      },
    ];
    predictions = enforceTextualSourceEvidence(predictions, tagsTree, {
      basicInfo,
      materializedPath: path,
    });
    predictions = enhancePredictionsByBasicInfoHardMatch(predictions, tagsTree, basicInfo);
    predictions = resolveExclusiveSiblings(predictions, tagsTree);
    const kept = filterTagsWithScoreByRecognitionAccuracy(calculateTagScore(predictions), "balanced");
    expect(kept.map((tag) => tag.leafTagId)).toEqual([4]);
    expect(kept[0].score).toBeGreaterThanOrEqual(90);
  });
});

describe("buildTagStructureText exclusive mark", () => {
  it("marks exclusive parent categories only", () => {
    const text = buildTagStructureText(tagsTree);
    expect(text).toContain(`护肤 ${SIBLINGS_EXCLUSIVE_TAG_MARK}`);
    expect(text).not.toContain(`视觉风格 ${SIBLINGS_EXCLUSIVE_TAG_MARK}`);
    expect(text).not.toContain(`面霜 ${SIBLINGS_EXCLUSIVE_TAG_MARK}`);
  });
});
