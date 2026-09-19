import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateObjectMock = vi.fn();
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: (...args: unknown[]) => generateObjectMock(...args) };
});
vi.mock("@/ai/provider", () => ({ llm: (name: string) => ({ name }) }));

import {
  calculateTagScore,
  ensureRequiredGroups,
  filterTagsWithScoreByRecognitionAccuracy,
  predictRequiredGroupChoices,
  REQUIRED_FALLBACK_SCORE,
  resolveExclusiveSiblings,
} from "@/app/(tagging)/predict";
import { SourceBasedTagPredictions, TagWithScore } from "@/app/(tagging)/types";
import { buildTagStructureText, REQUIRED_GROUP_TAG_MARK } from "@/app/(tagging)/utils";
import { TagWithChildren } from "@/prisma/client";

// 品牌产品线：必打 + 互斥；渠道触点：必打、非互斥；画幅：必打但属于画幅组（应跳过）
const tagsTree: TagWithChildren[] = [
  {
    id: 100,
    name: "品牌产品线",
    extra: { siblingsExclusive: true, requiredGroup: true },
    children: [
      { id: 101, name: "雪花秀", extra: {}, children: [{ id: 102, name: "人参系列", extra: {} }] },
      { id: 111, name: "悦诗风吟", extra: {}, children: [{ id: 112, name: "洁面", extra: {} }] },
    ],
  },
  {
    id: 200,
    name: "渠道触点",
    extra: { siblingsExclusive: false, requiredGroup: true },
    children: [
      { id: 201, name: "抖音", extra: {} },
      { id: 202, name: "天猫", extra: {} },
    ],
  },
  {
    id: 300,
    name: "画幅",
    extra: { requiredGroup: true },
    children: [
      { id: 301, name: "1:1", extra: {} },
      { id: 302, name: "9:16", extra: {} },
    ],
  },
  {
    id: 400,
    name: "风格",
    extra: { requiredGroup: false },
    children: [{ id: 401, name: "极简", extra: {} }],
  },
];

const scored = (leafTagId: number, tagPath: string[], score: number): TagWithScore => ({
  leafTagId,
  tagPath,
  confidenceBySources: { contentAnalysis: score / 100 },
  score,
});

describe("buildTagStructureText required mark", () => {
  it("marks required categories on level 1/2 only", () => {
    const text = buildTagStructureText(tagsTree);
    expect(text).toContain(`品牌产品线 【同级互斥】 ${REQUIRED_GROUP_TAG_MARK}`);
    expect(text).toContain(`渠道触点 【字面证据】 ${REQUIRED_GROUP_TAG_MARK}`);
    expect(text).not.toContain(`风格 ${REQUIRED_GROUP_TAG_MARK}`);
    expect(text).not.toContain(`抖音 ${REQUIRED_GROUP_TAG_MARK}`);
  });
});

