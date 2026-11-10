import messages from "@/app/(tagging)/messages/zh-CN.json";
import { GlobalSettingsSection } from "@/app/(tagging)/tagging/settings/components/GlobalSettingsSection";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/embed/message", () => ({ dispatchMuseDAMClientAction: vi.fn() }));
vi.mock("@/app/tags/actions", () => ({ getTeamHasTags: async () => ({ success: true, data: { hasTags: true } }) }));
vi.mock("@/app/(tagging)/tagging/dashboard/actions", () => ({ fetchDashboardStats: async () => ({ success: true, data: { stats: { processing: 0, pending: 0, totalCompleted: 0, failed: 0 } } }) }));
vi.mock("@/components/ui/icons", () => ({ TagsIcon: () => null }));
afterEach(cleanup);

function mount(metadataEnabled = false, metadataAvailable = true) {
  const tagging = vi.fn(), metadata = vi.fn();
  render(<NextIntlClientProvider locale="zh-CN" messages={messages}><GlobalSettingsSection isTaggingEnabled isMetadataEnabled={metadataEnabled} metadataAvailable={metadataAvailable} onTaggingEnabledChange={tagging} onMetadataEnabledChange={metadata} /></NextIntlClientProvider>);
  return { tagging, metadata };
}

it("names the tag output in its confirmation and leaves metadata untouched", async () => {
  const { tagging, metadata } = mount(true);
  fireEvent.click(screen.getByRole("switch", { name: "按标签体系打标" }));
  await screen.findByRole("heading", { name: "关闭 按标签体系打标" });
  fireEvent.click(await screen.findByRole("button", { name: "确认关闭" }));
  expect(tagging).toHaveBeenCalledWith(false);
  expect(metadata).not.toHaveBeenCalled();
});

it.each([false, true])("uses an explicit metadata action and applies only after confirmation (%s)", async enabled => {
  const { tagging, metadata } = mount(enabled);
  fireEvent.click(screen.getByRole("switch", { name: "AI 自动填写字段" }));
  expect(metadata).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: enabled ? "确认关闭" : "确认开启" }));
  expect(metadata).toHaveBeenCalledWith(!enabled);
  expect(tagging).not.toHaveBeenCalled();
});

it("cancelling a metadata change preserves both outputs", () => {
  const { tagging, metadata } = mount();
  fireEvent.click(screen.getByRole("switch", { name: "AI 自动填写字段" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(metadata).not.toHaveBeenCalled();
  expect(tagging).not.toHaveBeenCalled();
});
