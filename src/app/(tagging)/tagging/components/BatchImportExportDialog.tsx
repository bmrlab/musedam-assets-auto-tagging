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
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

type BatchMode = "import" | "export";
type ExportFormat = "xlsx" | "csv";

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
};

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
}: BatchImportExportDialogProps<TResult>) {
  const t = useTranslations("Tagging.BatchImportExport");
  const [mode, setMode] = useState<BatchMode>("import");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [failureResult, setFailureResult] = useState<TResult | null>(null);
  const [isPending, startTransition] = useTransition();
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
  const isConfirmDisabled =
    isPending || (mode === "import" && !selectedFile) || (mode === "export" && !exportFormat);

  function resetState() {
    setMode("import");
    setExportFormat("xlsx");
    setSelectedFile(null);
    setFailureResult(null);
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

  function handleImport() {
    if (!selectedFile) {
      toast.error(t("selectFileFirst"));
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    startTransition(async () => {
      const result = await importAction(formData);

      if (!result.success) {
        setFailureResult({
          successCount: 0,
          failedCount: 1,
          skippedCount: 0,
          failures: [
            {
              rowNumber: 1,
              name: null,
              message: result.message,
            },
          ],
        } as TResult);
        return;
      }

      if (result.data.successCount > 0) {
        onImported(result.data);
      }

      if (result.data.failures.length > 0) {
        setFailureResult(result.data);
        toast.warning(
          t("partialImportWarning", {
            success: result.data.successCount,
            failed: result.data.failedCount,
          }),
        );
        return;
      }

      toast.success(
        t("importSuccess", {
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

    handleImport();
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
      <DialogContent className="flex max-h-[92vh] w-[512px] max-w-[calc(100%-2rem)] flex-col gap-5 overflow-y-auto rounded-[16px] border p-5">
        {isFailureView && failureResult ? (
          <>
            <DialogHeader className="gap-0 p-0">
              <DialogTitle className="text-[16px] leading-6 font-semibold text-[#151A30]">
                {failureResult.successCount > 0
                  ? t("partialImportFailedTitle")
                  : t("importFailedTitle")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("failureSrDescription", { entity: entityName })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-5">
              <div className="flex flex-col items-center justify-center rounded-[8px] bg-[#F7F9FC] px-4 py-8">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF4DF] text-[#F7B23B]">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="mt-4 text-[14px] leading-[22px] font-semibold text-[#192038]">
                  {failureResult.successCount > 0
                    ? t("partialImportFailedHint")
                    : t("importFailedHint")}
                </div>
              </div>

              <p className="text-[12px] leading-[16px] font-normal text-[#8F9BB3]">
                {failureResult.successCount > 0
                  ? t("partialImportFailedDesc", {
                      success: failureResult.successCount,
                      failed: failureResult.failedCount,
                    })
                  : t("importFailedDesc")}
              </p>

              <div className="max-h-[160px] overflow-y-auto rounded-[8px] bg-[#F7F9FC] px-4 py-3">
                <ul className="list-disc space-y-2 pl-4 text-[14px] leading-[22px] font-normal text-[#192038]">
                  {failureResult.failures.map((failure, index) => (
                    <li key={`${failure.rowNumber}-${index}`}>{formatFailureMessage(failure)}</li>
                  ))}
                </ul>
              </div>
            </div>

            <DialogFooter className="gap-[10px] p-0">
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadTemplate}
                disabled={isPending}
                className="h-8 rounded-[6px] border border-[#C5CEE0] px-3 py-1 text-[14px] leading-[22px]"
              >
                {t("downloadTemplate")}
              </Button>
              <Button
                type="button"
                onClick={handleRetryImport}
                disabled={isPending}
                className="h-8 rounded-[6px] bg-[#3366FF] px-3 py-1 text-[14px] leading-[22px]"
              >
                {t("retryImport")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="gap-0 p-0">
              <DialogTitle className="text-[16px] leading-6 font-semibold text-[#151A30]">
                {t("title")}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t("srDescription", { entity: entityName })}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-5">
              <div className="grid w-full grid-cols-2 rounded-[8px] bg-[#F7F9FC] p-1">
                {(["import", "export"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    disabled={isPending}
                    className={cn(
                      "h-8 rounded-[6px] text-[14px] leading-[22px] font-semibold text-[#101426] transition-colors",
                      mode === item
                        ? "bg-white shadow-[0_1px_5px_0_rgba(0,0,0,0.18)]"
                        : "bg-transparent",
                    )}
                  >
                    {item === "import" ? t("tabImport") : t("tabExport")}
                  </button>
                ))}
              </div>

              {mode === "export" ? (
                <div className="flex flex-col gap-5">
                  <p className="text-[14px] leading-[22px] font-normal text-[#222B45]">
                    {t("exportFormatLabel")}
                  </p>
                  <RadioGroup
                    value={exportFormat}
                    onValueChange={(value) => setExportFormat(value as ExportFormat)}
                    className="flex items-center gap-8 rounded-[8px] border border-[#E4E9F2] px-4 py-3"
                  >
                    <label className="flex cursor-pointer items-center gap-2 text-[14px] leading-[22px] font-normal text-[#192038]">
                      <RadioGroupItem value="xlsx" className="size-4" />
                      {t("formatExcel")}
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-[14px] leading-[22px] font-normal text-[#192038]">
                      <RadioGroupItem value="csv" className="size-4" />
                      {t("formatCsv")}
                    </label>
                  </RadioGroup>
                  <div className="flex items-start gap-2 text-[12px] leading-[16px] font-normal text-[#8F9BB3]">
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
                    className="flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-[8px] bg-[#F7F9FC] px-4 py-6 text-center outline-none ring-[#3366FF]/40 transition-shadow focus-visible:ring-4"
                  >
                    <div className="relative">
                      <FileSpreadsheet className="h-12 w-12 text-[#7BDCB5]" />
                      <span className="absolute -top-1 -right-4 rounded-[4px] bg-[#2DBB7F] px-1.5 py-0.5 text-[10px] leading-4 text-white">
                        {t("spreadsheetBadge")}
                      </span>
                    </div>
                    <p className="mt-4 text-[12px] leading-[16px] font-normal text-[#8F9BB3]">
                      {t("uploadHintLine1")}
                      <br />
                      {t("uploadHintLine2")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-4 h-8 rounded-[6px] border border-[#C5CEE0] px-3 py-1 text-[14px] leading-[22px] text-[#192038]"
                      onClick={(event) => {
                        event.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      disabled={isPending}
                    >
                      {t("selectFile")}
                    </Button>
                    {selectedFile ? (
                      <div className="mt-3 max-w-full truncate text-[14px] leading-[22px] font-normal text-[#192038]">
                        {selectedFile.name}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="mt-4 text-[12px] leading-[16px] font-normal text-[#3366FF] transition-opacity hover:opacity-80"
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

            <DialogFooter className="gap-[10px] p-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isPending}
                className="h-8 shrink-0 rounded-[6px] border border-[#C5CEE0] px-3 py-1 text-[14px] leading-[22px]"
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={isConfirmDisabled}
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[6px] bg-[#3366FF] px-3 py-1 text-[14px] leading-[22px]"
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