describe("ensureRequiredGroups", () => {
  it("leaves the result alone when every required group already has a descendant", () => {
    const final = [
      scored(102, ["品牌产品线", "雪花秀", "人参系列"], 90),
      scored(201, ["渠道触点", "抖音"], 85),
    ];
    const result = ensureRequiredGroups(final, final, tagsTree);
    expect(result.tagsWithScore).toEqual(final);
    expect(result.readmitted).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("re-admits the best pre-threshold candidate with origin requiredFallback", () => {
    const final = [scored(201, ["渠道触点", "抖音"], 85)];
    const allScored = [
      ...final,
      scored(112, ["品牌产品线", "悦诗风吟", "洁面"], 45),
      scored(102, ["品牌产品线", "雪花秀", "人参系列"], 52),
    ];
    const result = ensureRequiredGroups(final, allScored, tagsTree);
    expect(result.tagsWithScore).toEqual([
      final[0],
      { ...allScored[2], origin: "requiredFallback" },
    ]);
    expect(result.readmitted).toEqual([
      { parentId: 100, leafTagId: 102, tagPath: ["品牌产品线", "雪花秀", "人参系列"], score: 52 },
    ]);
  });

  it("reports required groups with no candidate at all, skipping aspect-ratio groups", () => {
    const final = [scored(401, ["风格", "极简"], 80)];
    const result = ensureRequiredGroups(final, final, tagsTree);
    expect(result.tagsWithScore).toEqual(final);
    expect(result.missing).toEqual([
      { parentId: 100, parentPath: ["品牌产品线"] },
      { parentId: 200, parentPath: ["渠道触点"] },
    ]);
  });

  it("required + exclusive: fallback only sees the branch that survived the hard constraint", () => {
    let predictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [
          { confidence: 0.5, leafTagId: 112, tagPath: ["品牌产品线", "悦诗风吟", "洁面"] },
          { confidence: 0.55, leafTagId: 102, tagPath: ["品牌产品线", "雪花秀", "人参系列"] },
          { confidence: 0.9, leafTagId: 201, tagPath: ["渠道触点", "抖音"] },
        ],
      },
    ];
    predictions = resolveExclusiveSiblings(predictions, tagsTree);
    const allScored = calculateTagScore(predictions);
    const final = filterTagsWithScoreByRecognitionAccuracy(allScored, "precise");
    expect(final.map((tag) => tag.leafTagId)).toEqual([201]);
    const result = ensureRequiredGroups(final, allScored, tagsTree);
    expect(result.tagsWithScore.map((tag) => tag.leafTagId)).toEqual([201, 102]);
    expect(result.tagsWithScore[1].origin).toBe("requiredFallback");
  });
});

describe("predictRequiredGroupChoices", () => {
  it("returns nothing when nothing is missing and never calls the model", async () => {
    generateObjectMock.mockReset();
    const tags = await predictRequiredGroupChoices({
      missing: [],
      tagsTree,
      assetSummary: "",
      teamId: 1,
    });
    expect(tags).toEqual([]);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("uses the model's choice when it is a leaf under the required group", async () => {
    generateObjectMock.mockReset().mockResolvedValue({
      object: {
        choices: [
          { parentId: 100, leafTagId: 112 },
          { parentId: 200, leafTagId: 202 },
        ],
      },
    });
    const tags = await predictRequiredGroupChoices({
      missing: [
        { parentId: 100, parentPath: ["品牌产品线"] },
        { parentId: 200, parentPath: ["渠道触点"] },
      ],
      tagsTree,
      assetSummary: "文件名：x",
      teamId: 1,
    });
    expect(tags).toEqual([
      expect.objectContaining({
        leafTagId: 112,
        tagPath: ["品牌产品线", "悦诗风吟", "洁面"],
        score: REQUIRED_FALLBACK_SCORE,
        origin: "requiredFallback",
      }),
      expect.objectContaining({
        leafTagId: 202,
        tagPath: ["渠道触点", "天猫"],
        score: REQUIRED_FALLBACK_SCORE,
        origin: "requiredFallback",
      }),
    ]);
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const prompt = generateObjectMock.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("parentId: 100");
    expect(prompt).toContain("id 112");
    expect(prompt).not.toContain("id 101"); // 非叶子不作为候选
  });

  it("falls back to the first leaf when the model picks an invalid id or fails", async () => {
    generateObjectMock.mockReset().mockResolvedValue({
      object: { choices: [{ parentId: 100, leafTagId: 999 }] },
    });
    const invalid = await predictRequiredGroupChoices({
      missing: [{ parentId: 100, parentPath: ["品牌产品线"] }],
      tagsTree,
      assetSummary: "",
      teamId: 1,
    });
    expect(invalid.map((tag) => tag.leafTagId)).toEqual([102]);

    generateObjectMock.mockReset().mockRejectedValue(new Error("boom"));
    const failed = await predictRequiredGroupChoices({
      missing: [{ parentId: 200, parentPath: ["渠道触点"] }],
      tagsTree,
      assetSummary: "",
      teamId: 1,
    });
    expect(failed.map((tag) => tag.leafTagId)).toEqual([201]);
    expect(failed[0].score).toBe(REQUIRED_FALLBACK_SCORE);
  });
});
