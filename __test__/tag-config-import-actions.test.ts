// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type Row = {
    id: number;
    teamId: number;
    name: string;
    slug: string | null;
    parentId: number | null;
    taggingEnabled: boolean;
    extra: Record<string, unknown>;
    sort: number;
  };
  const rows: Row[] = [];
  const assetTag = {
    deleteMany: vi.fn(async ({ where }: { where: { teamId: number; id: { in: number[] } } }) => {
      let count = 0;
      for (let index = rows.length - 1; index >= 0; index--) {
        if (rows[index].teamId === where.teamId && where.id.in.includes(rows[index].id)) {
          rows.splice(index, 1); count++;
        }
      }
      return { count };
    }),
    findMany: vi.fn(async ({ where }: { where: { teamId: number } }) =>
      rows.filter((row) => row.teamId === where.teamId).map((row) => structuredClone(row)),
    ),
    update: vi.fn(
      async ({ where, data }: { where: { id: number; teamId: number }; data: Partial<Row> }) => {
        const row = rows.find((row) => row.id === where.id && row.teamId === where.teamId);
        if (!row) throw new Error("not found");
        Object.assign(row, structuredClone(data));
        return structuredClone(row);
      },
    ),
  };
  return {
    rows,
    assetTag,
    bumpVersion: vi.fn(),
    transaction: vi.fn(async (queries: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
      if (typeof queries !== "function") return Promise.all(queries);
      const snapshot = structuredClone(rows);
      try {
        return await queries({ assetTag, $queryRaw: async () => rows.map((row) => structuredClone(row)), $executeRaw: async () => 1 });
      } catch (error) {
        rows.splice(0, rows.length, ...snapshot);
        throw error;
      }
    }),
    batchCreateTags: vi.fn(),
    saveTagsTreeToMuseDAM: vi.fn(),
  };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/tagging/tag-config-version", () => ({ bumpTagConfigVersion: mocks.bumpVersion }));
vi.mock("@/lib/tagging/tag-import-lock", async (original) => ({
  ...(await original<typeof import("@/lib/tagging/tag-import-lock")>()),
  runTagImportExclusive: async (_team: number, _user: number, run: () => Promise<unknown>) => run(),
  assertTagImportOwnership: async () => {},
}));
vi.mock("@/prisma/prisma", () => ({
  default: { assetTag: mocks.assetTag, $transaction: mocks.transaction },
}));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (fn: (session: unknown) => unknown) => fn({ user: { id: "u" }, team: { id: 1 } }),
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "zh-CN",
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/app/tags/actions", () => ({
  batchCreateTags: mocks.batchCreateTags,
  saveTagsTreeToMuseDAM: mocks.saveTagsTreeToMuseDAM,
}));

import { encodeCsv, parseCsv, parseXlsx } from "@/app/(tagging)/tagging/batchFile";
import {
  exportTagTreeAction,
  importTagTreeAction,
  precheckTagTreeImportAction,
} from "@/app/tags/tagBatchActions";
import { getTagBatchColumns } from "@/app/tags/tagBatchSpreadsheet";

function seed(id: number, name: string, parentId: number | null = null, teamId = 1) {
  const row = {
    id,
    teamId,
    name,
    slug: `g/${id}` as string | null,
    parentId,
    taggingEnabled: true,
    extra: {} as Record<string, unknown>,
    sort: 0,
  };
  mocks.rows.push(row);
  return row;
}
function file(rows: string[][], level = 4, skipRows: number[] = []) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(encodeCsv(rows))], "tags.csv", { type: "text/csv" }));
  form.set("tagLevel", String(level));
  if (skipRows.length) form.set("skipRows", JSON.stringify(skipRows));
  return form;
}

beforeEach(() => {
  mocks.rows.length = 0;
  vi.clearAllMocks();
  mocks.saveTagsTreeToMuseDAM.mockResolvedValue({ success: true, data: {} });
  mocks.batchCreateTags.mockImplementation(
    async (nodes: Array<{ name: string; nameChildList?: unknown[] }>, addType: number) => {
      expect(addType).toBe(2);
      const walk = (items: typeof nodes, parentId: number | null) => {
        for (const node of items) {
          let existing = mocks.rows.find(
            (row) => row.teamId === 1 && row.parentId === parentId && row.name === node.name,
          );
          if (!existing) existing = seed(100 + mocks.rows.length, node.name, parentId);
          walk((node.nameChildList ?? []) as typeof nodes, existing.id);
        }
      };
      walk(nodes, null);
      return { success: true };
    },
  );
});

