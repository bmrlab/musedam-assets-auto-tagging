"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ServerActionResult } from "@/lib/serverAction";
import { cn } from "@/lib/utils";
import { AlertCircle, FileSpreadsheet, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

type BatchMode = "import" | "export";
type ExportFormat = "xlsx" | "csv";
type MissingTagsImportChoice = "create" | "existing-only";

export type BatchFileResult = {
  filename: string;
  mimeType: string;
  base64: string;
};

export type BatchImportFailure = {
  rowNumber: number;
  name: string | null;
  message: string;
};

export type BatchImportResultBase = {
  successCount: number;
  failedCount: number;
  skippedCount: number;
  failures: BatchImportFailure[];
  missingTagPaths?: string[];
};

export type BatchImportPrecheck = {
  importableCount?: number;
  reviewable?: boolean;
  createCount: number;
  createPaths: string[];
  updateCount: number;
  renameCount?: number;
  unchangedCount: number;
  /** 正式导入时会被跳过的行 */
  issues: BatchImportFailure[];
};

const PRECHECK_LIST_LIMIT = 100;

function failureKey(failure: BatchImportFailure) {
  return `${failure.rowNumber}|${failure.message}`;
}

type BatchImportExportDialogProps<TResult extends BatchImportResultBase> = {
  open: boolean;
  entityName: string;
  entityNamePlural: string;
  templateEntityName: string;
  onOpenChange: (open: boolean) => void;
  onImported: (result: TResult) => void;
  exportAction: (format: ExportFormat) => Promise<ServerActionResult<BatchFileResult>>;
  importAction: (formData: FormData) => Promise<ServerActionResult<TResult>>;
  downloadTemplateAction: (format: ExportFormat) => Promise<ServerActionResult<BatchFileResult>>;
  /** 覆盖上传区第二行说明 */
  uploadHint?: string;
  headerExtra?: (pending: boolean) => ReactNode;
  /** 提供时先检测：有问题行、会新建或改名时二次确认，用户可返回修改或继续导入 */
  precheckAction?: (formData: FormData) => Promise<ServerActionResult<BatchImportPrecheck>>;
  /** Require a read-only review even if every imported tag already exists. */
  reviewTitle?: string;
  renderReview?: (
    precheck: BatchImportPrecheck,
    pending: boolean,
    recheck: (fields: Record<string, string>) => void,
  ) => ReactNode;
  confirmImport?: () => Promise<boolean>;
  blockImportOnIssues?: boolean;
};

function downloadBase64File(file: BatchFileResult) {
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: file.mimeType,
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isSupportedImportFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".csv");
}

