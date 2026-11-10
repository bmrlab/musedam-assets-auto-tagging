import messages from "@/app/(tagging)/messages/zh-CN.json";
import { UnmatchedReviewPanel } from "@/app/(tagging)/tagging/review/UnmatchedReviewPanel";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/app/(tagging)/tagging/review/unmatched-actions", () => ({
  fetchUnmatchedReviewAssets: mocks.fetch,
}));
vi.mock("@/components/AssetThumbnail", () => ({ AssetThumbnail: () => null }));
vi.mock("@/embed/message", () => ({ dispatchMuseDAMClientAction: vi.fn() }));
const result = {
  total: 1,
  assets: [
    {
      assetObject: { id: 42, slug: "a/42", name: "未匹配测试素材", extra: {} },
      createdAt: new Date(),
    },
  ],
};
const view = (content: "tags" | "fields" = "fields") => (
  <NextIntlClientProvider locale="zh-CN" messages={messages}>
    <UnmatchedReviewPanel
      content={content}
      metadataAvailable
      isAdmin
      onContentChange={vi.fn()}
      onStatusChange={vi.fn()}
    />
  </NextIntlClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue(result);
});
afterEach(cleanup);
it("fetches the selected type and renders read-only unmatched materials", async () => {
  render(view());
  await screen.findByRole("heading", { name: "未匹配测试素材" });
  expect(mocks.fetch).toHaveBeenCalledWith(1, 40, { content: "fields", search: "", time: "all" });
  expect(screen.queryByRole("button", { name: /^添加$/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("reloads when content changes instead of retaining another type's results", async () => {
  const { rerender } = render(view());
  await screen.findByRole("heading", { name: "未匹配测试素材" });
  mocks.fetch.mockResolvedValue({ total: 0, assets: [] });
  rerender(view("tags"));
  await screen.findByText("暂无未匹配素材");
  expect(mocks.fetch).toHaveBeenLastCalledWith(1, 40, { content: "tags", search: "", time: "all" });
  expect(screen.queryByRole("heading", { name: "未匹配测试素材" })).toBeNull();
});
it("submits search literally and returns to page one", async () => {
  render(view());
  await screen.findByRole("heading", { name: "未匹配测试素材" });
  const search = screen.getByRole("textbox");
  fireEvent.change(search, { target: { value: "100%_case" } });
  fireEvent.submit(search.closest("form")!);
  await waitFor(() =>
    expect(mocks.fetch).toHaveBeenLastCalledWith(1, 40, {
      content: "fields",
      search: "100%_case",
      time: "all",
    }),
  );
});
it("shows a load error and can retry without displaying stale materials", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("failed"));
  render(view());
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("heading", { name: "未匹配测试素材" });
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