describe("tag configuration import", () => {
  it("prechecks only file structure and configuration without querying existing tags", async () => {
    const row = seed(1, "品牌");
    row.extra = { description: "描述", keywords: ["Logo"], siblingsExclusive: false };
    const form = file([
      ["标签 ID", "一级标签", "标签描述", "匹配关键词", "AI 自动打标", "子标签单选"],
      ["1", "品牌", "描述", "Logo", "开启", "关闭"],
    ]);
    const check = await precheckTagTreeImportAction(form);
    expect(check).toMatchObject({
      success: true,
      data: { importableCount: 1, createCount: 0, updateCount: 0, unchangedCount: 0, issues: [] },
    });
    await importTagTreeAction(form);
    expect(mocks.assetTag.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ extra: expect.objectContaining({ configurationSource: "import" }) }) }));
    expect(mocks.batchCreateTags).not.toHaveBeenCalled();
    expect(mocks.saveTagsTreeToMuseDAM).not.toHaveBeenCalled();
  });

  it("updates by id, preserves unprovided fields and clears only explicitly marked text fields", async () => {
    const row = seed(1, "品牌");
    row.extra = { description: "旧描述", keywords: ["旧关键词"], requiredGroup: true };
    seed(2, "子标签", 1);
    const result = await importTagTreeAction(
      file([
        ["标签 ID", "标签描述", "匹配关键词", "AI 自动打标"],
        ["1", "", "-", "关闭"],
      ]),
    );
    expect(result).toMatchObject({ success: true, data: { successCount: 1, failedCount: 0 } });
    expect(row).toMatchObject({
      id: 1,
      taggingEnabled: false,
      extra: { description: "旧描述", keywords: [], requiredGroup: true },
    });
  });

  it("creates missing paths only in merge mode and then applies configuration", async () => {
    seed(1, "品牌");
    seed(2, "保留分支");
    const form = file([
      ["一级标签", "二级标签", "标签描述"],
      ["品牌", "新子级", "描述"],
    ]);
    expect(await precheckTagTreeImportAction(form)).toMatchObject({
      success: true,
      data: { importableCount: 2, createCount: 0, issues: [] },
    });
    expect(mocks.batchCreateTags).not.toHaveBeenCalled();
    expect(await importTagTreeAction(form)).toMatchObject({
      success: true,
      data: { successCount: 1, failedCount: 0 },
    });
    expect(mocks.rows.find((row) => row.id === 2)?.name).toBe("保留分支");
    expect(mocks.rows.find((row) => row.name === "新子级")).toMatchObject({
      parentId: 1,
      extra: { description: "描述" },
    });
    expect(mocks.rows.filter((row) => row.name === "品牌")).toHaveLength(1);
  });

  it("renames by id in MuseDAM and locally without recreating the tag", async () => {
    const row = seed(1, "旧名称");
    const result = await importTagTreeAction(
      file([
        ["标签 ID", "一级标签"],
        ["1", "新名称"],
      ]),
    );
    expect(result).toMatchObject({ success: true, data: { successCount: 1, failedCount: 0 } });
    expect(mocks.saveTagsTreeToMuseDAM).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1, name: "新名称", verb: "update" }),
    ]);
    expect(row).toMatchObject({ id: 1, name: "新名称", slug: "g/1" });
    expect(mocks.batchCreateTags).not.toHaveBeenCalled();
  });

  it("does not rename locally if MuseDAM synchronization fails", async () => {
    const row = seed(1, "旧名称");
    mocks.saveTagsTreeToMuseDAM.mockResolvedValue({ success: false, message: "upstream failed" });
    expect(
      await importTagTreeAction(
        file([
          ["标签 ID", "一级标签"],
          ["1", "新名称"],
        ]),
      ),
    ).toMatchObject({ success: true, data: { successCount: 0, failedCount: 1 } });
    expect(row.name).toBe("旧名称");
    expect(mocks.assetTag.update).not.toHaveBeenCalled();
  });

  it("skips explicitly acknowledged problem rows even if they are now valid", async () => {
    const row = seed(1, "旧名称");
    const result = await importTagTreeAction(
      file(
        [
          ["标签 ID", "一级标签"],
          ["1", "新名称"],
        ],
        4,
        [2],
      ),
    );
    expect(result).toMatchObject({
      success: true,
      data: { successCount: 0, skippedCount: 1, failedCount: 0 },
    });
    expect(row.name).toBe("旧名称");
    expect(mocks.assetTag.update).not.toHaveBeenCalled();
    expect(mocks.saveTagsTreeToMuseDAM).not.toHaveBeenCalled();
  });

  it("isolates teams and rejects moving a tag using an id plus a different parent path", async () => {
    seed(1, "品牌");
    const child = seed(2, "子级", 1);
    const otherTeam = seed(3, "其他团队", null, 2);
    const result = await importTagTreeAction(
      file([
        ["标签 ID", "一级标签", "二级标签", "标签描述"],
        ["2", "不存在的父级", "子级", "不应写入"],
        ["3", "", "", "不应写入"],
      ]),
    );
    expect(result).toMatchObject({ success: true, data: { successCount: 0, failedCount: 2 } });
    expect(child.extra).toEqual({});
    expect(otherTeam.extra).toEqual({});
    expect(mocks.batchCreateTags).not.toHaveBeenCalled();
  });

  it("rejects id-only updates to a hidden fourth-level tag at level 3", async () => {
    seed(1, "一级");
    seed(2, "二级", 1);
    seed(3, "三级", 2);
    const hidden = seed(4, "四级", 3);
    const result = await importTagTreeAction(
      file(
        [
          ["标签 ID", "标签描述"],
          ["4", "不应写入"],
        ],
        3,
      ),
    );
    expect(result).toMatchObject({ success: true, data: { successCount: 0, failedCount: 1 } });
    expect(hidden.extra).toEqual({});
  });

  it("does not create paths belonging to explicitly skipped rows", async () => {
    seed(1, "保留");
    const result = await importTagTreeAction(
      file(
        [
          ["一级标签", "标签描述"],
          ["不应创建", "跳过"],
          ["保留", "更新"],
        ],
        4,
        [2],
      ),
    );
    expect(result).toMatchObject({
      success: true,
      data: { successCount: 1, skippedCount: 1, failedCount: 0 },
    });
    expect(mocks.batchCreateTags).not.toHaveBeenCalled();
    expect(mocks.rows.find((row) => row.name === "不应创建")).toBeUndefined();
  });

  it("previews file paths without treating exported IDs as ancestor renames", async () => {
    seed(1, "父级");
    seed(2, "已占用名称");
    const child = seed(3, "子级", 1);
    const result = await precheckTagTreeImportAction(
      file([
        ["标签 ID", "一级标签", "二级标签", "标签描述"],
        ["1", "已占用名称", "", ""],
        ["3", "已占用名称", "子级", "不应写入"],
      ]),
    );
    expect(result).toMatchObject({
      success: true,
      data: { updateCount: 0, issues: expect.any(Array) },
    });
    if (result.success) expect(result.data.issues).toHaveLength(0);
    expect(child.extra).toEqual({});
    expect(mocks.assetTag.update).not.toHaveBeenCalled();
  });

  it.each(["csv", "xlsx"] as const)(
    "exports and round-trips %s configuration while omitting hidden levels and other teams",
    async (format) => {
      seed(1, "一级");
      seed(2, "二级", 1);
      seed(3, "三级", 2);
      seed(4, "四级", 3);
      seed(5, "其他团队", null, 2);
      const result = await exportTagTreeAction(format, 3);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const buffer = Buffer.from(result.data.base64, "base64");
      const rows = format === "csv" ? parseCsv(buffer) : parseXlsx(buffer);
      expect(rows[0]).toEqual(getTagBatchColumns("zh-CN").map((column) => column.header));
      expect(rows.slice(1).map((row) => row[0])).toEqual(["1", "2", "3"]);
      const form = new FormData();
      form.set("file", new File([new Uint8Array(buffer)], result.data.filename));
      form.set("tagLevel", "3");
      expect(await precheckTagTreeImportAction(form)).toMatchObject({
        success: true,
        data: { importableCount: 3, createCount: 0, updateCount: 0, unchangedCount: 0, issues: [] },
      });
    },
  );
});


