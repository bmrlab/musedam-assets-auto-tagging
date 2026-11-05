"use client";

import BatchImportExportDialog from "@/app/(tagging)/tagging/components/BatchImportExportDialog";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  downloadTagTreeImportTemplateAction,
  exportTagTreeAction,
  importTagTreeAction,
  precheckTagTreeImportAction,
  type TagTreeBatchImportResult,
} from "../tagBatchActions";

export function TagImportExportDialog({
  open,
  maxLevel,
  onOpenChange,
  onImported,
  headerExtra,
}: {
  open: boolean;
  maxLevel: 3 | 4;
  onOpenChange: (open: boolean) => void;
  onImported: (result: TagTreeBatchImportResult) => void;
  headerExtra?: (pending: boolean) => ReactNode;
}) {
  const t = useTranslations("TagsPage");

  return (
    <BatchImportExportDialog<TagTreeBatchImportResult>
      open={open}
      headerExtra={headerExtra}
      entityName={t("tag")}
      entityNamePlural={t("tag")}
      templateEntityName={t("tag")}
      onOpenChange={onOpenChange}
      onImported={(result) => {
        onImported(result);
        const affected = result.autoDisabledRequiredGroups ?? [];
        if (affected.length > 0) {
          const tags = affected.slice(0, 10).join("、");
          toast.warning(
            t("requiredGroupsAutoDisabled", {
              tags:
                affected.length > 10
                  ? t("requiredGroupsAutoDisabledMore", { tags, count: affected.length })
                  : tags,
            }),
            { duration: 10000 },
          );
        }
      }}
      exportAction={(format) => exportTagTreeAction(format, maxLevel)}
      importAction={async (formData) => {
        formData.set("tagLevel", String(maxLevel));
        return importTagTreeAction(formData);
      }}
      precheckAction={async (formData) => {
        formData.set("tagLevel", String(maxLevel));
        return precheckTagTreeImportAction(formData);
      }}
      downloadTemplateAction={downloadTagTreeImportTemplateAction}
      uploadHint={t("importUploadHint")}
    />
  );
}
