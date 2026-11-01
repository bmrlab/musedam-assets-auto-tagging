import {
  BatchCreateTagsProvider,
  useBatchCreateTagsContext,
} from "@/app/tags/context/BatchCreateTagsContext";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ batchCreateTags: vi.fn(), checkExistingTags: vi.fn() }));
vi.mock("@/app/tags/actions", () => actions);
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const input = [{ name: "品牌", nameChildList: [{ name: "新标签" }] }];
function Trigger() {
  const { handleAddTags } = useBatchCreateTagsContext();
  return <button onClick={() => void handleAddTags(input)}>import</button>;
}
function setup() {
  render(
    <BatchCreateTagsProvider>
      <Trigger />
    </BatchCreateTagsProvider>,
  );
  fireEvent.click(screen.getByText("import"));
}
async function chooseOverwrite() {
  setup();
  fireEvent.click(await screen.findByRole("radio", { name: "UnderstoodPleaseProvideTheText" }));
  fireEvent.click(screen.getByText("Confirm"));
  return screen.findByRole("button", { name: "ClearExistingTagsAndUseNewOnes" });
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  actions.checkExistingTags.mockResolvedValue({ success: true, data: { hasExistingTags: true } });
  actions.batchCreateTags.mockResolvedValue({ success: true });
});

describe("batch import merge and overwrite choices", () => {
  it("defaults to merge and does not replace the existing tree", async () => {
    setup();
    const merge = await screen.findByRole("radio", { name: "MergeIntoExistingTagSystem" });
    expect(merge.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText("Confirm"));
    await waitFor(() => expect(actions.batchCreateTags).toHaveBeenCalledExactlyOnceWith(input, 2));
    expect(screen.queryByText("ClearExistingTagsAndUseNewOnes")).toBeNull();
  });

  it("requires a second confirmation with a red button before overwriting", async () => {
    const confirm = await chooseOverwrite();
    expect(confirm.className).toContain("bg-danger-6");
    expect(actions.batchCreateTags).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.batchCreateTags).toHaveBeenCalledExactlyOnceWith(input, 1));
  });

  it("does not change any tags when the second confirmation is cancelled", async () => {
    const confirm = await chooseOverwrite();
    const dialog = confirm.closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(dialog).getByText("Cancel"));
    expect(actions.batchCreateTags).not.toHaveBeenCalled();
    expect(screen.queryByText("ClearExistingTagsAndUseNewOnes")).toBeNull();
  });

  it("does not submit overwrite twice while it is saving", async () => {
    let finish!: (value: { success: true }) => void;
    actions.batchCreateTags.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const confirm = await chooseOverwrite();
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(actions.batchCreateTags).toHaveBeenCalledTimes(1);
    finish({ success: true });
    await waitFor(() => expect(screen.queryByText("CreateTagPrompt")).toBeNull());
  });
});