export default function BatchImportExportDialog<TResult extends BatchImportResultBase>({
  open,
  entityName,
  entityNamePlural,
  templateEntityName,
  onOpenChange,
  onImported,
  exportAction,
  importAction,
  downloadTemplateAction,
  uploadHint,
  headerExtra,
  precheckAction,
  reviewTitle,
  renderReview,
  confirmImport,
  blockImportOnIssues = false,
}: BatchImportExportDialogProps<TResult>) {
  const t = useTranslations("Tagging.BatchImportExport");
  const [mode, setMode] = useState<BatchMode>("import");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [failureResult, setFailureResult] = useState<TResult | null>(null);
  const [missingTagsResult, setMissingTagsResult] = useState<TResult | null>(null);
  const [pendingMissingTagsChoice, setPendingMissingTagsChoice] =
    useState<MissingTagsImportChoice | null>(null);
  const [precheckResult, setPrecheckResult] = useState<BatchImportPrecheck | null>(null);
  const [isTransitionPending, startTransition] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);
  const isPending = isTransitionPending || isConfirming;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function formatFailureMessage(failure: BatchImportFailure) {
    const name = failure.name ? t("failureRowName", { name: failure.name }) : "";
    return t("failureRow", {
      row: failure.rowNumber,
      name,
      message: failure.message,
    });
  }

  const isFailureView = Boolean(failureResult?.failures.length);
  const isMissingTagsConfirmationView = Boolean(missingTagsResult?.missingTagPaths?.length);
  const isConfirmDisabled =
    isPending || (mode === "import" && !selectedFile) || (mode === "export" && !exportFormat);

  function resetState() {
    setMode("import");
    setExportFormat("xlsx");
    setSelectedFile(null);
    setFailureResult(null);
    setMissingTagsResult(null);
    setPendingMissingTagsChoice(null);
    setPrecheckResult(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (isPending) {
      return;
    }

    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  }

  function handleSelectFile(file: File | null) {
    if (!file) {
      return;
    }

    if (!isSupportedImportFile(file)) {
      toast.error(t("unsupportedFileType"));
      return;
    }

    setSelectedFile(file);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    handleSelectFile(event.dataTransfer.files?.[0] ?? null);
  }

  function handleExport() {
    startTransition(async () => {
      const result = await exportAction(exportFormat);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      downloadBase64File(result.data);
      toast.success(t("exportDownloadStarted", { entity: entityName }));
      handleOpenChange(false);
    });
  }

  function showSingleFailure(message: string) {
    setFailureResult({
      successCount: 0,
      failedCount: 1,
      skippedCount: 0,
      failures: [{ rowNumber: 1, name: null, message }],
    } as TResult);
  }

  function handlePrecheck(fields: Record<string, string> = {}) {
    if (!precheckAction) return;
    if (!selectedFile) {
      toast.error(t("selectFileFirst"));
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    for (const [key, value] of Object.entries(fields)) formData.set(key, value);

    startTransition(async () => {
      const result = await precheckAction(formData);
      // A review flow stays in preview even when validation fails. Switching
      // modes must never look like an import has run or discard the uploaded file.
      if (renderReview) {
        setFailureResult(null);
        setPrecheckResult(result.success ? result.data : {
          createCount: 0,
          createPaths: [],
          updateCount: 0,
          unchangedCount: 0,
          issues: [{ rowNumber: 1, name: null, message: result.message }],
        });
        return;
      }
      if (!result.success) {
        setPrecheckResult(null);
        showSingleFailure(result.message);
        return;
      }

      const precheck = result.data;
      const importableCount = precheck.createCount + precheck.updateCount + precheck.unchangedCount;
      if (importableCount === 0 && !(renderReview && precheck.reviewable)) {
        setPrecheckResult(null);
        setFailureResult({
          successCount: 0,
          failedCount: precheck.issues.length,
          skippedCount: 0,
          failures: precheck.issues,
        } as TResult);
        return;
      }
      if (
        !renderReview &&
        precheck.issues.length === 0 &&
        precheck.createCount === 0 &&
        !precheck.renameCount
      ) {
        handleImport();
        return;
      }
      setPrecheckResult(precheck);
    });
  }

  async function handleImport({
    createMissingTags = false,
    importExistingTagsOnly = false,
    acknowledgedIssues = [],
  }: {
    createMissingTags?: boolean;
    importExistingTagsOnly?: boolean;
    /** 检测阶段已确认跳过的问题行，导入后不再重复报错 */
    acknowledgedIssues?: BatchImportFailure[];
  } = {}) {
    if (!selectedFile) {
      toast.error(t("selectFileFirst"));
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);
    if (createMissingTags) {
      formData.append("createMissingTags", "true");
    }
    if (importExistingTagsOnly) {
      formData.append("importExistingTagsOnly", "true");
    }
    if (createMissingTags || importExistingTagsOnly) {
      setPendingMissingTagsChoice(createMissingTags ? "create" : "existing-only");
    }

    if (acknowledgedIssues.length > 0) {
      formData.set(
        "skipRows",
        JSON.stringify([...new Set(acknowledgedIssues.map((issue) => issue.rowNumber))]),
      );
    }

    if (isPending) return;
    if (confirmImport) {
      setIsConfirming(true);
      let confirmed = false;
      try {
        confirmed = await confirmImport();
      } finally {
        setIsConfirming(false);
      }
      if (!confirmed) return;
    }
    startTransition(async () => {
      const result = await importAction(formData);
      if (!result.success && result.code === "busy") {
        toast.warning(result.message);
        setPendingMissingTagsChoice(null);
        return;
      }
      setPendingMissingTagsChoice(null);
      if (createMissingTags || importExistingTagsOnly) {
        setMissingTagsResult(null);
      }

      setPrecheckResult(null);

      if (!result.success) {
        showSingleFailure(result.message);
        return;
      }

      if (result.data.missingTagPaths?.length) {
        setMissingTagsResult(result.data);
        return;
      }

      onImported(result.data);

      const acknowledgedKeys = new Set(acknowledgedIssues.map(failureKey));
      const unexpectedFailures = result.data.failures.filter(
        (failure) => !acknowledgedKeys.has(failureKey(failure)),
      );
      const skippedCount = result.data.skippedCount + result.data.failures.length - unexpectedFailures.length;

      if (unexpectedFailures.length > 0) {
        setFailureResult({
          ...result.data,
          failures: unexpectedFailures,
          failedCount: unexpectedFailures.length,
        });
        toast.warning(
          t("partialImportWarning", {
            success: result.data.successCount,
            failed: unexpectedFailures.length,
          }),
        );
        return;
      }

      toast.success(
        skippedCount > 0
          ? t("importSuccessWithSkipped", {
              count: result.data.successCount,
              skipped: skippedCount,
            })
          : t("importSuccess", {
              count: result.data.successCount,
              entity: entityNamePlural,
            }),
      );
      handleOpenChange(false);
    });
  }

  function handleConfirm() {
    if (mode === "export") {
      handleExport();
      return;
    }

    if (precheckAction) {
      handlePrecheck();
      return;
    }
    handleImport();
  }

  function handleBackToEdit() {
    setPrecheckResult(null);
    setSelectedFile(null);
    setMode("import");
  }

  function handleDownloadTemplate() {
    startTransition(async () => {
      const result = await downloadTemplateAction("xlsx");

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      downloadBase64File(result.data);
    });
  }

  function handleRetryImport() {
    setFailureResult(null);
    setSelectedFile(null);
    setMode("import");
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[512px] max-w-[calc(100%-2rem)] flex-col gap-5 overflow-hidden rounded-[16px] border p-5">
        {precheckResult ? (
          <>
            <DialogHeader className="gap-0 p-0">
              <DialogTitle className="text-[16px] leading-6 font-semibold text-basic-9">
                {reviewTitle ?? t("precheckTitle")}
              </DialogTitle>
              <DialogDescription className="sr-only">{t("precheckHint")}</DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-5">
                {renderReview ? (
                  renderReview(precheckResult, isPending, handlePrecheck)
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-[8px] bg-basic-1 px-4 py-8">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF4DF] text-[#F7B23B]">
                      <AlertCircle className="h-5 w-5" />
                    </div>
                    <div className="mt-4 text-[14px] leading-[22px] font-semibold text-basic-8">
                      {t("precheckHint")}
                    </div>
                    <div className="mt-2 text-center text-[12px] leading-[18px] text-basic-6">
                      {t("precheckSummary", {
                        create: precheckResult.createCount,
                        update: precheckResult.updateCount,
                        unchanged: precheckResult.unchangedCount,
                      })}
                      {precheckResult.renameCount ? (
                        <>
                          <br />
                          {t("precheckRenameNotice", { count: precheckResult.renameCount })}
                        </>
                      ) : null}
                    </div>
                  </div>
                )}

                {precheckResult.issues.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[12px] leading-[16px] font-normal text-basic-5">
                      {t("precheckIssuesLabel", { count: precheckResult.issues.length })}
                    </p>
                    <div className="max-h-[160px] overflow-y-auto rounded-[8px] bg-basic-1 px-4 py-3">
                      <ul className="list-disc space-y-2 pl-4 text-[14px] leading-[22px] font-normal text-basic-8">
                        {precheckResult.issues
                          .slice(0, PRECHECK_LIST_LIMIT)
                          .map((failure, index) => (
                            <li key={`${failure.rowNumber}-${index}`}>
                              {formatFailureMessage(failure)}
                            </li>
                          ))}
                        {precheckResult.issues.length > PRECHECK_LIST_LIMIT ? (
                          <li>{t("precheckMoreItems", { count: precheckResult.issues.length })}</li>
                        ) : null}
                      </ul>
                    </div>
                  </div>
                ) : null}

                {!renderReview && precheckResult.createPaths.length > 0 ? (
                  <div>
                    <p className="mb-2 text-[12px] leading-[16px] font-normal text-basic-5">
                      {t("precheckCreateLabel", { count: precheckResult.createCount })}
                    </p>
                    <div className="max-h-[160px] overflow-y-auto rounded-[8px] bg-basic-1 px-4 py-3">
                      <ul className="list-disc space-y-2 pl-4 text-[14px] leading-[22px] font-normal text-basic-8">
                        {precheckResult.createPaths.slice(0, PRECHECK_LIST_LIMIT).map((path) => (
                          <li key={path}>{path}</li>
                        ))}
                        {precheckResult.createPaths.length > PRECHECK_LIST_LIMIT ? (
                          <li>
                            {t("precheckMoreItems", { count: precheckResult.createPaths.length })}
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <DialogFooter className="gap-[10px] p-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleBackToEdit}
                disabled={isPending}
                className="h-8 rounded-[6px] border border-basic-4 px-3 py-1 text-[14px] leading-[22px]"
              >
                {t("backToEdit")}
              </Button>
              <Button
                type="button"
                onClick={() => handleImport({ acknowledgedIssues: precheckResult.issues })}
                disabled={
                  isPending ||
                  (blockImportOnIssues && precheckResult.issues.length > 0) ||
                  (precheckResult.importableCount ?? (precheckResult.createCount +
                    precheckResult.updateCount +
                    precheckResult.unchangedCount)) === 0
                }
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] bg-primary-6 px-3 py-1 text-[14px] leading-[22px]"
              >
                {isPending ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
                {precheckResult.issues.length > 0 && !blockImportOnIssues
                  ? t("continueImportSkipIssues")
                  : t("continueImport")}
              </Button>
            </DialogFooter>
          </>
        ) : isMissingTagsConfirmationView && missingTagsResult ? (
          <>
            <DialogHeader className="gap-2 p-0">
              <DialogTitle className="text-[16px] leading-6 font-semibold text-basic-9">
                {t("missingTagsConfirmTitle")}
              </DialogTitle>
              <DialogDescription className="text-[14px] leading-[22px] text-basic-6">
                {t("missingTagsConfirmDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="mb-2 text-[12px] leading-[16px] font-normal text-basic-5">
                {t("missingTagsListLabel")}
              </p>
              <div className="max-h-[240px] overflow-y-auto rounded-[8px] bg-basic-1 px-4 py-3">
                <ul className="list-disc space-y-2 pl-4 text-[14px] leading-[22px] font-normal text-basic-8">
                  {missingTagsResult.missingTagPaths?.map((tagPath) => (
                    <li key={tagPath}>{tagPath}</li>
                  ))}
                </ul>
              </div>
            </div>

            <DialogFooter className="gap-[10px] p-0 sm:flex-wrap">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMissingTagsResult(null)}
                disabled={isPending}
                className="h-8 shrink-0 rounded-[6px] border border-basic-4 px-3 py-1 text-[14px] leading-[22px]"
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleImport({ importExistingTagsOnly: true })}
                disabled={isPending}
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[6px] border border-basic-4 px-3 py-1 text-[14px] leading-[22px]"
              >
                {isPending && pendingMissingTagsChoice === "existing-only" ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                ) : null}
                {t("importExistingTagsOnly")}
              </Button>
              <Button
                type="button"
                onClick={() => handleImport({ createMissingTags: true })}
                disabled={isPending}
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[6px] bg-primary-6 px-3 py-1 text-[14px] leading-[22px]"
              >
                {isPending && pendingMissingTagsChoice === "create" ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                ) : null}
                {t("createTagsAndImport")}
              </Button>
            </DialogFooter>
          </>
        ) : isFailureView && failureResult ? (
          <>
            <DialogHeader className="gap-0 p-0">
              <DialogTitle className="text-[16px] leading-6 font-semibold text-basic-9">
                {failureResult.successCount > 0
                  ? t("partialImportFailedTitle")
                  : t("importFailedTitle")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("failureSrDescription", { entity: entityName })}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col items-center justify-center rounded-[8px] bg-basic-1 px-4 py-8">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF4DF] text-[#F7B23B]">
                    <AlertCircle className="h-5 w-5" />
                  </div>
                  <div className="mt-4 text-[14px] leading-[22px] font-semibold text-basic-8">
                    {failureResult.successCount > 0
                      ? t("partialImportFailedHint")
                      : t("importFailedHint")}
                  </div>
                </div>

                <p className="text-[12px] leading-[16px] font-normal text-basic-5">
                  {failureResult.successCount > 0
                    ? t("partialImportFailedDesc", {
                        success: failureResult.successCount,
                        failed: failureResult.failedCount,
                      })
                    : t("importFailedDesc")}
                </p>

                <div className="max-h-[160px] overflow-y-auto rounded-[8px] bg-basic-1 px-4 py-3">
                  <ul className="list-disc space-y-2 pl-4 text-[14px] leading-[22px] font-normal text-basic-8">
                    {failureResult.failures.map((failure, index) => (
                      <li key={`${failure.rowNumber}-${index}`}>{formatFailureMessage(failure)}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-[10px] p-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadTemplate}
                disabled={isPending}
                className="h-8 rounded-[6px] border border-basic-4 px-3 py-1 text-[14px] leading-[22px]"
              >
                {t("downloadTemplate")}
              </Button>
              <Button
                type="button"
                onClick={handleRetryImport}
                disabled={isPending}
                className="h-8 rounded-[6px] bg-primary-6 px-3 py-1 text-[14px] leading-[22px]"
              >
                {t("retryImport")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="gap-0 p-0">
              <DialogTitle className="text-[16px] leading-6 font-semibold text-basic-9">
                {t("title")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("srDescription", { entity: entityName })}
              </DialogDescription>
            </DialogHeader>

            {headerExtra?.(isPending)}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex flex-col gap-5">
                <div className="grid w-full grid-cols-2 rounded-[8px] bg-basic-1 p-1">
                  {(["import", "export"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setMode(item)}
                      disabled={isPending}
                      className={cn(
                        "h-8 rounded-[6px] text-[14px] leading-[22px] font-semibold text-basic-8 transition-colors",
                        mode === item
                          ? "bg-background shadow-[0_1px_5px_0_rgba(0,0,0,0.18)]"
                          : "bg-transparent",
                      )}
                    >
                      {item === "import" ? t("tabImport") : t("tabExport")}
                    </button>
                  ))}
                </div>

                {mode === "export" ? (
                  <div className="flex flex-col gap-5">
                    <p className="text-[14px] leading-[22px] font-normal text-basic-8">
                      {t("exportFormatLabel")}
                    </p>
                    <RadioGroup
                      value={exportFormat}
                      onValueChange={(value) => setExportFormat(value as ExportFormat)}
                      className="flex items-center gap-8 rounded-[8px] border border-basic-3 px-4 py-3"
                    >
                      <label className="flex cursor-pointer items-center gap-2 text-[14px] leading-[22px] font-normal text-basic-8">
                        <RadioGroupItem value="xlsx" className="size-4" />
                        {t("formatExcel")}
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-[14px] leading-[22px] font-normal text-basic-8">
                        <RadioGroupItem value="csv" className="size-4" />
                        {t("formatCsv")}
                      </label>
                    </RadioGroup>
                    <div className="flex items-start gap-2 text-[12px] leading-[16px] font-normal text-basic-5">
                      <span>{t("exportHint", { entity: entityName })}</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.csv"
                      className="hidden"
                      onChange={(event) => handleSelectFile(event.target.files?.[0] ?? null)}
                    />
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          fileInputRef.current?.click();
                        }
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={handleDrop}
                      className="flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-[8px] bg-basic-1 px-4 py-6 text-center outline-none ring-[#3366FF]/40 transition-shadow focus-visible:ring-4"
                    >
                      <div className="relative">
                        <FileSpreadsheet className="h-12 w-12 text-[#7BDCB5]" />
                        <span className="absolute -top-1 -right-4 rounded-[4px] bg-[#2DBB7F] px-1.5 py-0.5 text-[10px] leading-4 text-white">
                          {t("spreadsheetBadge")}
                        </span>
                      </div>
                      <p className="mt-4 text-[12px] leading-[16px] font-normal text-basic-5">
                        {t("uploadHintLine1")}
                        <br />
                        {uploadHint ?? t("uploadHintLine2")}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-4 h-8 rounded-[6px] border border-basic-4 px-3 py-1 text-[14px] leading-[22px] text-basic-8"
                        onClick={(event) => {
                          event.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        disabled={isPending}
                      >
                        {t("selectFile")}
                      </Button>
                      {selectedFile ? (
                        <div className="mt-3 max-w-full truncate text-[14px] leading-[22px] font-normal text-basic-8">
                          {selectedFile.name}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="mt-4 text-[12px] leading-[16px] font-normal text-primary-6 transition-opacity hover:opacity-80"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDownloadTemplate();
                        }}
                        disabled={isPending}
                      >
                        {t("downloadSampleTemplate", { entity: templateEntityName })}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="gap-[10px] p-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
                className="h-8 shrink-0 rounded-[6px] border border-basic-4 px-3 py-1 text-[14px] leading-[22px]"
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={isConfirmDisabled}
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[6px] bg-primary-6 px-3 py-1 text-[14px] leading-[22px]"
              >
                {isPending ? <Loader2 className="size-4 shrink-0 animate-spin" /> : null}
                {t("confirm")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