describe("overwrite repeated tag paths", () => {
  it("prechecks repeated file paths independently of the existing tree without writing", async () => {
    seed(1, "所属系列");
    seed(2, "pro系列", 1);
    const form = file([
      ["一级标签", "二级标签"],
      ["所属系列", "pro系列"],
      ["所属系列", "Pro系列"],
      ["所属系列", "x系列"],
      ["所属系列", "x系列"],
    ]);
    form.set("importMode", "overwrite");
    expect(await precheckTagTreeImportAction(form)).toMatchObject({
      success: true,
      data: { reviewable: true, importableCount: 3, createCount: 0, issues: [] },
    });
    expect(mocks.batchCreateTags).not.toHaveBeenCalled();
    expect(mocks.assetTag.update).not.toHaveBeenCalled();
    expect(mocks.rows).toHaveLength(2);
  });

  it("creates each path once and applies compatible duplicate-row configuration on overwrite", async () => {
    seed(1, "旧标签");
    mocks.batchCreateTags.mockImplementationOnce(async (nodes, addType) => {
      expect(addType).toBe(1);
      expect(nodes).toEqual([{ name: "所属系列", nameChildList: [{ name: "pro系列" }] }]);
      mocks.rows.length = 0;
      seed(100, "所属系列");
      seed(101, "pro系列", 100);
      return { success: true };
    });
    const form = file([
      ["一级标签", "二级标签", "标签描述", "匹配关键词"],
      ["所属系列", "pro系列", "系列描述", ""],
      ["所属系列", "pro系列", "", "pro"],
    ]);
    form.set("importMode", "overwrite");
    expect(await importTagTreeAction(form)).toMatchObject({
      success: true, data: { successCount: 1, failedCount: 0, failures: [] },
    });
    expect(mocks.batchCreateTags).toHaveBeenCalledTimes(1);
    expect(mocks.rows.find((row) => row.id === 101)?.extra).toMatchObject({
      description: "系列描述", keywords: ["pro"],
    });
  });

  it("blocks conflicting duplicate configuration before overwriting any tags", async () => {
    seed(1, "旧标签");
    const form = file([
      ["一级标签", "二级标签", "AI 自动打标"],
      ["所属系列", "pro系列", "开启"],
      ["所属系列", "pro系列", "关闭"],
    ]);
    form.set("importMode", "overwrite");
    expect(await importTagTreeAction(form)).toMatchObject({
      success: true,
      data: { successCount: 0, failedCount: 1, failures: [{ rowNumber: 3, message: expect.stringContaining("配置冲突") }] },
    });
    expect(mocks.batchCreateTags).not.toHaveBeenCalled();
    expect(mocks.assetTag.update).not.toHaveBeenCalled();
    expect(mocks.rows).toHaveLength(1);
  });
});


