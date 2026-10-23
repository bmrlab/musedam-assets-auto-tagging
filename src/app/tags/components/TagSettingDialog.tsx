"use client";

import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  EnterpriseTagSetting,
  useEnterpriseTagSetting,
} from "../hooks/useEnterpriseTagSetting";

export function TagSettingDialog({
  onLevelChanged,
}: {
  onLevelChanged?: () => void;
}) {
  const t = useTranslations("TagsPage");
  const { setting, save } = useEnterpriseTagSetting();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EnterpriseTagSetting>(setting);

  useEffect(() => {
    if (open) setDraft(setting);
  }, [open, setting]);

  const persist = async (levelChanged: boolean) => {
    setSaving(true);
    try {
      await save(draft);
      if (levelChanged) onLevelChanged?.();
      toast.success(t("tagSettingSaved"));
      setConfirmOpen(false);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("tagSettingFailed"));
    } finally {
      setSaving(false);
    }
  };

  const onConfirm = () => {
    if (draft.tagLevel === setting.tagLevel && draft.showAiTag === setting.showAiTag) {
      setOpen(false);
      return;
    }
    if (draft.tagLevel !== setting.tagLevel) {
      setConfirmOpen(true);
      return;
    }
    void persist(false);
  };

  return (
    <>
      <Button variant="outline" size="sm" className="h-8 font-normal" onClick={() => setOpen(true)}>
        <Settings className="size-[14px]" />
        {t("tagSetting")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="gap-4 p-5 sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold leading-6">{t("tagSettingTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium leading-[22px] text-basic-9">{t("tagLevel")}</div>
              <RadioGroup
                value={String(draft.tagLevel)}
                onValueChange={(value) => setDraft({ ...draft, tagLevel: value === "4" ? 4 : 3 })}
                className="gap-2"
              >
                {[
                  { value: "3", label: t("tagLevelThree"), showDefault: true },
                  { value: "4", label: t("tagLevelFour"), showDefault: false },
                ].map((option) => {
                  const selected = String(draft.tagLevel) === option.value;
                  return (
                    <Label
                      key={option.value}
                      htmlFor={`tag-level-${option.value}`}
                      className={cn(
                        "flex h-14 cursor-pointer items-center justify-between rounded-md border px-3 text-sm font-normal leading-[22px] text-basic-8",
                        selected ? "border-primary-6 bg-primary-1" : "border-basic-4 bg-background",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <RadioGroupItem value={option.value} id={`tag-level-${option.value}`} />
                        {option.label}
                      </span>
                      {option.showDefault && (
                        <span className="text-sm font-normal leading-[22px] text-basic-5">{t("tagLevelDefault")}</span>
                      )}
                    </Label>
                  );
                })}
              </RadioGroup>
              {draft.tagLevel !== setting.tagLevel && (
                <p className="text-[13px] leading-5 text-destructive">{t("clearEnterpriseTagsHint")}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium leading-[22px] text-basic-9">{t("smartTag")}</div>
              <div className="flex h-14 items-center justify-between rounded-md border border-basic-4 px-3">
                <span className="text-sm leading-[22px] text-basic-8">{t("showAiTagOnDetail")}</span>
                <Switch
                  size="sm"
                  checked={draft.showAiTag === 1}
                  onCheckedChange={(checked) => setDraft({ ...draft, showAiTag: checked ? 1 : 0 })}
                />
              </div>
              <p className="text-xs leading-5 text-basic-5">{t("showAiTagHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={saving} onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button size="sm" disabled={saving} onClick={onConfirm}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmOpen} onOpenChange={(next) => !saving && setConfirmOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tagSettingTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("clearEnterpriseTagsHint")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={() => void persist(true)}>
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
