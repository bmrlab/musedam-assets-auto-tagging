"use client";

import BatchImportExportDialog from "@/app/(tagging)/tagging/components/BatchImportExportDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  downloadTagTreeImportTemplateAction,
  exportTagTreeAction,
  importTagTreeAction,
  precheckTagTreeImportAction,
  type TagTreeBatchImportResult,
  type TagTreeImportPrecheck,
} from "../tagBatchActions";
import { TagImportPreview } from "./TagImportPreview";

export function TagImportExportDialog({
  open,
  maxLevel,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  maxLevel: 3 | 4;
  onOpenChange: (open: boolean) => void;
  onImported: (result: TagTreeBatchImportResult) => void;
}) {
  const t = useTranslations("TagsPage");
  const tips = useTranslations("TagsPage.ManualCreateTipsModal");
  const overwriteTips = useTranslations("TagsPage.ManualCreateTips2Modal");
  const [importMode, setImportMode] = useState<"merge" | "overwrite">("merge");
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  const pendingConfirmation = useRef<((confirmed: boolean) => void) | null>(null);
  useEffect(() => {
    if (open) setImportMode("merge");
    return () => {
      pendingConfirmation.current?.(false);
      pendingConfirmation.current = null;
    };
  }, [open]);
  function resolveOverwrite(confirmed: boolean) {
    pendingConfirmation.current?.(confirmed);
    pendingConfirmation.current = null;
    setOverwriteOpen(false);
  }

  return (
    <>
      <BatchImportExportDialog<TagTreeBatchImportResult>
        open={open}
        reviewTitle={t("importPreviewTitle")}
        reviewClassName="w-[960px]"
        showResultDialog
        renderReview={(precheck, pending) => (
          <div className="flex flex-col gap-4">
            <TagImportPreview
              tree={(precheck as TagTreeImportPrecheck).previewTree ?? []}
              maxLevel={maxLevel}
            />
            <p className="text-[13px] leading-[18px] text-basic-6">
              {t("importPreviewConfigurationHint")}
            </p>
            <RadioGroup
              value={importMode}
              onValueChange={(value) => {
                setImportMode(value as "merge" | "overwrite");
              }}
              disabled={pending}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <RadioGroupItem type="button" value="merge" id="tag-import-merge" />
                  <Label htmlFor="tag-import-merge">{tips("MergeIntoExistingTagSystem")}</Label>
                </div>
                <p className="pl-6 text-[12px] leading-4 text-basic-5">
                  {tips("RetainExistingTagsAndAddNewTag")}
                </p>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <RadioGroupItem type="button" value="overwrite" id="tag-import-overwrite" />
                  <Label htmlFor="tag-import-overwrite">
                    {tips("UnderstoodPleaseProvideTheText")}
                  </Label>
                </div>
                <p className="pl-6 text-[12px] leading-4 text-basic-5">
                  {tips("ClearExistingTagsKeepOnlyTheNe")}
                </p>
              </div>
            </RadioGroup>
          </div>
        )}
        confirmImport={() =>
          importMode === "merge"
            ? Promise.resolve(true)
            : new Promise<boolean>((resolve) => {
                pendingConfirmation.current = resolve;
                setOverwriteOpen(true);
              })
        }
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
          formData.set("importMode", importMode);
          formData.set("treeImport", "true");
          return importTagTreeAction(formData);
        }}
        precheckAction={async (formData) => {
          formData.set("tagLevel", String(maxLevel));
          return precheckTagTreeImportAction(formData);
        }}
        downloadTemplateAction={downloadTagTreeImportTemplateAction}
        uploadHint={t("importUploadHint")}
      />
      <AlertDialog
        open={overwriteOpen}
        onOpenChange={(next) => {
          if (!next) resolveOverwrite(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{overwriteTips("HereSTheTranslatedVersionFollo")}</AlertDialogTitle>
            <AlertDialogDescription>
              {overwriteTips("ConfirmToUseTheNewTagSystemOnl")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => resolveOverwrite(false)}>
              {tips("Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={() => resolveOverwrite(true)}>
              {overwriteTips("ClearExistingTagsAndUseNewOnes")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
