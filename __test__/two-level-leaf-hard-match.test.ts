import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  enhancePredictionsByMaterializedPathHardMatch,
  resolveExclusiveSiblings,
} from "@/app/(tagging)/predict";
import { SourceBasedTagPredictions } from "@/app/(tagging)/types";
import { TagWithChildren } from "@/prisma/client";

// 复现客户案例："产品分类"（必打 + 仅能打一个）下的"兔笼"是没有三级的二级标签，
// 路径里写着兔笼，却被打成了同组的其他标签。
const tagsTree: TagWithChildren[] = [
  {
    id: 1,
    name: "产品分类",
    extra: { siblingsExclusive: true, requiredGroup: true },
    children: [
      { id: 2, name: "灯光", extra: {}, children: [] },
      { id: 3, name: "兔笼", extra: {}, children: [] },
      { id: 4, name: "镜头", extra: {} },
      { id: 5, name: "镜头转接环", extra: {} },
    ],
  },
] as unknown as TagWithChildren[];

const ids = (predictions: SourceBasedTagPredictions) =>
  predictions.flatMap((p) => p.tags.map((t) => t.leafTagId));

describe("hard match on two-level leaf tags", () => {
  it("injects a two-level leaf tag found in the folder path and keeps it in the exclusive group", () => {
    const path = "产品素材文件资料/兔笼/kf12.0066/fr/app";
    const modelPredictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [{ leafTagId: 2, tagPath: ["产品分类", "灯光"], confidence: 0.95 }],
      },
    ];
    const enhanced = enhancePredictionsByMaterializedPathHardMatch(
      modelPredictions,
      tagsTree,
      path,
    );
    expect(enhanced.find((p) => p.source === "materializedPath")?.tags).toEqual([
      { leafTagId: 3, tagPath: ["产品分类", "兔笼"], confidence: 0.9 },
    ]);
    expect(ids(resolveExclusiveSiblings(enhanced, tagsTree, path))).toEqual([3]);
  });

  it("prefers the longer literal hit when one tag name contains another", () => {
    const path = "产品素材/镜头转接环/a+1.jpg";
    const enhanced = enhancePredictionsByMaterializedPathHardMatch([], tagsTree, path);
    expect(ids(enhanced).sort()).toEqual([4, 5]);
    expect(ids(resolveExclusiveSiblings(enhanced, tagsTree, path))).toEqual([5]);
  });

  it("hard-matches level-4 leaves and treats level-3 nodes with children as groups, not leaves", () => {
    // 4 级树：产品分类(互斥) > 摄影配件 > 镜头(有子标签) > 广角镜头 / 长焦镜头；
    // 产品分类 > 摄影配件 > 兔笼（没有四级的三级标签本身就是叶子）
    const fourLevelTree = [
      {
        id: 1,
        name: "产品分类",
        extra: { siblingsExclusive: true },
        children: [
          {
            id: 2,
            name: "摄影配件",
            extra: {},
            children: [
              {
                id: 3,
                name: "镜头",
                extra: { siblingsExclusive: true },
                children: [
                  { id: 4, name: "广角镜头", extra: {} },
                  { id: 5, name: "长焦镜头", extra: {} },
                ],
              },
              { id: 6, name: "兔笼", extra: {}, children: [] },
            ],
          },
        ],
      },
    ] as unknown as TagWithChildren[];

    const deepPath = "产品素材/广角镜头/a.jpg";
    const deep = enhancePredictionsByMaterializedPathHardMatch([], fourLevelTree, deepPath);
    expect(deep.find((p) => p.source === "materializedPath")?.tags).toEqual([
      { leafTagId: 4, tagPath: ["产品分类", "摄影配件", "镜头", "广角镜头"], confidence: 0.9 },
    ]);

    // "镜头" 有四级子标签，是分类节点而非叶子：路径里只出现"镜头"不会把它当叶子注入
    const groupOnly = enhancePredictionsByMaterializedPathHardMatch(
      [],
      fourLevelTree,
      "产品素材/镜头/a.jpg",
    );
    expect(ids(groupOnly)).not.toContain(3);

    const level3Leaf = enhancePredictionsByMaterializedPathHardMatch(
      [],
      fourLevelTree,
      "产品素材/兔笼/a.jpg",
    );
    expect(ids(level3Leaf)).toEqual([6]);

    // 4 级互斥：同一互斥组（镜头）下两个四级标签只保留字面命中的那个
    const both: SourceBasedTagPredictions = [
      ...deep,
      {
        source: "contentAnalysis",
        tags: [
          { leafTagId: 5, tagPath: ["产品分类", "摄影配件", "镜头", "长焦镜头"], confidence: 0.95 },
        ],
      },
    ];
    expect(ids(resolveExclusiveSiblings(both, fourLevelTree, deepPath))).toEqual([4]);
  });
});
