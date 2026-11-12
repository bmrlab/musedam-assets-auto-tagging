import { FeatureRetryControl, FeatureRetryButton, FeatureRetryContent } from "@/app/(tagging)/tagging/review/components/FeatureRetryControl";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ status: vi.fn(), retry: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/(tagging)/tagging/review/feature-retry-actions", () => ({
  getFeatureRetryStatus: m.status,
  retryFeatures: m.retry,
}));
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("shows skeletons only while processing and refreshes after completion", async () => {
  m.status
    .mockResolvedValueOnce({ success: true, data: { status: "pending" } })
    .mockResolvedValueOnce({ success: true, data: { status: "processing" } })
    .mockResolvedValueOnce({ success: true, data: { status: "completed" } });
  const complete = vi.fn();
  await act(async () => {
    render(<FeatureRetryControl sourceId={1} onComplete={complete} />);
  });
  expect(screen.queryByLabelText("featureRetryProcessing")).toBeNull();
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button").textContent).toContain("featureRetryRunning");
  expect(screen.queryByText("featureRetryPending")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  const skeleton = screen.getByLabelText("featureRetryProcessing");
  expect(skeleton.children[0].className).toContain("size-10");
  expect(skeleton.children[1].children.length).toBe(3);
  expect(screen.queryByText("featureRetryProcessing")).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(screen.queryByLabelText("featureRetryProcessing")).toBeNull();
  expect(complete).toHaveBeenCalledTimes(1);
});
it("offers retry after failure without showing an indefinite skeleton", async () => {
  m.status.mockResolvedValue({ success: true, data: { status: "failed" } });
  let finish!: (value: unknown) => void;
  m.retry.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    render(<FeatureRetryControl sourceId={1} />);
  });
  expect(screen.getByText("featureRetryFailed")).toBeTruthy();
  expect(screen.queryByLabelText("featureRetryProcessing")).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(screen.getByRole("button"));
  expect(m.retry).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ success: true, data: { id: 2, status: "pending" } });
  });
});
it("stops polling and offers a status check after repeated network failures", async () => {
  m.status.mockRejectedValue(Error("offline"));
  await act(async () => {
    render(<FeatureRetryControl sourceId={1} />);
  });
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(screen.getByText("featureRetryStatusUnknown")).toBeTruthy();
  expect(screen.getByRole("button").textContent).toContain("featureRetryCheck");
  expect(screen.queryByLabelText("featureRetryProcessing")).toBeNull();
});

it("places the retry button in the title row and keeps the content borderless", async () => {
  m.status.mockResolvedValue({ success: true, data: null });
  await act(async () => {
    render(<FeatureRetryControl sourceId={1}>
      <header>Feature recognition<FeatureRetryButton /></header>
      <section data-testid="feature-body"><FeatureRetryContent /></section>
    </FeatureRetryControl>);
  });
  expect(screen.getByRole("button").closest("header")).toBeTruthy();
  expect(screen.getByTestId("feature-body").querySelector(".border")).toBeNull();
  expect(screen.getByText("featureRetryIncomplete")).toBeTruthy();
});
