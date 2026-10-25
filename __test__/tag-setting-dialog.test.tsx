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
  it("does not offer tag level switching", () => {
    render(<TagSettingDialog />);
    fireEvent.click(screen.getByText("tagSetting"));
    expect(screen.queryByText("tagLevel")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("saves smart tag visibility without changing the current level", async () => {
    render(<TagSettingDialog />);
    fireEvent.click(screen.getByText("tagSetting"));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("confirm"));
    await waitFor(() => expect(state.save).toHaveBeenCalledExactlyOnceWith({ tagLevel: 4, showAiTag: 0 }));
  });
});
