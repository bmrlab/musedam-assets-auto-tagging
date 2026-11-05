import { CollapsibleKeywordList } from "@/app/tags/components/CollapsibleKeywordList";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count: number }) =>
    key === "expandKeywords" ? `展开全部（${values?.count}）` : key === "collapseKeywords" ? "收起" : "删除",
}));
afterEach(cleanup);
const keywords = Array.from({ length: 3073 }, (_, index) => `SKU.${index}`);

describe("collapsible keyword list", () => {
  it.each([0, 12])("does not offer expansion for %i keywords", (count) => {
    render(<CollapsibleKeywordList keywords={keywords.slice(0, count)} />);
    expect(screen.queryByRole("button")).toBeNull();
    if (count === 0) expect(screen.getByText("-")).toBeTruthy();
    else expect(screen.getByText("SKU.11")).toBeTruthy();
  });

  it("previews 12 of 3073 keywords and expands and collapses the full list", () => {
    render(<CollapsibleKeywordList keywords={keywords} />);
    const toggle = screen.getByRole("button", { name: "展开全部（3073）" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("SKU.12")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText("SKU.3072")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(screen.queryByText("SKU.12")).toBeNull();
  });

  it("keeps matching and exclusion lists independent and resets for another tag", () => {
    const view = render(
      <>
        <CollapsibleKeywordList key="tag1:matching" keywords={keywords} />
        <CollapsibleKeywordList key="tag1:excluded" keywords={keywords.slice(0, 20)} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "展开全部（3073）" }));
    expect(screen.getByRole("button", { name: "展开全部（20）" }).getAttribute("aria-expanded")).toBe("false");
    view.rerender(<CollapsibleKeywordList key="tag2:matching" keywords={keywords} />);
    expect(screen.queryByText("SKU.3072")).toBeNull();
  });

  it("reveals hidden keywords when adding and removes by the original index", () => {
    const onRemove = vi.fn();
    render(
      <CollapsibleKeywordList keywords={keywords} onRemove={onRemove}>
        <button type="button">添加</button>
      </CollapsibleKeywordList>,
    );
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    const lastKeyword = screen.getByText("SKU.3072").parentElement!;
    fireEvent.click(within(lastKeyword).getByRole("button", { name: "删除: SKU.3072" }));
    expect(onRemove).toHaveBeenCalledWith(3072);
    expect(keywords).toHaveLength(3073);
  });
});
