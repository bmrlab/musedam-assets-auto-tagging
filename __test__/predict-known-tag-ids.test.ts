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
});
