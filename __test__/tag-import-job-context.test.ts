// @vitest-environment node
import {
  getTagImportJobContext,
  getTagImportLocale,
  getTagImportTranslations,
  runTagImportJobContext,
} from "@/app/tags/tagImportJobContext";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({
  getLocale: () => "en-US",
  getTranslations: () => {
    throw new Error("Unexpected request translation lookup");
  },
}));
it("uses the job locale without HTTP headers and isolates concurrent identities", async () => {
  const context = {
    user: { id: 9, slug: "u/99", isAdmin: false },
    team: { id: 7, slug: "t/77" },
    locale: "zh-CN",
  };
  await Promise.all([
    runTagImportJobContext(context, async () => {
      await Promise.resolve();
      expect(await getTagImportLocale()).toBe("zh-CN");
      const t = await getTagImportTranslations("Tagging.BatchImportExport");
      expect(t("importFailed")).not.toBe("Tagging.BatchImportExport.importFailed");
      expect(getTagImportJobContext()?.team.id).toBe(7);
    }),
    runTagImportJobContext(
      { ...context, team: { id: 8, slug: "t/88" }, locale: "en-US" },
      async () => {
        await Promise.resolve();
        expect(await getTagImportLocale()).toBe("en-US");
        expect(getTagImportJobContext()?.team.id).toBe(8);
      },
    ),
  ]);
  expect(getTagImportJobContext()).toBeUndefined();
  expect(await getTagImportLocale()).toBe("en-US");
});
