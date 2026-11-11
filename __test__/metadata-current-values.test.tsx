import messages from "@/app/(tagging)/messages/zh-CN.json";
import { MetadataCurrentValues } from "@/app/(tagging)/tagging/review/MetadataCurrentValues";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/app/(tagging)/tagging/review/metadata-actions", () => ({
  fetchReviewMetadataValues: mocks.fetch,
}));
afterEach(cleanup);
const mount = () =>
  render(
    <NextIntlClientProvider locale="zh-CN" messages={messages}>
      <MetadataCurrentValues assetObjectId={42} />
    </NextIntlClientProvider>,
  );

it("removes the empty current-value panel after loading", async () => {
  mocks.fetch.mockResolvedValue({});
  const { container } = mount();
  await waitFor(() => expect(container.innerHTML).toBe(""));
});
it("preserves false and zero current values", async () => {
  mocks.fetch.mockResolvedValue({ Checked: false, Number: 0 });
  mount();
  expect(await screen.findByText("Checked：未勾选")).toBeTruthy();
  expect(screen.getByText("Number：0")).toBeTruthy();
});
it("keeps load errors visible instead of hiding them as empty values", async () => {
  mocks.fetch.mockRejectedValue(new Error("failed"));
  mount();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
});
