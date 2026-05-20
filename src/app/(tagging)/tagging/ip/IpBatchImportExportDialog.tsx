"use client";

import { useTranslations } from "next-intl";
import BatchImportExportDialog from "../components/BatchImportExportDialog";
import { downloadIpImportTemplateAction, exportIpsAction, importIpsAction } from "./actions";
import type { IpBatchImportResult } from "./types";

type IpBatchImportExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (result: IpBatchImportResult) => void;
};

export default function IpBatchImportExportDialog({
  open,
  onOpenChange,
  onImported,
}: IpBatchImportExportDialogProps) {
  const t = useTranslations("Tagging.IpLibrary.batchImportExport");

  return (
    <BatchImportExportDialog
      open={open}
      entityName={t("entityName")}
      entityNamePlural={t("entityNamePlural")}
      templateEntityName={t("templateEntityName")}
      onOpenChange={onOpenChange}
      onImported={onImported}
      exportAction={exportIpsAction}
      importAction={importIpsAction}
      downloadTemplateAction={downloadIpImportTemplateAction}
    />
  );
}
