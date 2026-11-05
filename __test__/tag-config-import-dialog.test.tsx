import { BatchTagImportExportDialog } from "@/app/tags/components/BatchTagImportExportDialog";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseTagImportFileAction: vi.fn(),
  precheckTagTreeImportAction: vi.fn(),
  importTagTreeAction: vi.fn(),
  exportTagTreeAction: vi.fn(),
  downloadTagTreeImportTemplateAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn(), warning: mocks.toastWarning },
}));
vi.mock("@/app/tags/tagBatchActions", () => mocks);
vi.mock("@/app/tags/components/TagImportPreview", () => ({
  TagImportPreview: ({ tree }: { tree: unknown[] }) => (
    <div data-testid="tag-tree-preview">{JSON.stringify(tree)}</div>
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.importTagTreeAction.mockResolvedValue({
    success: true,
    data: { successCount: 1, failedCount: 0, skippedCount: 0, failures: [] },
  });
});
function setup() {
  const onImportedText = vi.fn();
  const onImported = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <BatchTagImportExportDialog
      open
      onOpenChange={onOpenChange}
      maxLevel={3}
      tagsTree={[]}
      onImportedText={onImportedText}
      onImported={onImported}
    />,
  );
  return { ...view, onImportedText, onImported, onOpenChange };
}
function upload(container: HTMLElement) {
  fireEvent.change(container.ownerDocument.querySelector('input[type="file"]')!, {
    target: { files: [new File(["csv"], "tags.csv", { type: "text/csv" })] },
  });
}

describe("one entry for tag structure and configuration import/export", () => {
  it("imports a structure-only file through the same entry without a scope selector", async () => {
    mocks.precheckTagTreeImportAction.mockResolvedValue({
      success: true,
      data: { createCount: 0, createPaths: [], updateCount: 0, unchangedCount: 1, issues: [] },
    });
    const view = setup();
    expect(screen.queryByText("structureScope")).toBeNull();
    expect(screen.queryByText("configurationScope")).toBeNull();
    upload(view.container);
    fireEvent.click(screen.getByText("confirm"));
    await screen.findByText("importPreviewTitle");
    expect(mocks.importTagTreeAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((screen.getByText("continueImport") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByText("continueImport"));
    await waitFor(() => expect(mocks.importTagTreeAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(view.onImported).toHaveBeenCalledOnce());
    expect(view.onImportedText).not.toHaveBeenCalled();
  });

  it("shows a non-blocking warning after successful import of a normalized required group", async () => {
    mocks.precheckTagTreeImportAction.mockResolvedValue({
      success: true,
      data: { createCount: 0, createPaths: [], updateCount: 1, unchangedCount: 0, issues: [] },
    });
    mocks.importTagTreeAction.mockResolvedValue({
      success: true,
      data: {
        successCount: 1,
        failedCount: 0,
        skippedCount: 0,
        failures: [],
        autoDisabledRequiredGroups: ["适用场景 > 海报"],
      },
    });
    const view = setup();
    upload(view.container);
    fireEvent.click(screen.getByText("confirm"));
    await screen.findByText("importPreviewTitle");
    await waitFor(() =>
      expect((screen.getByText("continueImport") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByText("continueImport"));
    await waitFor(() =>
      expect(mocks.toastWarning).toHaveBeenCalledWith("requiredGroupsAutoDisabled", {
        duration: 10000,
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("importSuccess");
    expect(view.onImported).toHaveBeenCalledOnce();
    expect(view.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("prechecks configuration changes through the same entry before importing", async () => {
    mocks.precheckTagTreeImportAction.mockResolvedValue({
      success: true,
      data: {
        createCount: 1,
        createPaths: ["品牌 > 新标签"],
        updateCount: 1,
        renameCount: 1,
        unchangedCount: 0,
        issues: [],
      },
    });
    mocks.importTagTreeAction.mockResolvedValue({
      success: true,
      data: { successCount: 1, failedCount: 0, skippedCount: 0, failures: [] },
    });
    const view = setup();
    upload(view.container);
    fireEvent.click(screen.getByText("confirm"));
    await screen.findByText("importPreviewTitle");
    expect(mocks.importTagTreeAction).not.toHaveBeenCalled();
    const continueButton = screen.getByText("continueImport") as HTMLButtonElement;
    await waitFor(() => expect(continueButton.disabled).toBe(false));
    fireEvent.click(continueButton);
    await waitFor(() => expect(mocks.importTagTreeAction).toHaveBeenCalledOnce());
    const form = mocks.importTagTreeAction.mock.calls[0][0] as FormData;
    expect(form.get("tagLevel")).toBe("3");
    await waitFor(() => expect(view.onImported).toHaveBeenCalledOnce());
    expect(mocks.toastSuccess).toHaveBeenCalledWith("importSuccess");
    expect(view.onImportedText).not.toHaveBeenCalled();
  });

  it("lets the user return to editing without making changes", async () => {
    mocks.precheckTagTreeImportAction.mockResolvedValue({
      success: true,
      data: {
        createCount: 0,
        createPaths: [],
        updateCount: 1,
        renameCount: 1,
        unchangedCount: 0,
        issues: [],
      },
    });
    const view = setup();
    upload(view.container);
    fireEvent.click(screen.getByText("confirm"));
    const backButton = (await screen.findByText("backToEdit")) as HTMLButtonElement;
    await waitFor(() => expect(backButton.disabled).toBe(false));
    fireEvent.click(backButton);
    expect(mocks.importTagTreeAction).not.toHaveBeenCalled();
    expect(screen.queryByText("importPreviewTitle")).toBeNull();
    expect(screen.getByText("confirm").hasAttribute("disabled")).toBe(true);
  });
  it("keeps unchanged files in preview until merge is explicitly confirmed", async () => {
    mocks.precheckTagTreeImportAction.mockResolvedValue({
      success: true,
      data: {
        createCount: 0,
        createPaths: [],
        updateCount: 0,
        unchangedCount: 1,
        issues: [],
        previewTree: [{ name: "品牌", nameChildList: [{ name: "Logo" }] }],
      },
    });
    const view = setup();
    upload(view.container);
    fireEvent.click(screen.getByText("confirm"));
    await screen.findByText("importPreviewTitle");
    expect(screen.getByTestId("tag-tree-preview").textContent).toContain("Logo");
    expect(mocks.importTagTreeAction).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("radio", { name: "MergeIntoExistingTagSystem" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await waitFor(() =>
      expect((screen.getByText("continueImport") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByText("continueImport"));
    await waitFor(() => expect(mocks.importTagTreeAction).toHaveBeenCalledOnce());
    expect((mocks.importTagTreeAction.mock.calls[0][0] as FormData).get("importMode")).toBe(
      "merge",
    );
  });

  it("requires the second overwrite confirmation and preserves the uploaded file", async () => {
    mocks.precheckTagTreeImportAction.mockResolvedValue({
      success: true,
      data: {
        createCount: 1,
        createPaths: ["品牌"],
        updateCount: 0,
        unchangedCount: 0,
        issues: [],
        previewTree: [{ name: "品牌" }],
      },
    });
    const view = setup();
    upload(view.container);
    fireEvent.click(screen.getByText("confirm"));
    await screen.findByText("importPreviewTitle");
    const overwriteRadio = screen.getByRole("radio", {
      name: "UnderstoodPleaseProvideTheText",
    }) as HTMLButtonElement;
    await waitFor(() => expect(overwriteRadio.disabled).toBe(false));
    fireEvent.click(overwriteRadio);
    await waitFor(() =>
      expect((screen.getByText("continueImport") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByText("continueImport"));
    await screen.findByRole("alertdialog");
    expect(mocks.importTagTreeAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("ClearExistingTagsAndUseNewOnes"));
    await waitFor(() => expect(mocks.importTagTreeAction).toHaveBeenCalledOnce());
    const form = mocks.importTagTreeAction.mock.calls[0][0] as FormData;
    expect(form.get("importMode")).toBe("overwrite");
    expect((form.get("file") as File).name).toBe("tags.csv");
  });

  it("cancels overwrite without writing", async () => {
    mocks.precheckTagTreeImportAction.mockResolvedValue({
      success: true,
      data: {
        createCount: 1,
        createPaths: ["品牌"],
        updateCount: 0,
        unchangedCount: 0,
        issues: [],
      },
    });
    const view = setup();
    upload(view.container);
    fireEvent.click(screen.getByText("confirm"));
    await screen.findByText("importPreviewTitle");
    const overwriteRadio = screen.getByRole("radio", {
      name: "UnderstoodPleaseProvideTheText",
    }) as HTMLButtonElement;
    await waitFor(() => expect(overwriteRadio.disabled).toBe(false));
    fireEvent.click(overwriteRadio);
    await waitFor(() =>
      expect((screen.getByText("continueImport") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByText("continueImport"));
    const confirmation = await screen.findByRole("alertdialog");
    const { within } = await import("@testing-library/react");
    fireEvent.click(within(confirmation).getByText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.importTagTreeAction).not.toHaveBeenCalled();
    expect(screen.getByText("importPreviewTitle")).toBeTruthy();
  });

});

it("shows the running member and keeps the preview and selected file when the team is busy", async () => {
  mocks.precheckTagTreeImportAction.mockResolvedValue({
    success: true,
    data: { createCount: 1, createPaths: ["Tag"], updateCount: 0, unchangedCount: 0, issues: [] },
  });
  mocks.importTagTreeAction.mockResolvedValue({
    success: false,
    code: "busy",
    message: "成员 张三 正在执行批量导入，请稍后刷新页面重试。",
  });
  const view = setup();
  upload(view.container);
  fireEvent.click(screen.getByText("confirm"));
  await screen.findByText("importPreviewTitle");
  await waitFor(() =>
    expect((screen.getByText("continueImport") as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByText("continueImport"));
  await waitFor(() =>
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "成员 张三 正在执行批量导入，请稍后刷新页面重试。",
    ),
  );
  expect(screen.getByText("importPreviewTitle")).toBeTruthy();
  expect(view.onImported).not.toHaveBeenCalled();
  expect(view.onOpenChange).not.toHaveBeenCalled();
  expect(mocks.importTagTreeAction.mock.calls[0][0].get("file")).toBeInstanceOf(File);
});


it.each(["merge", "overwrite"])("prechecks once, keeps the uploaded preview when selecting %s, and writes only on confirmation", async (mode) => {
  mocks.precheckTagTreeImportAction.mockResolvedValue({
    success: true,
    data: { importableCount: 2, createCount: 0, createPaths: [], updateCount: 0, unchangedCount: 0, issues: [], previewTree: [{ name: "上传的树" }] },
  });
  const view = setup();
  upload(view.container);
  fireEvent.click(screen.getByText("confirm"));
  await screen.findByText("importPreviewTitle");
  const merge = screen.getByRole("radio", { name: "MergeIntoExistingTagSystem" }) as HTMLButtonElement;
  const overwrite = screen.getByRole("radio", { name: "UnderstoodPleaseProvideTheText" }) as HTMLButtonElement;
  await waitFor(() => expect(overwrite.disabled).toBe(false));
  fireEvent.click(overwrite);
  fireEvent.click(merge);
  if (mode === "overwrite") fireEvent.click(overwrite);
  expect(screen.getByTestId("tag-tree-preview").textContent).toContain("上传的树");
  expect(mocks.precheckTagTreeImportAction).toHaveBeenCalledTimes(1);
  expect(mocks.precheckTagTreeImportAction.mock.calls[0][0].has("importMode")).toBe(false);
  expect(mocks.importTagTreeAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("continueImport"));
  if (mode === "overwrite") {
    await screen.findByRole("alertdialog");
    expect(mocks.importTagTreeAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("ClearExistingTagsAndUseNewOnes"));
  }
  await waitFor(() => expect(mocks.importTagTreeAction).toHaveBeenCalledOnce());
  const form = mocks.importTagTreeAction.mock.calls[0][0] as FormData;
  expect(form.get("importMode")).toBe(mode);
  expect(form.get("treeImport")).toBe("true");
  expect((form.get("file") as File).name).toBe("tags.csv");
});


it.each(["merge", "overwrite"])("allows %s with duplicate notices and acknowledges only actual problem rows", async (mode) => {
  mocks.precheckTagTreeImportAction.mockResolvedValue({
    success: true,
    data: {
      importableCount: 1, createCount: 0, createPaths: [], updateCount: 0, unchangedCount: 0,
      issues: [{ rowNumber: 606, name: null, message: "invalid tree" }],
      warnings: [{ rowNumber: 583, name: null, message: "duplicates merged" }],
      previewTree: [{ name: "上传的树" }],
    },
  });
  const view = setup(); upload(view.container);
  fireEvent.click(screen.getByText("confirm"));
  await screen.findByText("importPreviewTitle");
  expect(screen.getByText("precheckWarningsLabel")).toBeTruthy();
  const overwrite = screen.getByRole("radio", { name: "UnderstoodPleaseProvideTheText" }) as HTMLButtonElement;
  await waitFor(() => expect(overwrite.disabled).toBe(false));
  if (mode === "overwrite") fireEvent.click(overwrite);
  const proceed = screen.getByText("continueImportSkipIssues") as HTMLButtonElement;
  await waitFor(() => expect(proceed.disabled).toBe(false));
  expect(mocks.precheckTagTreeImportAction).toHaveBeenCalledTimes(1);
  expect(mocks.importTagTreeAction).not.toHaveBeenCalled();
  fireEvent.click(proceed);
  if (mode === "overwrite") {
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("ClearExistingTagsAndUseNewOnes"));
  }
  await waitFor(() => expect(mocks.importTagTreeAction).toHaveBeenCalledOnce());
  const form = mocks.importTagTreeAction.mock.calls[0][0] as FormData;
  expect(form.get("skipRows")).toBe("[606]");
  expect(form.get("importMode")).toBe(mode);
});

it("keeps import disabled only when no valid tree nodes are available", async () => {
  mocks.precheckTagTreeImportAction.mockResolvedValue({ success: true, data: {
    importableCount: 0, createCount: 0, createPaths: [], updateCount: 0, unchangedCount: 0,
    issues: [{ rowNumber: 2, name: null, message: "invalid tree" }], previewTree: [],
  } });
  const view = setup(); upload(view.container); fireEvent.click(screen.getByText("confirm"));
  await screen.findByText("importPreviewTitle");
  expect((screen.getByText("continueImportSkipIssues") as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.importTagTreeAction).not.toHaveBeenCalled();
});
