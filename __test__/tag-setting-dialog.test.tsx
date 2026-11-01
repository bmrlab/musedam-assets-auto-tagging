import { TagSettingDialog } from "@/app/tags/components/TagSettingDialog";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  setting: { tagLevel: 4 as 3 | 4, showAiTag: 1 as 0 | 1 },
  save: vi.fn().mockResolvedValue(undefined),
  check: vi.fn(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count != null ? `${key}:${values.count}` : key,
}));
vi.mock("@/app/tags/hooks/useEnterpriseTagSetting", () => ({
  useEnterpriseTagSetting: () => state,
}));
vi.mock("@/embed/message", () => ({
  dispatchMuseDAMClientAction: (action: string, args: unknown) => {
    if (action === "check-tag-setting") return state.check(args);
    return Promise.reject(new Error(action));
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => {
  state.setting = { tagLevel: 4, showAiTag: 1 };
  state.save.mockClear();
  state.check.mockReset();
  state.check.mockResolvedValue({ tagLevel: 3, hiddenTagCount: 0 });
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
    state.check.mockResolvedValue({ tagLevel: 3, hiddenTagCount: 5 });
    render(<TagSettingDialog />);
    fireEvent.click(screen.getByText("tagSetting"));
    fireEvent.click(screen.getByText("tagLevelThree"));
    expect(state.check).toHaveBeenCalledWith({ tagLevel: 3 });
    expect(await screen.findByText("hideFourthLevelTagsHint:5")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "confirm" }));
    await waitFor(() => expect(state.save).toHaveBeenCalledExactlyOnceWith({ tagLevel: 3, showAiTag: 1 }));
  });

  it("hides the hint when the precheck reports no tags to hide", async () => {
    state.check.mockResolvedValue({ tagLevel: 3, hiddenTagCount: 0 });
    render(<TagSettingDialog />);
    fireEvent.click(screen.getByText("tagSetting"));
    fireEvent.click(screen.getByText("tagLevelThree"));
    await waitFor(() => expect(state.check).toHaveBeenCalledWith({ tagLevel: 3 }));
    await act(async () => {
      await state.check.mock.results.at(-1)?.value;
    });
    expect(screen.queryByText(/hideFourthLevelTagsHint/)).toBeNull();
  });

  it("saves smart tag visibility without changing the current level", async () => {
    render(<TagSettingDialog />);
    fireEvent.click(screen.getByText("tagSetting"));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("confirm"));
    await waitFor(() => expect(state.save).toHaveBeenCalledExactlyOnceWith({ tagLevel: 4, showAiTag: 0 }));
  });
});