it("previews the uploaded tree independently of mode and validates duplicate MuseDAM IDs without querying tags", async () => {
  const form = file([
    ["MuseDAM 标签 ID", "一级标签", "二级标签"],
    ["999999", "所属系列", "pro系列"],
    ["999999", "所属系列", "pro系列"],
  ]);
  const merge = await precheckTagTreeImportAction(form);
  form.set("importMode", "overwrite");
  expect(await precheckTagTreeImportAction(form)).toEqual(merge);
  expect(merge).toMatchObject({ success: true, data: {
    issues: [{ rowNumber: 3, message: expect.stringContaining("ID 重复") }],
  } });
  expect(mocks.assetTag.findMany).not.toHaveBeenCalled();
});

it.each(["merge", "overwrite"])("%s rejects unknown MuseDAM IDs even when the path and local ID exist", async mode => {
  seed(1, "所属系列").slug = "g/1001";
  const child = seed(2, "pro系列", 1);
  child.slug = "g/2002";
  const form = file([["MuseDAM 标签 ID", "一级标签", "二级标签", "匹配关键词"],
    ["2", "所属系列", "pro系列", "错误写入"]]);
  form.set("treeImport", "true"); form.set("importMode", mode);
  expect(await importTagTreeAction(form)).toMatchObject({ success: true, data: { failedCount: 1, successCount: 0 } });
  expect(child.extra).toEqual({});
  expect(mocks.assetTag.update).not.toHaveBeenCalled();
  expect(mocks.batchCreateTags).not.toHaveBeenCalled();
});

