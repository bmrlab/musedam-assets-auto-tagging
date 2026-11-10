import { describe, expect, it } from "vitest";
import {
  buildTagBatchExportRows,
  TAG_BATCH_EXPORT_CELL_LIMIT,
  coalesceTagTreeRecords,
  buildTagBatchTemplateRows,
  filterMissingPathRecords,
  getTagBatchColumns,
  parseTagBatchId,
  parseTagBatchTable,
  splitTagBatchKeywords,
  tagBatchRecordsToCreateTree,
} from "../src/app/tags/tagBatchSpreadsheet";

const headers = (locale: string) => getTagBatchColumns(locale).map((column) => column.header);

describe("spreadsheet-safe keyword export", () => {
  it("exports matching and excluded keywords without adding separator spaces", () => {
    const rows = buildTagBatchExportRows({ locale: "zh-CN", tags: [{
      id: 1, name: "标签", taggingEnabled: true,
      extra: { keywords: ["SKU.1", "SKU.2"], negativeKeywords: ["A B", "C"] },
    }] });
    expect(rows[1][6]).toBe("SKU.1;SKU.2");
    expect(rows[1][7]).toBe("A B;C");
  });
  it.each(["zh-CN", "zh-TW", "en-US"])("round trips long keyword fields without losing data in %s", locale => {
    const keywords = Array.from({ length: 9000 }, (_, index) => `SKU.${index}`);
    const negativeKeywords = Array.from({ length: 4000 }, (_, index) => `excluded.${index}`);
    const rows = buildTagBatchExportRows({ locale, tags: [{
      id: 1217092, name: "防水", taggingEnabled: true,
      extra: { description: "description", keywords, negativeKeywords },
      children: [{ id: 1217093, name: "child", taggingEnabled: false, extra: {} }],
    }] });
    expect(rows.length).toBeGreaterThan(4);
    expect(rows.every(row => row.length === rows[0].length)).toBe(true);
    expect(rows.flat().every(cell => cell.length <= TAG_BATCH_EXPORT_CELL_LIMIT)).toBe(true);
    expect(rows.slice(1).every(row => !row[6].includes("; ") && !row[7].includes("; "))).toBe(true);
    expect(rows.slice(1).every(row => /^\d+$/.test(row[0]))).toBe(true);
    const parsed = parseTagBatchTable({ rows, maxLevel: 4, locale });
    expect(parsed.errors).toEqual([]);
    expect(parsed.records).toHaveLength(2);
    expect(parsed.records[0]).toMatchObject({ id: 1217092, path: ["防水"], fields: {
      description: "description", taggingEnabled: true, keywords, negativeKeywords,
    } });
    expect(parsed.records[1]).toMatchObject({ id: 1217093, path: ["防水", "child"] });
    expect(parseTagBatchTable({ rows, maxLevel: 4, locale, ignoreIds: true }).records[0].fields.keywords).toEqual(keywords);
  });

  it.each(["id", "path", "configuration", "orphan"])("rejects a continuation with an invalid %s", kind => {
    const rows = buildTagBatchExportRows({ locale: "zh-CN", tags: [{
      id: 1, name: "标签", taggingEnabled: true,
      extra: { keywords: Array.from({ length: 5000 }, (_, index) => `SKU.${index}`) },
    }] });
    if (kind === "id") rows[2][0] = "2";
    if (kind === "path") rows[2][1] = "其他标签";
    if (kind === "configuration") rows[2][8] = "关闭";
    if (kind === "orphan") rows.splice(1, 1);
    expect(parseTagBatchTable({ rows, maxLevel: 4 }).errors.length).toBeGreaterThan(0);
  });
});

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

  it("accepts more than 5000 data rows for batched import", () => {
    const rows = [["一级标签"], ...Array.from({ length: 6000 }, (_, index) => [`标签${index}`])];
    const parsed = parseTagBatchTable({ maxLevel: 3, rows });
    expect(parsed.errors).toEqual([]);
    expect(parsed.records).toHaveLength(6000);
    expect(parsed.records.at(-1)).toMatchObject({ rowNumber: 6001, path: ["标签5999"] });
  });
});

