import messages from "@/app/(tagging)/messages/zh-CN.json";
import { MetadataReviewPanel } from "@/app/(tagging)/tagging/review/MetadataReviewPanel";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prediction } from "../development/metadata-preview/actions";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), review: vi.fn() }));
vi.mock("@/app/(tagging)/tagging/review/metadata-actions", () => ({
  fetchMetadataReviewAssets: mocks.fetch,
  reviewMetadata: mocks.review,
}));
vi.mock("@/app/(tagging)/tagging/review/MetadataCurrentValues", () => ({
  MetadataCurrentValues: () => <div>已有字段</div>,
}));
vi.mock("@/components/AssetThumbnail", () => ({ AssetThumbnail: () => null }));
vi.mock("@/components/ui/icons", () => ({
  ClockCircleIcon: () => <svg />,
  TagAIIcon: () => <svg />,
}));
const asset = {
  assetObject: { id: 42, name: "海报", extra: { extension: "jpg", size: 1024 } },
  createdAt: new Date(),
  rows: [
    {
      id: 1,
      status: "pending",
      prediction: { ...prediction, fieldName: "投放渠道" },
      available: true,
    },
    {
      id: 2,
      status: "pending",
      prediction: { ...prediction, fieldName: "素材用途" },
      available: true,
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue({ assets: [asset], total: 1 });
  mocks.review.mockResolvedValue({ applied: 2, skipped: 0 });
});
afterEach(cleanup);
const mount = () =>
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <MetadataReviewPanel />
    </NextIntlClientProvider>,
  );
it("excludes a field without applying it immediately, and restores it before review", async () => {
  const { container } = mount();
  await screen.findByRole("heading", { name: "海报" });
  expect(container.querySelectorAll("article")).toHaveLength(1);
  expect(screen.queryByText("已有字段")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "移除 投放渠道" }));
  expect(mocks.review).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "添加 投放渠道" }));
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  await waitFor(() => expect(mocks.review).toHaveBeenCalledWith([1, 2], "approve"));
});
it("applies included fields and rejects excluded fields in bulk", async () => {
  mount();
  await screen.findByRole("heading", { name: "海报" });
  fireEvent.click(screen.getByRole("button", { name: "移除 投放渠道" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "全选" }));
  fireEvent.click(screen.getAllByRole("button", { name: "添加" })[0]);
  await waitFor(() => expect(mocks.review).toHaveBeenCalledWith([2], "approve"));
  expect(mocks.review).toHaveBeenCalledWith([1], "reject");
});
it("selects materials and reviews all their pending fields as one bulk action", async () => {
  mount();
  await screen.findByRole("heading", { name: "海报" });
  fireEvent.click(screen.getByRole("checkbox", { name: "全选" }));
  fireEvent.click(screen.getAllByRole("button", { name: "添加" })[0]);
  await waitFor(() => expect(mocks.review).toHaveBeenCalledWith([1, 2], "approve"));
});
it("blocks adding a changed field while allowing its review record to be removed", async () => {
  mocks.fetch.mockResolvedValue({
    assets: [{ ...asset, rows: [{ ...asset.rows[0], available: false }] }],
    total: 1,
  });
  mount();
  await screen.findByRole("heading", { name: "海报" });
  expect(screen.getByRole("button", { name: "移除 投放渠道" }).hasAttribute("disabled")).toBe(
    false,
  );
  expect(screen.getByRole("button", { name: "添加" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  await waitFor(() => expect(mocks.review).toHaveBeenCalledWith([1], "reject"));
});
