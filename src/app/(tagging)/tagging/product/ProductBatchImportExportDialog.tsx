"use client";

import { useTranslations } from "next-intl";
import BatchImportExportDialog from "../components/BatchImportExportDialog";
import {
  downloadProductImportTemplateAction,
  exportProductsAction,
  importProductsAction,
} from "./actions";
import type { ProductBatchImportResult } from "./types";

type ProductBatchImportExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (result: ProductBatchImportResult) => void;
};

export default function ProductBatchImportExportDialog({
  open,
  onOpenChange,
  onImported,
}: ProductBatchImportExportDialogProps) {
  const t = useTranslations("Tagging.ProductLibrary.batchImportExport");

  return (
    <BatchImportExportDialog
      open={open}
      entityName={t("entityName")}
      entityNamePlural={t("entityNamePlural")}
      templateEntityName={t("templateEntityName")}
      onOpenChange={onOpenChange}
      onImported={onImported}
      exportAction={exportProductsAction}
      importAction={importProductsAction}
      downloadTemplateAction={downloadProductImportTemplateAction}
    />
  );
}
