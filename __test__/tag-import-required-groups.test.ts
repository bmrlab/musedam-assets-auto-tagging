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
    transaction: vi.fn(
      async (queries: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)) => {
        if (typeof queries !== "function") return Promise.all(queries);
        return queries({
          assetTag,
          $queryRaw: async () => rows.map((row) => structuredClone(row)),
          $executeRaw: async () => 1,
        });
      },
    ),
    batchCreateTags: vi.fn(),
    saveTagsTreeToMuseDAM: vi.fn(),
  };
});
vi.mock("server-only", () => ({}));
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

import { encodeCsv } from "@/app/(tagging)/tagging/batchFile";
import { importTagTreeAction, precheckTagTreeImportAction } from "@/app/tags/tagBatchActions";

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
      if (addType === 1) mocks.rows.length = 0;
      else expect(addType).toBe(2);
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

describe("required groups without child tags", () => {
  it("imports other configuration, turns off required on a leaf and reports its path", async () => {
    seed(1, "适用场景");
    const leaf = seed(2, "海报", 1);
    leaf.extra = { keywords: ["保留关键词"] };
    const result = await importTagTreeAction(
      file([
        ["标签 ID", "标签描述", "必打标签组"],
        ["2", "新描述", "开启"],
      ]),
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        successCount: 1,
        failedCount: 0,
        autoDisabledRequiredGroups: ["适用场景 > 海报"],
      },
    });
    expect(leaf.extra).toMatchObject({
      description: "新描述",
      keywords: ["保留关键词"],
      requiredGroup: false,
    });
  });

  it("allows required when this same import creates the parent's first child", async () => {
    seed(1, "适用场景");
    const form = file([
      ["一级标签", "二级标签", "必打标签组"],
      ["适用场景", "", "开启"],
      ["适用场景", "海报", ""],
    ]);
    expect(await precheckTagTreeImportAction(form)).toMatchObject({
      success: true,
      data: { issues: [] },
    });
    expect(mocks.assetTag.update).not.toHaveBeenCalled();
    expect(await importTagTreeAction(form)).toMatchObject({
      success: true,
      data: {
        successCount: 2,
        failedCount: 0,
        autoDisabledRequiredGroups: [],
      },
    });
    expect(mocks.rows[0].extra.requiredGroup).toBe(true);
  });

  it("normalizes a newly created leaf without rejecting its row", async () => {
    expect(
      await importTagTreeAction(
        file([
          ["一级标签", "二级标签", "必打标签组"],
          ["新分组", "新叶子", "开启"],
        ]),
      ),
    ).toMatchObject({
      success: true,
      data: {
        successCount: 1,
        failedCount: 0,
        autoDisabledRequiredGroups: ["新分组 > 新叶子"],
      },
    });
    expect(mocks.rows.find((row) => row.name === "新叶子")?.extra.requiredGroup).toBe(false);
  });

  it("keeps explicit off and blank settings without warnings", async () => {
    seed(1, "叶子A");
    seed(2, "叶子B");
    expect(
      await importTagTreeAction(
        file([
          ["标签 ID", "必打标签组"],
          ["1", "关闭"],
          ["2", ""],
        ]),
      ),
    ).toMatchObject({
      success: true,
      data: {
        successCount: 2,
        failedCount: 0,
        autoDisabledRequiredGroups: [],
      },
    });
  });

  it("does not report an automatic close if the row failed to save", async () => {
    seed(1, "保存失败的标签");
    mocks.assetTag.update
      .mockRejectedValueOnce(new Error("write failed"))
      .mockRejectedValueOnce(new Error("write failed"));
    expect(
      await importTagTreeAction(
        file([
          ["标签 ID", "必打标签组"],
          ["1", "开启"],
        ]),
      ),
    ).toMatchObject({
      success: true,
      data: {
        successCount: 0,
        failedCount: 1,
        autoDisabledRequiredGroups: [],
      },
    });
  });
});

