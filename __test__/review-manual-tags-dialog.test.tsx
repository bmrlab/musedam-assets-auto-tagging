import { AddTagDialog } from "@/app/(tagging)/tagging/review/components/AddTagDialog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchTree = vi.hoisted(() => vi.fn());
vi.mock("@/app/(tagging)/tagging/review/actions", () => ({ fetchReviewTagTreeAction: fetchTree }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, args?: { count?: number }) =>
    args ? `${key} ${args.count}` : key,
}));
const nodes = [
  { id: 1, parentId: null, name: "颜色", selectable: true },
  { id: 2, parentId: 1, name: "红色", selectable: true },
  { id: 3, parentId: null, name: "风格", selectable: true },
  { id: 4, parentId: 3, name: "现代", selectable: true },
  { id: 5, parentId: 4, name: "简约", selectable: true },
  { id: 6, parentId: 5, name: "室内", selectable: true },
];
afterEach(cleanup);
beforeEach(() => {
  fetchTree.mockReset();
  fetchTree.mockResolvedValue({ success: true, data: nodes });
});

describe("hierarchical manual review tag picker", () => {
  it("browses four levels without selecting parents and confirms the full path", async () => {
    const confirm = vi.fn();
    const close = vi.fn();
    render(<AddTagDialog open onOpenChange={close} addedIds={new Set()} onConfirm={confirm} />);
    fireEvent.click(await screen.findByRole("button", { name: "风格" }));
    fireEvent.click(screen.getByRole("button", { name: "现代" }));
    fireEvent.click(screen.getByRole("button", { name: "简约" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "风格 > 现代 > 简约 > 室内" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "addFeatureConfirm 1" }));
    expect(confirm).toHaveBeenCalledWith([{ id: 6, tagPath: ["风格", "现代", "简约", "室内"] }]);
    expect(close).toHaveBeenCalledWith(false);
  });

  it("keeps added parents navigable and disables duplicate selection", async () => {
    render(
      <AddTagDialog open onOpenChange={vi.fn()} addedIds={new Set([1, 2])} onConfirm={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "颜色" }));
    const existing = screen.getByRole("checkbox", {
      name: "颜色 > 红色",
    }) as HTMLButtonElement;
    expect(existing.disabled).toBe(true);
    expect(existing.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps picks across branch searches and cancels without adding", async () => {
    const confirm = vi.fn();
    render(<AddTagDialog open onOpenChange={vi.fn()} addedIds={new Set()} onConfirm={confirm} />);
    fireEvent.click(await screen.findByRole("button", { name: "颜色" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "颜色 > 红色" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "简约" } });
    expect(screen.queryByRole("button", { name: "颜色" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "风格" }));
    fireEvent.click(screen.getByRole("button", { name: "现代" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "风格 > 现代 > 简约" }));
    expect(screen.getByRole("button", { name: "addFeatureConfirm 2" })).toBeTruthy();
    expect(fetchTree).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "rejectConfirmCancel" }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("shows a recoverable error when loading fails", async () => {
    fetchTree.mockRejectedValueOnce(new Error("offline"));
    render(<AddTagDialog open onOpenChange={vi.fn()} addedIds={new Set()} onConfirm={vi.fn()} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "addTagRetry" }));
    expect(await screen.findByRole("button", { name: "颜色" })).toBeTruthy();
  });
});
