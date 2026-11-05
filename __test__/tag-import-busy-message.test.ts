// @vitest-environment node
import { importTagTreeAction } from "@/app/tags/tagBatchActions";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/prisma/prisma", () => ({ default: {} }));
vi.mock("@/app/(auth)/withAuth", () => ({
  withAuth: (run: (session: unknown) => unknown) => run({ team: { id: 7 }, user: { id: 2 } }),
}));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "zh-CN",
  getTranslations: async () => (key: string, values?: { name: string }) =>
    key === "memberImportInProgress"
      ? `成员 ${values?.name} 正在执行批量导入，请稍后刷新页面重试。`
      : key,
}));
vi.mock("@/app/tags/actions", () => ({ batchCreateTags: vi.fn(), saveTagsTreeToMuseDAM: vi.fn() }));
vi.mock("@/lib/tagging/tag-import-lock", async (original) => {
  const actual = await original<typeof import("@/lib/tagging/tag-import-lock")>();
  return {
    ...actual,
    runTagImportExclusive: async () => {
      throw new actual.TagImportBusyError("张三");
    },
  };
});
it("returns the requested member-specific message as a busy result before parsing or mutating", async () => {
  expect(await importTagTreeAction(new FormData())).toEqual({
    success: false,
    code: "busy",
    message: "成员 张三 正在执行批量导入，请稍后刷新页面重试。",
  });
});
