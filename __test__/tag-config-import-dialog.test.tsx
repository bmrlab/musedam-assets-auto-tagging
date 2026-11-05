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
    await screen.findByText("precheckTitle");
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
    expect(screen.queryByText("precheckTitle")).toBeNull();
    expect(screen.getByText("confirm").hasAttribute("disabled")).toBe(true);
  });
});
