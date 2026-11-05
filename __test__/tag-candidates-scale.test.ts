import { flattenTagsTree } from "@/app/(tagging)/evidence-policy";
import {
  needsTagCandidateSelection,
  selectTagCandidates,
  TAG_PROMPT_CHAR_LIMIT,
  TAG_PROMPT_NODE_LIMIT,
} from "@/app/(tagging)/tag-candidates";
import { buildTagKeywordsText, buildTagStructureText } from "@/app/(tagging)/utils";
import type { TagWithChildren } from "@/prisma/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

function tree(count = 12000): TagWithChildren[] {
  return [
    {
      id: 1,
      name: "产品",
      extra: {},
      children: Array.from({ length: count }, (_, i) => ({
        id: i + 2,
        name: `SKU.K${String(i).padStart(5, "0")}`,
        extra: { keywords: [`别名${i}`], evidencePolicy: "content" },
      })),
    },
  ];
}
describe("large tag candidate recall", () => {
  it("retrieves a late exact match without sending 12000 labels to the model", () => {
    const tagsTree = tree();
    expect(needsTagCandidateSelection(tagsTree)).toBe(true);
    const selected = selectTagCandidates({ tagsTree, evidenceText: "商品 SKU.K11999 正面" });
    expect(selected.selectedIds.has(12001)).toBe(true);
    expect(selected.selectedIds.has(1)).toBe(true);
    expect(selected.selected).toBeLessThanOrEqual(TAG_PROMPT_NODE_LIMIT);
    expect(
      (buildTagStructureText(selected.tagsTree) + buildTagKeywordsText(selected.tagsTree)).length,
    ).toBeLessThanOrEqual(TAG_PROMPT_CHAR_LIMIT);
  });
  it("recalls English tag names from model-expanded Chinese semantic queries", () => {
    const tagsTree = tree();
    tagsTree[0].children![11999].name = "cleanser";
    const selected = selectTagCandidates({
      tagsTree,
      evidenceText: "脸部清洁产品",
      semanticTerms: ["cleanser", "facial wash"],
    });
    expect(selected.selectedIds.has(12001)).toBe(true);
  });
  it("includes full ancestor paths and excludes literal candidates pruned by the caller", () => {
    const full: TagWithChildren[] = [
      {
        id: 1,
        name: "父级",
        extra: {},
        children: [
          {
            id: 2,
            name: "中间层",
            extra: {},
            children: [
              { id: 3, name: "目标", extra: {} },
              { id: 4, name: "不得进入提示词", extra: {} },
            ],
          },
        ],
      },
    ];
    const eligible = structuredClone(full);
    eligible[0].children![0].children!.pop();
    const result = selectTagCandidates({
      tagsTree: full,
      eligibleTree: eligible,
      evidenceText: "目标 不得进入提示词",
    });
    expect(flattenTagsTree(result.tagsTree).map((node) => node.id)).toEqual([1, 2, 3]);
  });
  it("bounds keyword-heavy prompts as well as their node counts", () => {
    const tagsTree = tree(100);
    for (const leaf of tagsTree[0].children!)
      leaf.extra = {
        description: "描述".repeat(2000),
        keywords: Array.from({ length: 100 }, (_, i) => `${i}${"关键词".repeat(30)}`),
        negativeKeywords: ["排除".repeat(100)],
      };
    expect(needsTagCandidateSelection(tagsTree)).toBe(true);
    const result = selectTagCandidates({ tagsTree, evidenceText: "SKU.K00099" });
    expect(
      (buildTagStructureText(result.tagsTree) + buildTagKeywordsText(result.tagsTree)).length,
    ).toBeLessThanOrEqual(TAG_PROMPT_CHAR_LIMIT);
    expect(result.selectedIds.has(101)).toBe(true);
  });
});

it("does not use configured keywords when the tagKeywords source is disabled", () => {
  const tagsTree = tree();
  const enabled = selectTagCandidates({
    tagsTree,
    evidenceText: "别名11999",
    includeKeywords: true,
  });
  const disabled = selectTagCandidates({
    tagsTree,
    evidenceText: "别名11999",
    includeKeywords: false,
  });
  expect(enabled.selectedIds.has(12001)).toBe(true);
  expect(disabled.matched).toBe(0);
  expect(disabled.selectedIds.has(12001)).toBe(false);
});
