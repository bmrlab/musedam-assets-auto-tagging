"use client";

import { useTranslations } from "next-intl";
import BatchImportExportDialog from "../components/BatchImportExportDialog";
import {
  downloadPersonImportTemplateAction,
  exportPersonsAction,
  importPersonsAction,
} from "./actions";
import type { PersonBatchImportResult } from "./types";

type PersonBatchImportExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (result: PersonBatchImportResult) => void;
};

export default function PersonBatchImportExportDialog({
  open,
  onOpenChange,
  onImported,
}: PersonBatchImportExportDialogProps) {
  const t = useTranslations("Tagging.PersonLibrary.batchImportExport");

  return (
    <BatchImportExportDialog
      open={open}
      entityName={t("entityName")}
      entityNamePlural={t("entityNamePlural")}
      templateEntityName={t("templateEntityName")}
      onOpenChange={onOpenChange}
      onImported={onImported}
      exportAction={exportPersonsAction}
      importAction={importPersonsAction}
      downloadTemplateAction={downloadPersonImportTemplateAction}
    />
  );
}
