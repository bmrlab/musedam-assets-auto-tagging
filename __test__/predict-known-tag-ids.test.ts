import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  filterPredictionsByKnownTagIds,
  repairToPredictionEnvelopeText,
} from "@/app/(tagging)/predict";
import { SourceBasedTagPredictions } from "@/app/(tagging)/types";
import { buildTagStructureText } from "@/app/(tagging)/utils";
import { TagWithChildren } from "@/prisma/client";

const tagsTree: TagWithChildren[] = [
  {
    id: 1,
    name: "媒体类型",
    extra: null,
    children: [
      {
        id: 2,
        name: "图片",
        extra: null,
        children: [{ id: 3, name: "产品图", extra: null }],
      },
    ],
  },
];

describe("filterPredictionsByKnownTagIds", () => {
  it("drops a hallucinated id whose path cannot be recovered", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [{ confidence: 0.9, leafTagId: 999, tagPath: ["不存在", "的", "标签"] }],
      },
    ];
    const result = filterPredictionsByKnownTagIds(predictions, tagsTree);
    expect(result.predictions[0].tags).toEqual([]);
    expect(result.dropped).toEqual([
      { source: "basicInfo", leafTagId: 999, tagPath: ["不存在", "的", "标签"] },
    ]);
    expect(result.corrected).toEqual([]);
  });

  it("recovers the id from tagPath when the id is wrong but the path exists", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [{ confidence: 0.8, leafTagId: 42, tagPath: ["媒体类型", "图片", "产品图"] }],
      },
    ];
    const result = filterPredictionsByKnownTagIds(predictions, tagsTree);
    expect(result.predictions[0].tags).toEqual([
      { confidence: 0.8, leafTagId: 3, tagPath: ["媒体类型", "图片", "产品图"] },
    ]);
    expect(result.corrected).toEqual([
      { source: "contentAnalysis", fromLeafTagId: 42, toLeafTagId: 3 },
    ]);
    expect(result.dropped).toEqual([]);
  });

  it("overwrites a wrong tagPath with the real path when the id is valid", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "materializedPath",
        tags: [{ confidence: 0.7, leafTagId: 3, tagPath: ["媒体类型", "视频", "产品图"] }],
      },
    ];
    const result = filterPredictionsByKnownTagIds(predictions, tagsTree);
    expect(result.predictions[0].tags[0].tagPath).toEqual(["媒体类型", "图片", "产品图"]);
    expect(result.dropped).toEqual([]);
    expect(result.corrected).toEqual([]);
  });

  it("prefers tagPath over a valid-but-different id (adjacent sibling id slip)", () => {
    // 回归：绿色的车被打成"蓝色系"。模型 tagPath 写的是绿色系，leafTagId 却抄成了相邻的蓝色系 id，
    // 旧逻辑"id 合法就以 id 为准"把预测静默改成蓝色系且置信度原样保留。
    const colorTree: TagWithChildren[] = [
      {
        id: 10,
        name: "CMF属性",
        extra: null,
        children: [
          {
            id: 11,
            name: "基础色系",
            extra: null,
            children: [
              { id: 12, name: "蓝色系", extra: null },
              { id: 13, name: "绿色系", extra: null },
            ],
          },
        ],
      },
    ];
    const predictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [
          {
            confidence: 0.78,
            leafTagId: 12,
            tagPath: ["CMF属性", "基础色系", "绿色系"],
            evidence: "车身呈现鲜艳的绿色",
          },
        ],
      },
    ];
    const result = filterPredictionsByKnownTagIds(predictions, colorTree);
    expect(result.predictions[0].tags).toEqual([
      {
        confidence: 0.78,
        leafTagId: 13,
        tagPath: ["CMF属性", "基础色系", "绿色系"],
        evidence: "车身呈现鲜艳的绿色",
      },
    ]);
    expect(result.corrected).toEqual([
      { source: "contentAnalysis", fromLeafTagId: 12, toLeafTagId: 13 },
    ]);
    expect(result.dropped).toEqual([]);
  });

  it("keeps level-1 and level-2 ids, since the prompt allows any level", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [
          { confidence: 0.6, leafTagId: 1, tagPath: ["媒体类型"] },
          { confidence: 0.6, leafTagId: 2, tagPath: ["媒体类型", "图片"] },
        ],
      },
    ];
    const result = filterPredictionsByKnownTagIds(predictions, tagsTree);
    expect(result.predictions[0].tags.map((tag) => tag.leafTagId)).toEqual([1, 2]);
  });
});