it("updates by MuseDAM ID rather than an unrelated local ID, including confirmed tree imports", async () => {
  seed(1, "所属系列").slug = "g/1001";
  const target = seed(2, "pro系列", 1); target.slug = "g/2002";
  const decoy = seed(2002, "同号本地标签"); decoy.slug = "g/9999";
  const form = file([["MuseDAM 标签 ID", "一级标签", "二级标签", "匹配关键词"],
    ["2002", "所属系列", "pro系列", "pro"]]);
  form.set("treeImport", "true");
  expect(await importTagTreeAction(form)).toMatchObject({ success: true, data: { failedCount: 0, successCount: 1 } });
  expect(target.extra).toMatchObject({ keywords: ["pro"] });
  expect(decoy.extra).toEqual({});
  expect(mocks.batchCreateTags).not.toHaveBeenCalled();
});

it.each(["csv", "xlsx"] as const)("exports only MuseDAM IDs in %s and deletes unsynchronized tags", async format => {
  seed(1, "已同步").slug = "g/12345";
  seed(2, "未同步").slug = null;
  const result = await exportTagTreeAction(format);
  if (!result.success) throw new Error("export failed");
  const data = Buffer.from(result.data.base64, "base64");
  const rows = format === "csv" ? parseCsv(data) : parseXlsx(data);
  expect(rows[0][0]).toBe("MuseDAM 标签 ID");
  expect(rows.slice(1).map(row => row[0])).toEqual(["12345"]);
  expect(mocks.rows.map(row => row.id)).toEqual([1]);
  expect(result.data.deletedTagCount).toBe(1);
  expect(mocks.bumpVersion).toHaveBeenCalledWith(expect.anything(), 1);
  expect(rows[0].some(column => /slug/i.test(column))).toBe(false);
  expect(rows.flat().some(cell => cell.startsWith("g/"))).toBe(false);
});


it.each(["merge", "overwrite"])("%s imports merged duplicate keywords and skips only explicitly acknowledged invalid rows", async (mode) => {
  seed(1, "所属系列"); seed(2, "pro系列", 1);
  mocks.batchCreateTags.mockImplementation(async (nodes, addType) => {
    expect(mode).toBe("overwrite");
    expect(addType).toBe(1);
    expect(nodes).toEqual([{ name: "所属系列", nameChildList: [{ name: "pro系列" }] }]);
    return { success: true };
  });
  const form = file([
    ["一级标签", "二级标签", "三级标签", "匹配关键词"],
    ["所属系列", "pro系列", "", "pro;专业"],
    ["所属系列", "pro系列", "", "pro;专业版"],
    ["所属系列", "", "错误层级", "不应写入"],
  ]);
  const precheck = await precheckTagTreeImportAction(form);
  expect(precheck).toMatchObject({ success: true, data: {
    issues: [{ rowNumber: 4 }], warnings: [{ rowNumber: 3 }], importableCount: 2,
  } });
  form.set("treeImport", "true"); form.set("importMode", mode); form.set("skipRows", "[4]");
  expect(await importTagTreeAction(form)).toMatchObject({ success: true, data: {
    failedCount: 0, successCount: 1, skippedCount: 1,
  } });
  expect(mocks.rows.find((row) => row.id === 2)?.extra).toMatchObject({ keywords: ["pro", "专业", "专业版"] });
  if (mode === "merge") expect(mocks.batchCreateTags).not.toHaveBeenCalled();
});

it("does not overwrite when skipping all input rows would leave an empty tree", async () => {
  seed(1, "保留的旧树");
  const form = file([["一级标签"], ["无效".repeat(101)]]);
  form.set("treeImport", "true"); form.set("importMode", "overwrite"); form.set("skipRows", "[2]");
  await importTagTreeAction(form);
  expect(mocks.batchCreateTags).not.toHaveBeenCalled();
  expect(mocks.rows[0].name).toBe("保留的旧树");
});


it("counts all deduplicated file tags, including existing paths outside the structural import request", async () => {
  seed(1, "品牌"); seed(2, "旧子级", 1); seed(3, "已有分类");
  mocks.batchCreateTags.mockImplementationOnce(async () => {
    seed(100, "新子级", 1);
    return { success: true, data: { totalCount: 2, existingCount: 1, createdCount: 1 } };
  });
  const form = file([
    ["一级标签", "二级标签"],
    ["品牌", "旧子级"], ["品牌", "新子级"], ["已有分类", ""], ["品牌", "旧子级"],
  ]);
  form.set("treeImport", "true");
  expect(await importTagTreeAction(form)).toMatchObject({ success: true, data: {
    totalCount: 4, existingCount: 3, createdCount: 1, failedCount: 0,
  } });
});


