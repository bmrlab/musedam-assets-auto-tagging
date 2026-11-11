import messages from "@/app/(tagging)/messages/zh-CN.json";
import { ReviewConfidence } from "@/app/(tagging)/tagging/review/components/ReviewConfidence";
import { MetadataReviewSuggestions } from "@/app/(tagging)/tagging/review/MetadataReviewSuggestions";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { prediction } from "../development/metadata-preview/actions";

vi.mock("@/components/ui/icons", () => ({
  ClockCircleIcon: () => <svg />,
  TagAIIcon: () => <svg />,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const provider = (children: React.ReactNode) => (
  <NextIntlClientProvider locale="zh-CN" messages={messages}>
    {children}
  </NextIntlClientProvider>
);

it.each([
  [80, "高"],
  [79, "中"],
  [70, "中"],
  [69, "低"],
])("shows the tag and metadata confidence level at score %s", (score, level) => {
  const { container } = render(provider(<ReviewConfidence score={score} />));
  expect(screen.getByText(level)).toBeTruthy();
  expect(container.textContent).not.toContain("%");
});

it.each([
  [95, "高"],
  [94, "中"],
  [90, "中"],
  [89, "低"],
])("keeps feature confidence boundaries at score %s", (score, level) => {
  render(provider(<ReviewConfidence score={score} high={95} medium={90} />));
  expect(screen.getByText(level)).toBeTruthy();
});

it("opens recorded evidence only from the icon and allows dismissing with Escape", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const onToggle = vi.fn();
  render(
    provider(
      <MetadataReviewSuggestions
        rows={[
          {
            id: 1,
            status: "pending",
            prediction: {
              ...prediction,
              sources: [{ source: "basicInfo", confidence: 0.9, evidence: "文件名含精华液" }],
            },
          },
        ]}
        onToggle={onToggle}
      />,
    ),
  );
  expect(screen.queryByText("文件名含精华液")).toBeNull();
  fireEvent.pointerDown(screen.getByRole("button", { name: /^命中依据 / }), {
    button: 0,
    ctrlKey: false,
  });
  expect(await screen.findByText("文件名含精华液")).toBeTruthy();
  expect(screen.getByText("基础信息匹配")).toBeTruthy();
  expect(onToggle).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByText("文件名含精华液")).toBeNull();
});
