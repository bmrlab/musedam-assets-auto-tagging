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
