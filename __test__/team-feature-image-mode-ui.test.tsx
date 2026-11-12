import SettingsClient from "@/app/(tagging)/tagging/settings/SettingsClient";
import { DEFAULT_TAGGING_SETTINGS } from "@/app/(tagging)/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const save = vi.hoisted(() => vi.fn());
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
vi.mock("@/embed/message", () => ({
  dispatchMuseDAMClientAction: vi.fn(),
  triggerTeamSettingsNotification: vi.fn(),
}));
vi.mock("@/app/(tagging)/tagging/settings/actions", () => ({ updateSettings: save }));
vi.mock("@/app/(tagging)/tagging/settings/components/GlobalSettingsSection", () => ({
  GlobalSettingsSection: () => null,
}));
vi.mock("@/app/(tagging)/tagging/settings/components/TaggingModeSection", () => ({
  TaggingModeSection: () => null,
}));
vi.mock("@/app/(tagging)/tagging/settings/components/MatchingStrategySection", () => ({
  MatchingStrategySection: () => null,
}));
vi.mock("@/app/(tagging)/tagging/settings/components/TriggerTimingSection", () => ({
  TriggerTimingSection: () => null,
}));
vi.mock("@/app/(tagging)/tagging/settings/components/ApplicationScopeSection", () => ({
  ApplicationScopeSection: () => null,
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue({ success: true });
});
it("saves the team toggle and retains its value when changing recognition accuracy", async () => {
  render(<SettingsClient initialSettings={DEFAULT_TAGGING_SETTINGS} />);
  const toggle = screen.getByRole("switch", { name: "imageModeImages" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("imageModeImageOff")).toBeTruthy();
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ featureImageMode: true })),
  );
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText("imageModeImageOn")).toBeTruthy();
  expect(screen.queryByText("imageModeImageOff")).toBeNull();
  fireEvent.click(screen.getByText("precise"));
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ recognitionAccuracy: "precise", featureImageMode: true }),
    ),
  );
});
it("restores the previous toggle value if saving fails", async () => {
  save.mockResolvedValue({ success: false });
  render(<SettingsClient initialSettings={DEFAULT_TAGGING_SETTINGS} />);
  const toggle = screen.getByRole("switch", { name: "imageModeImages" });
  fireEvent.click(toggle);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
});

it("keeps legacy image mode enabled but video off, and saves both independently", async () => {
  render(
    <SettingsClient
      initialSettings={{
        ...DEFAULT_TAGGING_SETTINGS,
        featureImageMode: true,
        featureVideoImageMode: undefined,
      }}
    />,
  );
  const image = screen.getByRole("switch", { name: "imageModeImages" });
  const video = screen.getByRole("switch", { name: "imageModeVideos" });
  expect(image.getAttribute("aria-checked")).toBe("true");
  expect(video.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("imageModeImageOn")).toBeTruthy();
  expect(screen.getByText("imageModeVideoOff")).toBeTruthy();
  fireEvent.click(video);
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ featureImageMode: true, featureVideoImageMode: true }),
    ),
  );
  await waitFor(() => expect((image as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText("imageModeVideoOn")).toBeTruthy();
  fireEvent.click(image);
  await waitFor(() =>
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ featureImageMode: false, featureVideoImageMode: true }),
    ),
  );
});
it("rolls back only the video switch when its save fails", async () => {
  save.mockResolvedValue({ success: false });
  render(
    <SettingsClient initialSettings={{ ...DEFAULT_TAGGING_SETTINGS, featureImageMode: true }} />,
  );
  const video = screen.getByRole("switch", { name: "imageModeVideos" });
  fireEvent.click(video);
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  await waitFor(() => expect(video.getAttribute("aria-checked")).toBe("false"));
  expect(screen.getByText("imageModeVideoOff")).toBeTruthy();
  expect(screen.queryByText("imageModeVideoOn")).toBeNull();
  expect(
    screen.getByRole("switch", { name: "imageModeImages" }).getAttribute("aria-checked"),
  ).toBe("true");
});
