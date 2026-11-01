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
    transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    batchCreateTags: vi.fn(),
    saveTagsTreeToMuseDAM: vi.fn(),
  };
});
vi.mock("server-only", () => ({}));
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
    slug: `g/${id}`,
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
  it("prechecks without writing and identifies unchanged exported configuration", async () => {
    const row = seed(1, "品牌");
    row.extra = { description: "描述", keywords: ["Logo"], siblingsExclusive: false };
    const form = file([
      ["标签 ID", "标签描述", "匹配关键词", "AI 自动打标", "子标签单选"],
      ["1", "描述", "Logo", "开启", "关闭"],
    ]);
    const check = await precheckTagTreeImportAction(form);
    expect(check).toMatchObject({
      success: true,
      data: { createCount: 0, updateCount: 0, unchangedCount: 1, issues: [] },
    });
    await importTagTreeAction(form);
    expect(mocks.assetTag.update).not.toHaveBeenCalled();
    expect(mocks.batchCreateTags).not.toHaveBeenCalled();
    expect(mocks.saveTagsTreeToMuseDAM).not.toHaveBeenCalled();
  });

  it("updates by id, preserves unprovided fields and clears only explicitly marked text fields", async () => {
    const row = seed(1, "品牌");
    row.extra = { description: "旧描述", keywords: ["旧关键词"], requiredGroup: true };
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
      data: { createCount: 1, issues: [] },
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

  it("rejects a descendant path that depends on an invalid ancestor rename", async () => {
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
    if (result.success) expect(result.data.issues).toHaveLength(2);
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
        data: { createCount: 0, updateCount: 0, unchangedCount: 3, issues: [] },
      });
    },
  );
});
