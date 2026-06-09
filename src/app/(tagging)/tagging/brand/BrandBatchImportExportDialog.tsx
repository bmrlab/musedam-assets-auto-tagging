"use client";

import { useTranslations } from "next-intl";
import BatchImportExportDialog from "../components/BatchImportExportDialog";
import {
  downloadBrandImportTemplateAction,
  exportBrandLogosAction,
  importBrandLogosAction,
} from "./actions";
import type { BrandLogoBatchImportResult } from "./types";

type BrandBatchImportExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (result: BrandLogoBatchImportResult) => void;
};

export default function BrandBatchImportExportDialog({
  open,
  onOpenChange,
  onImported,
}: BrandBatchImportExportDialogProps) {
  const t = useTranslations("Tagging.BrandLibrary.batchImportExport");

  return (
    <BatchImportExportDialog
      open={open}
      entityName={t("entityName")}
      entityNamePlural={t("entityNamePlural")}
      templateEntityName={t("templateEntityName")}
      onOpenChange={onOpenChange}
      onImported={onImported}
      exportAction={exportBrandLogosAction}
      importAction={importBrandLogosAction}
      downloadTemplateAction={downloadBrandImportTemplateAction}
    />
  );
}