describe("tag import template examples", () => {
  it.each(["zh-CN", "zh-TW", "en-US"])(
    "provides importable optional configuration examples in %s",
    (locale) => {
      const rows = buildTagBatchTemplateRows(locale);
      const parsed = parseTagBatchTable({ rows, maxLevel: 3, locale });
      expect(parsed.errors).toEqual([]);
      expect(parsed.records).toHaveLength(3);
      expect(parsed.records[0].fields).toMatchObject({
        taggingEnabled: true,
        siblingsExclusive: true,
        requiredGroup: true,
      });
      expect(parsed.records[1].fields).toEqual({});
      expect(parsed.records[2].fields).toMatchObject({
        siblingsExclusive: false,
        requiredGroup: false,
      });
      expect(parsed.records[2].fields.keywords).toHaveLength(3);
      expect(parsed.records[2].fields.negativeKeywords).toHaveLength(2);
      expect(rows.every((row) => row.length === rows[0].length)).toBe(true);
    },
  );

  it("splits semicolons and newlines while preserving commas inside keywords", () => {
    expect(splitTagBatchKeywords("红色; 蓝色；绿色\n黑色\r\n黑色; A,B; 甲，乙; 丙、丁")).toEqual([
      "红色",
      "蓝色",
      "绿色",
      "黑色",
      "A,B",
      "甲，乙",
      "丙、丁",
    ]);
  });
});


describe("overwrite duplicate paths", () => {
  it("coalesces repeated paths, including case variants, but keeps separate parents", () => {
    const result = coalesceTagTreeRecords([
      { rowNumber: 2, path: ["所属系列", "pro系列"], fields: {} },
      { rowNumber: 3, path: ["所属系列", "Pro系列"], fields: {} },
      { rowNumber: 4, path: ["其他系列", "pro系列"], fields: {} },
    ], "zh-CN");
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0].path).toEqual(["所属系列", "pro系列"]);
  });

  it("combines compatible settings without changing the original records", () => {
    const records = [
      { rowNumber: 2, path: ["品牌"], fields: { keywords: ["A", "B"] } },
      { rowNumber: 3, path: ["品牌"], fields: { description: "品牌描述", keywords: ["B", "A"] } },
    ];
    const result = coalesceTagTreeRecords(records, "zh-CN");
    expect(result.errors).toEqual([]);
    expect(result.records[0].fields).toEqual({ description: "品牌描述", keywords: ["A", "B"] });
    expect(records[0].fields).toEqual({ keywords: ["A", "B"] });
  });

  it("rejects conflicting settings with the row and column instead of a name collision", () => {
    const result = coalesceTagTreeRecords([
      { rowNumber: 2, path: ["品牌"], fields: { taggingEnabled: false, description: "-" } },
      { rowNumber: 582, path: ["品牌"], fields: { taggingEnabled: true, description: "新描述" } },
    ], "zh-CN");
    expect(result.errors).toEqual([{
      rowNumber: 582,
      message: "文件中同一路径的配置冲突（标签描述、AI 自动打标），继续导入将跳过本行",
    }]);
  });
});


it("merges keywords and excluded keywords for repeated tag paths and returns only a non-blocking notice", () => {
  const records = [
    { rowNumber: 582, path: ["所属系列", "pro系列"], fields: { keywords: ["pro", "专业"], negativeKeywords: ["旧款"] } },
    { rowNumber: 583, path: ["所属系列", "pro系列"], fields: { keywords: ["pro", "专业版"], negativeKeywords: ["旧款", "草稿"] } },
  ];
  const result = coalesceTagTreeRecords(records, "zh-CN");
  expect(result.errors).toEqual([]);
  expect(result.records).toHaveLength(1);
  expect(result.records[0].fields).toEqual({ keywords: ["pro", "专业", "专业版"], negativeKeywords: ["旧款", "草稿"] });
  expect(result.warnings).toEqual([{ rowNumber: 583, message: expect.stringContaining("不影响导入") }]);
  expect(records[0].fields.keywords).toEqual(["pro", "专业"]);
});