it("preserves MuseDAM identity when overwrite import renames an existing tag", async () => {
  const original = seed(7, "旧名称"); original.slug = "g/7007";
  mocks.batchCreateTags.mockImplementation(async (nodes, addType) => {
    expect(addType).toBe(1);
    expect(nodes).toEqual([{ name: "新名称" }]);
    expect(original.name).toBe("新名称");
    return { success: true };
  });
  const form = file([["MuseDAM 标签 ID", "一级标签", "标签描述"], ["7007", "新名称", "新描述"]]);
  form.set("treeImport", "true"); form.set("importMode", "overwrite");
  expect(await importTagTreeAction(form)).toMatchObject({ success: true, data: { failedCount: 0 } });
  expect(original).toMatchObject({ id: 7, slug: "g/7007", name: "新名称", extra: expect.objectContaining({ description: "新描述" }) });
  expect(mocks.saveTagsTreeToMuseDAM).toHaveBeenCalledWith([expect.objectContaining({ id: 7, slug: "g/7007", name: "新名称" })]);
});

it("does not resolve MuseDAM IDs belonging only to another team", async () => {
  seed(2, "别的团队", null, 2).slug = "g/2002";
  const form = file([["MuseDAM 标签 ID", "标签描述"], ["2002", "不能修改"]]);
  expect(await importTagTreeAction(form)).toMatchObject({ success: true, data: { failedCount: 1, successCount: 0 } });
  expect(mocks.assetTag.update).not.toHaveBeenCalled();
});


it("cleans unmapped subtrees leaf first, including hidden levels, while retaining other teams", async () => {
  seed(1, "同步根");
  seed(2, "无映射子节点", 1).slug = null;
  seed(3, "无映射孙节点", 2).slug = "";
  seed(4, "隐藏的四级", 3).slug = "not-a-musedam-id";
  seed(5, "其他团队", null, 2).slug = null;
  const result = await exportTagTreeAction("csv", 3);
  expect(result).toMatchObject({ success: true, data: { deletedTagCount: 3 } });
  expect(mocks.rows.map(row => row.id)).toEqual([1, 5]);
  expect(mocks.assetTag.deleteMany.mock.calls.map(([args]) => args.where.id.in)).toEqual([[4], [3], [2]]);
  expect(mocks.bumpVersion).toHaveBeenCalledTimes(1);
});

it("blocks cleanup before any deletion when an unmapped parent has mapped descendants", async () => {
  seed(1, "无映射根").slug = null;
  seed(2, "已映射子节点", 1);
  const result = await exportTagTreeAction("csv");
  expect(result).toMatchObject({ success: false, message: "exportCleanupMappedChild" });
  expect(mocks.rows).toHaveLength(2);
  expect(mocks.assetTag.deleteMany).not.toHaveBeenCalled();
  expect(mocks.bumpVersion).not.toHaveBeenCalled();
});

it("rolls back already deleted batches and returns no file when a later batch fails", async () => {
  for (let id = 1; id <= 101; id++) seed(id, `无映射${id}`).slug = null;
  mocks.assetTag.deleteMany.mockImplementationOnce(async ({ where }) => {
    const count = where.id.in.length;
    for (let index = mocks.rows.length - 1; index >= 0; index--)
      if (where.id.in.includes(mocks.rows[index].id)) mocks.rows.splice(index, 1);
    return { count };
  }).mockRejectedValueOnce(new Error("delete failed"));
  expect(await exportTagTreeAction("csv")).toMatchObject({ success: false, message: "delete failed" });
  expect(mocks.rows).toHaveLength(101);
  expect(mocks.bumpVersion).not.toHaveBeenCalled();
});

it("does not write tag rows or invalidate the cache when all tags are mapped", async () => {
  seed(1, "已映射");
  expect(await exportTagTreeAction("xlsx")).toMatchObject({ success: true, data: { deletedTagCount: 0 } });
  expect(mocks.assetTag.deleteMany).not.toHaveBeenCalled();
  expect(mocks.bumpVersion).not.toHaveBeenCalled();
});


it("preserves mapped tags with IDs beyond the supported file range instead of deleting them", async () => {
  seed(1, "长 ID 标签").slug = "g/9007199254740993";
  expect(await exportTagTreeAction("csv")).toMatchObject({ success: false });
  expect(mocks.rows).toHaveLength(1);
  expect(mocks.assetTag.deleteMany).not.toHaveBeenCalled();
});
