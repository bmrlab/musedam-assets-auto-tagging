import { TagSettingDialog } from "@/app/tags/components/TagSettingDialog";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  setting: { tagLevel: 4 as 3 | 4, showAiTag: 1 as 0 | 1 },
  save: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/tags/hooks/useEnterpriseTagSetting", () => ({
  useEnterpriseTagSetting: () => state,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => {
  state.setting = { tagLevel: 4, showAiTag: 1 };
  state.save.mockClear();
});

describe("tag settings", () => {
  it("offers 3-level and 4-level choices", () => {
    render(<TagSettingDialog />);
    fireEvent.click(screen.getByText("tagSetting"));
    expect(screen.getByText("tagLevel")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByText("tagLevelThree")).toBeTruthy();
    expect(screen.getByText("tagLevelFour")).toBeTruthy();
  });

  it("tells how many level-4 tags will be hidden and saves without a second confirm", async () => {
    render(<TagSettingDialog fourthLevelCount={5} />);
    fireEvent.click(screen.getByText("tagSetting"));
    fireEvent.click(screen.getByText("tagLevelThree"));
    expect(screen.getByText("hideFourthLevelTagsHint")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
    await waitFor(() => expect(state.save).toHaveBeenCalledExactlyOnceWith({ tagLevel: 3, showAiTag: 1 }));
  });

  it("saves smart tag visibility without changing the current level", async () => {
    render(<TagSettingDialog />);
    fireEvent.click(screen.getByText("tagSetting"));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("confirm"));
    await waitFor(() => expect(state.save).toHaveBeenCalledExactlyOnceWith({ tagLevel: 4, showAiTag: 0 }));
  });
});
