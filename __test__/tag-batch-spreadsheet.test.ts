import { describe, expect, it } from "vitest";
import {
  buildTagBatchExportRows,
  filterMissingPathRecords,
  getTagBatchColumns,
  parseTagBatchId,
  parseTagBatchTable,
  TAG_BATCH_MAX_ROWS,
  tagBatchRecordsToCreateTree,
} from "../src/app/tags/tagBatchSpreadsheet";

const headers = (locale: string) => getTagBatchColumns(locale).map((column) => column.header);

describe("parseTagBatchTable", () => {
  it("reads configurable fields onto the deepest tag in the path", () => {
    const parsed = parseTagBatchTable({
      maxLevel: 4,
      rows: [
        headers("zh-CN"),
        ["", "内容类型", "", "", "", "主要分类", "", "", "开启", "开启", "关闭"],
        [
          "",
          "内容类型",
          "图像资产",
          "产品图片",
          "",
          "产品主图",
          "主图；海报",
          "竞品\n样张",
          "关闭",
          "",
          "",
        ],
      ],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.records).toEqual([
      {
        rowNumber: 2,
        path: ["内容类型"],
        fields: {
          description: "主要分类",
          taggingEnabled: true,
          siblingsExclusive: true,
          requiredGroup: false,
        },
      },
      {
        rowNumber: 3,
        path: ["内容类型", "图像资产", "产品图片"],
        fields: {
          description: "产品主图",
          keywords: ["主图", "海报"],
          negativeKeywords: ["竞品", "样张"],
          taggingEnabled: false,
        },
      },
    ]);
  });

  it("parses tag id for round-trip updates and skips those rows from create tree", () => {
    const parsed = parseTagBatchTable({
      maxLevel: 3,
      rows: [
        headers("zh-CN"),
        ["12", "内容类型", "产品图片", "", "", "更新描述", "", "", "", "", ""],
        ["", "新一级", "新二级", "", "", "", "", "", "", "", ""],
      ],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.records[0]).toMatchObject({
      id: 12,
      path: ["内容类型", "产品图片"],
      fields: { description: "更新描述" },
    });
    expect(tagBatchRecordsToCreateTree(parsed.records)).toEqual([
      {
        name: "新一级",
        nameChildList: [{ name: "新二级" }],
      },
    ]);
  });

  it("allows id-only rows without level columns filled", () => {
    const parsed = parseTagBatchTable({
      maxLevel: 3,
      rows: [
        ["标签 ID", "匹配关键词"],
        ["99", "主图；海报"],
      ],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.records[0]).toEqual({
      rowNumber: 2,
      id: 99,
      path: [],
      fields: { keywords: ["主图", "海报"] },
    });
  });

  it("rejects invalid and duplicate ids", () => {
    const parsed = parseTagBatchTable({
      maxLevel: 3,
      rows: [
        headers("zh-CN"),
        ["abc", "内容类型", "", "", "", "", "", "", "", "", ""],
        ["8", "内容类型", "", "", "", "一次", "", "", "", "", ""],
        ["8", "内容类型", "子标签", "", "", "二次", "", "", "", "", ""],
      ],
    });

    expect(parsed.records).toHaveLength(1);
    expect(parsed.errors.map((error) => error.message)).toEqual([
      "标签 ID 必须为正整数",
      "文件中标签 ID 重复：8",
    ]);
  });

  it("accepts English headers and leaves blank switches unchanged", () => {
    const parsed = parseTagBatchTable({
      locale: "en-US",
      maxLevel: 3,
      rows: [
        headers("en-US"),
        ["", "Campaign", "Summer", "", "", "Seasonal", "poster", "", "", "", ""],
      ],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.records[0]).toMatchObject({
      path: ["Campaign", "Summer"],
      fields: {
        description: "Seasonal",
        keywords: ["poster"],
      },
    });
    expect(parsed.records[0].fields.taggingEnabled).toBeUndefined();
    expect(parsed.records[0].fields.siblingsExclusive).toBeUndefined();
    expect(parsed.records[0].fields.requiredGroup).toBeUndefined();
  });

  it("does not touch configurable fields when those columns are absent", () => {
    const parsed = parseTagBatchTable({
      maxLevel: 3,
      rows: [
        ["一级标签", "二级标签"],
        ["内容类型", "图像资产"],
      ],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.records[0].fields).toEqual({});
  });

  it("rejects skipped levels, a level beyond the team limit, and invalid switches", () => {
    const parsed = parseTagBatchTable({
      maxLevel: 3,
      rows: [
        headers("zh-CN"),
        ["", "内容类型", "", "图像资产", "", "", "", "", "", "", ""],
        ["", "内容类型", "图像", "海报", "主图", "", "", "", "", "", ""],
        ["", "内容类型", "", "", "", "", "", "", "也许", "", ""],
      ],
    });

    expect(parsed.records).toEqual([]);
    expect(parsed.errors.map((error) => error.message)).toEqual([
      "第2级标签为空，不能跳级填写",
      "超出当前团队标签层级上限",
      "AI 自动打标仅支持：开启/关闭、true/false、1/0",
    ]);
  });

  it("round-trips exported id and configurable fields", () => {
    const rows = buildTagBatchExportRows({
      locale: "zh-CN",
      tags: [
        {
          id: 1,
          name: "内容类型",
          taggingEnabled: true,
          extra: { description: "主要分类", siblingsExclusive: true, requiredGroup: false },
          children: [
            {
              id: 2,
              name: "产品图片",
              taggingEnabled: false,
              extra: { keywords: ["主图", "海报"], negativeKeywords: ["竞品"] },
            },
          ],
        },
      ],
    });

    const parsed = parseTagBatchTable({ maxLevel: 4, rows });
    expect(parsed.errors).toEqual([]);
    expect(parsed.records).toEqual([
      {
        rowNumber: 2,
        id: 1,
        path: ["内容类型"],
        fields: {
          description: "主要分类",
          taggingEnabled: true,
          siblingsExclusive: true,
          requiredGroup: false,
        },
      },
      {
        rowNumber: 3,
        id: 2,
        path: ["内容类型", "产品图片"],
        fields: {
          keywords: ["主图", "海报"],
          negativeKeywords: ["竞品"],
          taggingEnabled: false,
        },
      },
    ]);
    // 带 ID 的导出行不应再走路径新建
    expect(tagBatchRecordsToCreateTree(parsed.records)).toEqual([]);
  });
});

describe("parseTagBatchId", () => {
  it("accepts positive integers and excel-style whole numbers", () => {
    expect(parseTagBatchId("12")).toBe(12);
    expect(parseTagBatchId("12.0")).toBe(12);
    expect(parseTagBatchId("")).toBeUndefined();
    expect(Number.isNaN(parseTagBatchId("12.5"))).toBe(true);
    expect(Number.isNaN(parseTagBatchId("0"))).toBe(true);
    expect(Number.isNaN(parseTagBatchId("9007199254740993"))).toBe(true);
  });
});

describe("tag batch import helpers", () => {
  it.each([101, 5000])("round-trips %i matching and exclusion keywords without truncation", (count) => {
    const keywords = Array.from({ length: count }, (_, index) => `SKU.${index}`);
    const negativeKeywords = Array.from({ length: count }, (_, index) => `EXCLUDED.${index}`);
    const rows = buildTagBatchExportRows({
      locale: "zh-CN",
      tags: [{ id: 7, name: "产品", taggingEnabled: true, extra: { keywords, negativeKeywords } }],
    });
    const parsed = parseTagBatchTable({ maxLevel: 3, rows });

    expect(parsed.errors).toEqual([]);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0].fields.keywords).toEqual(keywords);
    expect(parsed.records[0].fields.negativeKeywords).toEqual(negativeKeywords);
  });

  it("splits keywords only by semicolons/newlines and clears text fields with -", () => {
    const parsed = parseTagBatchTable({
      maxLevel: 3,
      rows: [
        ["标签 ID", "标签描述", "匹配关键词", "排除关键词"],
        ["7", "-", "a, b；c、d;e", "-"],
      ],
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.records[0].fields).toEqual({
      description: "",
      keywords: ["a, b", "c、d", "e"],
      negativeKeywords: [],
    });
  });

  it("merges case-only duplicate siblings when building the create tree", () => {
    expect(
      tagBatchRecordsToCreateTree([
        { rowNumber: 2, path: ["Brand", "Nike"], fields: {} },
        { rowNumber: 3, path: ["brand", "Adidas"], fields: {} },
      ]),
    ).toEqual([{ name: "Brand", nameChildList: [{ name: "Nike" }, { name: "Adidas" }] }]);
  });

  it("only keeps missing paths for create-tree input", () => {
    const existing = new Set(["内容类型", "内容类型>图像资产"]);
    const missing = filterMissingPathRecords(
      [
        { rowNumber: 2, path: ["内容类型"], fields: {} },
        { rowNumber: 3, path: ["内容类型", "图像资产"], fields: {} },
        { rowNumber: 4, path: ["内容类型", "图像资产", "新品"], fields: {} },
        { rowNumber: 5, id: 9, path: ["内容类型", "图像资产", "旧品"], fields: {} },
      ],
      (path) => existing.has(path.join(">")),
    );

    expect(missing).toEqual([{ rowNumber: 4, path: ["内容类型", "图像资产", "新品"], fields: {} }]);
    expect(tagBatchRecordsToCreateTree(missing)).toEqual([
      {
        name: "内容类型",
        nameChildList: [
          {
            name: "图像资产",
            nameChildList: [{ name: "新品" }],
          },
        ],
      },
    ]);
  });

  it("rejects files that exceed the row limit", () => {
    const rows = [
      ["一级标签"],
      ...Array.from({ length: TAG_BATCH_MAX_ROWS + 1 }, (_, index) => [`标签${index}`]),
    ];
    const parsed = parseTagBatchTable({ maxLevel: 3, rows });
    expect(parsed.records).toEqual([]);
    expect(parsed.errors[0]?.fatal).toBe(true);
    expect(parsed.errors[0]?.message).toContain(String(TAG_BATCH_MAX_ROWS));
  });
});