describe("filterPredictionsByKnownTagIds on 4-level trees", () => {
  const fourLevelTree: TagWithChildren[] = [
    {
      id: 1,
      name: "车型信息",
      extra: null,
      children: [
        {
          id: 2,
          name: "品牌",
          extra: null,
          children: [
            {
              id: 3,
              name: "小米汽车",
              extra: null,
              children: [
                { id: 4, name: "SU7", extra: null },
                { id: 5, name: "YU7", extra: null },
              ],
            },
          ],
        },
      ],
    },
  ];

  it("keeps valid level-4 ids and recovers a wrong level-4 id from its tagPath", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "contentAnalysis",
        tags: [
          { confidence: 0.9, leafTagId: 4, tagPath: ["车型信息", "品牌", "小米汽车", "SU7"] },
          { confidence: 0.8, leafTagId: 4, tagPath: ["车型信息", "品牌", "小米汽车", "YU7"] },
          { confidence: 0.7, leafTagId: 3, tagPath: ["车型信息", "品牌", "小米汽车"] },
        ],
      },
    ];
    const result = filterPredictionsByKnownTagIds(predictions, fourLevelTree);
    expect(result.predictions[0].tags.map((tag) => tag.leafTagId)).toEqual([4, 5, 3]);
    expect(result.corrected).toEqual([
      { source: "contentAnalysis", fromLeafTagId: 4, toLeafTagId: 5 },
    ]);
    expect(result.dropped).toEqual([]);
  });

  it("overwrites a wrong tagPath with the real 4-level path when the id is valid", () => {
    const predictions: SourceBasedTagPredictions = [
      {
        source: "basicInfo",
        tags: [{ confidence: 0.7, leafTagId: 5, tagPath: ["不存在", "YU7"] }],
      },
    ];
    const result = filterPredictionsByKnownTagIds(predictions, fourLevelTree);
    expect(result.predictions[0].tags[0].tagPath).toEqual(["车型信息", "品牌", "小米汽车", "YU7"]);
  });
});

describe("repairToPredictionEnvelopeText", () => {
  it("logs a warning instead of failing silently when the text cannot be repaired", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(repairToPredictionEnvelopeText("not json at all", { attempt: 2 })).toBe(
        '{"predictions":[]}',
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][1]).toMatchObject({ stage: "no-bracket", attempt: 2 });
    } finally {
      warn.mockRestore();
    }
  });

  it("does not log when the text is already valid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(repairToPredictionEnvelopeText('{"predictions":[]}')).toBe('{"predictions":[]}');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("buildTagStructureText", () => {
  it("separates each level-1 tag with a blank line (no stray \\L escape)", () => {
    const text = buildTagStructureText(tagsTree);
    expect(text.startsWith("\nLevel 1 (id: 1): 媒体类型\n")).toBe(true);
    expect(text).not.toContain("\\L");
  });

  it("renders a 3-level tree exactly as before", () => {
    expect(buildTagStructureText(tagsTree)).toBe(
      "\nLevel 1 (id: 1): 媒体类型\n" +
        "  └─ Level 2 (id: 2): 图片\n" +
        "      └─ Level 3 (id: 3): 产品图\n",
    );
  });

  it("renders level 4 and gives every non-leaf node (incl. level 3) its group marks", () => {
    const tree: TagWithChildren[] = [
      {
        id: 1,
        name: "车型信息",
        extra: null,
        children: [
          {
            id: 2,
            name: "品牌",
            extra: null,
            children: [
              {
                id: 3,
                name: "小米汽车",
                extra: { siblingsExclusive: true, requiredGroup: true },
                children: [
                  { id: 4, name: "SU7", extra: { siblingsExclusive: true } },
                  { id: 5, name: "YU7", extra: null },
                ],
              },
            ],
          },
        ],
      },
    ];
    const text = buildTagStructureText(tree, new Map([[3, { total: 5, shown: 2 }]]));
    expect(text).toBe(
      "\nLevel 1 (id: 1): 车型信息\n" +
        "  └─ Level 2 (id: 2): 品牌\n" +
        "      └─ Level 3 (id: 3): 小米汽车 【同级互斥】 【必选】 （共 5 个子标签，仅列出在素材文字信息中字面出现的 2 个）\n" +
        // 叶子（第 3 级及更深）不输出分组标记
        "          └─ Level 4 (id: 4): SU7\n" +
        "          └─ Level 4 (id: 5): YU7\n",
    );
  });
});
