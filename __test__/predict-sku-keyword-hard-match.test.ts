import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  calculateTagScore,
  enforceTextualSourceEvidence,
  enhancePredictionsByMaterializedPathHardMatch,
  enhancePredictionsByTagKeywordsHardMatch,
  filterTagsWithScoreByRecognitionAccuracy,
  normalizeForMatch,
  pathIncludesKeyword,
  pruneLargeLiteralGroupsForPrompt,
  resolveExclusiveSiblings,
} from "@/app/(tagging)/predict";
import { SourceBasedTagPredictions } from "@/app/(tagging)/types";
import { buildTagStructureText } from "@/app/(tagging)/utils";
import { TagWithChildren } from "@/prisma/client";

// 复现客户案例：路径 产品素材文件资料/兔笼/KF12.0066/FR/APP，文件名 A+7.jpg
const tagsTree: TagWithChildren[] = [
  {
    id: 1,
    name: "SKU编码",
    extra: { evidencePolicy: "literal", siblingsExclusive: true },
    children: [
      {
        id: 2,
        name: "KF",
        extra: { evidencePolicy: "literal", siblingsExclusive: true },
        children: [
          { id: 3, name: "KF09.127S1", extra: { evidencePolicy: "literal" } },
          { id: 4, name: "KF12.0066", extra: { evidencePolicy: "literal" } },
        ],
      },
    ],
  },
  {
    id: 10,
    name: "内容类型",
    extra: { evidencePolicy: "literal", siblingsExclusive: false },
    children: [
      { id: 11, name: "主图", extra: { evidencePolicy: "literal" } },
      { id: 12, name: "A+页面", extra: { evidencePolicy: "literal", keywords: ["A+", "亚马逊"] } },
      {
        id: 13,
        name: "Banner",
        extra: { evidencePolicy: "literal", keywords: ["A+"], negativeKeywords: ["a+7"] },
      },
    ],
  },
] as unknown as TagWithChildren[];

const name = "A+7.jpg";
const path = "产品素材文件资料/兔笼/KF12.0066/FR/APP";
const basicInfoText = normalizeForMatch(name);
const pathText = normalizeForMatch(path);

describe("SKU path hard match vs model's wrong sibling", () => {
  it("keeps the SKU literally in the path over a higher-confidence model guess", () => {
    let predictions: SourceBasedTagPredictions = [
      {
        source: "materializedPath",
        tags: [
          {
            leafTagId: 3,
            tagPath: ["SKU编码", "KF", "KF09.127S1"],
            confidence: 0.99,
            evidence: "KF",
          },
        ],
      },
    ];
    predictions = enforceTextualSourceEvidence(predictions, tagsTree, {
      basicInfo: basicInfoText,
      materializedPath: pathText,
    });
    predictions = enhancePredictionsByMaterializedPathHardMatch(predictions, tagsTree, path);
    predictions = resolveExclusiveSiblings(predictions, tagsTree, `${basicInfoText} ${pathText}`);
    const ids = calculateTagScore(predictions).map((tag) => tag.leafTagId);
    expect(ids).toContain(4);
    expect(ids).not.toContain(3);
  });
});

describe("enhancePredictionsByTagKeywordsHardMatch", () => {
  it("injects level-2 tags whose configured keyword appears in the file name", () => {
    const predictions = enhancePredictionsByTagKeywordsHardMatch([], tagsTree, `${name} ${path}`);
    const kept = filterTagsWithScoreByRecognitionAccuracy(
      calculateTagScore(predictions),
      "balanced",
    );
    expect(kept.map((tag) => tag.leafTagId)).toEqual([12]);
    expect(kept[0].score).toBeGreaterThanOrEqual(90);
  });

  it("skips tags whose negative keyword also appears", () => {
    const predictions = enhancePredictionsByTagKeywordsHardMatch([], tagsTree, name);
    expect(predictions.flatMap((p) => p.tags).map((tag) => tag.leafTagId)).not.toContain(13);
  });
});

describe("pruneLargeLiteralGroupsForPrompt", () => {
  const skuLeaves = Array.from({ length: 40 }, (_, i) => ({
    id: 100 + i,
    name: `KF${String(i).padStart(2, "0")}.0066`,
    extra: { evidencePolicy: "literal" },
  }));
  const contentLeaves = Array.from({ length: 40 }, (_, i) => ({
    id: 200 + i,
    name: `品类${i}`,
    extra: { evidencePolicy: "content" },
  }));
  const bigTree = [
    {
      id: 1,
      name: "SKU编码",
      extra: { evidencePolicy: "literal" },
      children: [{ id: 2, name: "KF", extra: { evidencePolicy: "literal" }, children: skuLeaves }],
    },
    { id: 3, name: "产品分类", extra: { evidencePolicy: "content" }, children: contentLeaves },
  ] as unknown as TagWithChildren[];

  it("keeps only literally mentioned children of large literal groups", () => {
    const { tagsTree, prunedGroups } = pruneLargeLiteralGroupsForPrompt(
      bigTree,
      "产品素材文件资料/兔笼/KF12.0066/FR/APP A+7.jpg",
    );
    expect(tagsTree[0].children?.[0].children?.map((tag) => tag.id)).toEqual([112]);
    expect(prunedGroups.get(2)).toEqual({ total: 40, shown: 1 });
    // 内容型分组不裁剪
    expect(tagsTree[1].children).toHaveLength(40);
    const text = buildTagStructureText(tagsTree, prunedGroups);
    expect(text).toContain("共 40 个子标签，仅列出在素材文字信息中字面出现的 1 个");
    expect(text).not.toContain("KF09.0066");
  });

  it("lists no children of a large literal group with no literal hit, without contradicting 必选", () => {
    const { tagsTree, prunedGroups } = pruneLargeLiteralGroupsForPrompt(bigTree, "A+7.jpg");
    expect(tagsTree[0].children?.[0].children).toEqual([]);
    const text = buildTagStructureText(tagsTree, prunedGroups);
    expect(text).toContain("均未在素材文字信息中字面出现，因此未列出");
    expect(text).not.toContain("不要选择");
  });

  it("leaves small literal groups untouched", () => {
    const pruned = pruneLargeLiteralGroupsForPrompt(tagsTree, "x");
    expect(pruned.prunedGroups.size).toBe(0);
    expect(pruned.tagsTree[0].children?.[0].children).toHaveLength(2);
  });
});

describe("pathIncludesKeyword boundaries", () => {
  it("does not let a SKU match a longer SKU that starts or ends with it", () => {
    expect(pathIncludesKeyword("兔笼/kf12.00661/fr", "kf12.0066")).toBe(false);
    expect(pathIncludesKeyword("兔笼/xkf12.0066/fr", "kf12.0066")).toBe(false);
    expect(pathIncludesKeyword("兔笼/kf12.0066/fr", "kf12.0066")).toBe(true);
    expect(pathIncludesKeyword("兔笼kf12.0066_fr", "kf12.0066")).toBe(true);
  });

  it("keeps substring matching on symbol / CJK edges", () => {
    expect(pathIncludesKeyword("a+7.jpg", "a+")).toBe(true);
    expect(pathIncludesKeyword("修护面霜", "面霜")).toBe(true);
    expect(pathIncludesKeyword("2026_a+页面", "a+页面")).toBe(true);
  });
});
