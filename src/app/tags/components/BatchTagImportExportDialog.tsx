"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { AlertCircle, FileSpreadsheet, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  downloadTagImportTemplateAction,
  exportTagTreeFileAction,
  parseTagImportFileAction,
} from "../tagBatchFileActions";
import { flattenTagNodesToRows } from "../tagImportExport";
import type { TagNode } from "../types";

type BatchMode = "import" | "export";
type ExportFormat = "xlsx" | "csv";

function downloadBase64File(file: { filename: string; mimeType: string; base64: string }) {
  const binary = atob(file.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function BatchTagImportExportDialog({
  open,
  onOpenChange,
  maxLevel,
  tagsTree,
  onImportedText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxLevel: 3 | 4;
  tagsTree: TagNode[];
  onImportedText: (text: string) => void;
}) {
  const t = useTranslations("TagsPage.BatchTagImportExport");
  const [mode, setMode] = useState<BatchMode>("import");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setMode("import");
      setExportFormat("xlsx");
      setErrorMessage(null);
    }
  }, [open]);

  function handleDownloadTemplate() {
    startTransition(async () => {
      const result = await downloadTagImportTemplateAction("xlsx", maxLevel);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      downloadBase64File(result.data);
    });
  }

  function handleExport() {
    startTransition(async () => {
      const rows = flattenTagNodesToRows(tagsTree, maxLevel);
      const result = await exportTagTreeFileAction(rows, exportFormat, maxLevel);
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      downloadBase64File(result.data);
      toast.success(t("exportSuccess"));
      onOpenChange(false);
    });
  }

  function handleFileChange(file: File | null) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
      setErrorMessage(t("unsupportedFileType"));
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("maxLevel", String(maxLevel));
      const result = await parseTagImportFileAction(formData);
      if (!result.success) {
        setErrorMessage(result.message);
        return;
      }
      onOpenChange(false);
      onImportedText(result.data.text);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[580px] max-w-[calc(100%-2rem)] flex-col gap-4 overflow-hidden rounded-[16px] border p-5">
        <DialogHeader className="gap-0 p-0">
          <DialogTitle className="text-[16px] leading-6 font-semibold text-basic-9">
            {errorMessage ? t("importFailed") : t("title")}
          </DialogTitle>
        </DialogHeader>

        {errorMessage ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center justify-center rounded-[8px] bg-basic-1 px-4 py-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF4DF] text-[#F7B23B]">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="mt-4 text-[14px] leading-[22px] font-semibold text-basic-8">
                {t("importFailed")}
              </div>
            </div>
            <p className="text-[14px] leading-[22px] text-basic-5">{errorMessage}</p>
            <ul className="list-disc space-y-2 rounded-[8px] bg-basic-1 px-4 py-3 pl-8 text-[14px] text-basic-8">
              <li>{t("checkTemplateFormat")}</li>
              <li>{t("level1Required")}</li>
            </ul>
            <DialogFooter className="gap-2 p-0">
              <Button variant="outline" onClick={handleDownloadTemplate} disabled={isPending}>
                {t("downloadTemplate")}
              </Button>
              <Button
                onClick={() => setErrorMessage(null)}
                disabled={isPending}
              >
                {t("reimport")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex">
              <div className="flex h-8 items-center space-x-0.5 rounded-lg bg-basic-1 p-0.5">
                {(["import", "export"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    className={cn(
                      "flex h-[28px] w-[80px] cursor-pointer items-center justify-center rounded-md border border-solid text-[13px] leading-[18px]",
                      mode === item
                        ? "border-basic-3 bg-background font-medium text-basic-8"
                        : "border-transparent text-basic-6",
                    )}
                  >
                    {item === "import" ? t("import") : t("export")}
                  </button>
                ))}
              </div>
            </div>

            {mode === "import" ? (
              <div className="flex h-[312px] flex-col items-center justify-center rounded-md bg-basic-1">
                <div className="relative flex h-[62px] w-[62px] items-center justify-center rounded-lg border border-solid border-basic-3">
                  <FileSpreadsheet className="size-5 text-basic-6" />
                  <div className="absolute right-[-7px] top-[5px] flex h-[20px] w-[32px] items-center justify-center rounded border border-[rgba(0,0,0,0.15)] bg-[#2FB776] text-[10px] text-white">
                    XLS
                  </div>
                </div>
                <div className="mt-4 flex w-[316px] flex-col items-center gap-1 text-center text-[12px] leading-[20px] text-basic-5">
                  <div>{t("uploadHint")}</div>
                  <div>{maxLevel === 4 ? t("uploadSubHint4") : t("uploadSubHint3")}</div>
                </div>
                <button
                  type="button"
                  className="mt-6 flex h-9 w-[160px] cursor-pointer items-center justify-center rounded border border-solid border-basic-3 bg-background text-[14px] text-basic-8"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isPending}
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : t("chooseFile")}
                </button>
                <button
                  type="button"
                  className="mt-4 cursor-pointer text-[13px] leading-[18px] text-basic-6"
                  onClick={handleDownloadTemplate}
                  disabled={isPending}
                >
                  {t("downloadTemplateExample")}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    handleFileChange(file);
                  }}
                />
              </div>
            ) : (
              <div className="flex h-[312px] flex-col gap-3">
                <div className="text-[14px] font-medium leading-[20px] text-basic-8">
                  {t("downloadTable")}
                </div>
                <div className="flex h-[68px] items-center rounded-md border border-solid border-basic-3 px-3">
                  <RadioGroup
                    value={exportFormat}
                    onValueChange={(value) => setExportFormat(value as ExportFormat)}
                    className="flex w-full items-center gap-8"
                  >
                    <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                      <RadioGroupItem value="xlsx" />
                      Excel
                    </label>
                    <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                      <RadioGroupItem value="csv" />
                      CSV
                    </label>
                  </RadioGroup>
                </div>
                <div className="text-[14px] leading-[22px] text-basic-5">{t("exportAndEdit")}</div>
              </div>
            )}

            <DialogFooter className="gap-2 p-0">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                {t("cancel")}
              </Button>
              {mode === "export" ? (
                <Button onClick={handleExport} disabled={isPending}>
                  {isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                  {t("confirm")}
                </Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