describe("tag import preview and overwrite", () => {
  it("returns the whole preview tree without writing even when every tag already exists", async () => {
    seed(1, "品牌");
    seed(2, "Logo", 1);
    const result = await precheckTagTreeImportAction(
      file([
        ["标签 ID", "标签描述"],
        ["2", "新描述"],
      ]),
    );
    expect(result).toMatchObject({
      success: true,
      data: { previewTree: [{ name: "品牌", nameChildList: [{ name: "Logo" }] }] },
    });
    expect(mocks.batchCreateTags).not.toHaveBeenCalled();
    expect(mocks.assetTag.update).not.toHaveBeenCalled();
  });

  it("replaces the tree and applies exported configuration to newly created IDs", async () => {
    seed(1, "品牌");
    seed(2, "旧分支");
    const form = file([
      ["标签 ID", "一级标签", "二级标签", "标签描述", "必打标签组"],
      ["1", "品牌", "", "父级描述", "开启"],
      ["", "品牌", "Logo", "子级描述", ""],
    ]);
    form.set("importMode", "overwrite");
    expect(await importTagTreeAction(form)).toMatchObject({
      success: true,
      data: { successCount: 2, failedCount: 0 },
    });
    expect(mocks.batchCreateTags).toHaveBeenCalledWith(expect.any(Array), 1, { imported: true });
    expect(mocks.rows.some((row) => row.name === "旧分支")).toBe(false);
    expect(mocks.rows.find((row) => row.name === "品牌")).toMatchObject({
      extra: { description: "父级描述", requiredGroup: true },
    });
    expect(mocks.rows.find((row) => row.name === "品牌")?.id).not.toBe(1);
    expect(mocks.rows.find((row) => row.name === "Logo")?.extra.description).toBe("子级描述");
  });

  it("refuses overwrite for invalid rows before deleting any tags", async () => {
    seed(1, "保留");
    const form = file([
      ["一级标签", "必打标签组"],
      ["新标签", "非法开关"],
    ]);
    form.set("importMode", "overwrite");
    const result = await importTagTreeAction(form);
    expect(result).toMatchObject({ success: true, data: { successCount: 0, failedCount: 1 } });
    expect(mocks.batchCreateTags).not.toHaveBeenCalled();
    expect(mocks.rows[0].name).toBe("保留");
  });
});

it("turns off an unchanged required leaf and still reports it", async () => {
  const leaf = seed(1, "叶子");
  leaf.extra = { requiredGroup: true };
  const result = await importTagTreeAction(
    file([
      ["标签 ID", "必打标签组"],
      ["1", "开启"],
    ]),
  );
  expect(result).toMatchObject({
    success: true,
    data: { successCount: 1, failedCount: 0, autoDisabledRequiredGroups: ["叶子"] },
  });
  expect(leaf.extra.requiredGroup).toBe(false);
});

it("renames the original parent before adding new descendants under its new name", async () => {
  seed(1, "旧品牌");
  const result = await importTagTreeAction(
    file([
      ["标签 ID", "一级标签", "二级标签"],
      ["1", "新品牌", ""],
      ["", "新品牌", "新子标签"],
    ]),
  );
  expect(result).toMatchObject({ success: true, data: { successCount: 2, failedCount: 0 } });
  expect(mocks.rows.find((row) => row.id === 1)?.name).toBe("新品牌");
  expect(mocks.rows.filter((row) => row.name === "新品牌")).toHaveLength(1);
  expect(mocks.rows.find((row) => row.name === "新子标签")?.parentId).toBe(1);
});

it("allows overwrite precheck to move an exported tag while keeping both prechecks read-only", async () => {
  seed(1, "旧父级");
  seed(2, "子标签", 1);
  const form = file([
    ["标签 ID", "一级标签", "二级标签"],
    ["2", "新父级", "子标签"],
  ]);
  expect(await precheckTagTreeImportAction(form)).toMatchObject({
    success: true,
    data: {
      reviewable: true,
      createCount: 0,
      updateCount: 0,
      unchangedCount: 0,
      issues: [{ rowNumber: 2 }],
    },
  });
  form.set("importMode", "overwrite");
  expect(await precheckTagTreeImportAction(form)).toMatchObject({
    success: true,
    data: {
      createCount: 2,
      issues: [],
      previewTree: [{ name: "新父级", nameChildList: [{ name: "子标签" }] }],
    },
  });
  expect(mocks.batchCreateTags).not.toHaveBeenCalled();
  expect(mocks.assetTag.update).not.toHaveBeenCalled();
});

it("does not create a replacement branch when the parent rename fails upstream", async () => {
  seed(1, "旧品牌");
  mocks.saveTagsTreeToMuseDAM.mockResolvedValueOnce({ success: false, message: "rename failed" });
  expect(
    await importTagTreeAction(
      file([
        ["标签 ID", "一级标签", "二级标签"],
        ["1", "新品牌", ""],
        ["", "新品牌", "新子标签"],
      ]),
    ),
  ).toMatchObject({ success: true, data: { successCount: 0, failedCount: 1 } });
  expect(mocks.batchCreateTags).not.toHaveBeenCalled();
  expect(mocks.assetTag.update).not.toHaveBeenCalled();
  expect(mocks.rows.map((row) => row.name)).toEqual(["旧品牌"]);
});
