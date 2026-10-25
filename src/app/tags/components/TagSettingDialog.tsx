"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  EnterpriseTagSetting,
  useEnterpriseTagSetting,
} from "../hooks/useEnterpriseTagSetting";

export function TagSettingDialog() {
  const t = useTranslations("TagsPage");
  const { setting, save } = useEnterpriseTagSetting();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EnterpriseTagSetting>(setting);

  useEffect(() => {
    if (open) setDraft(setting);
  }, [open, setting]);

  const persist = async () => {
    setSaving(true);
    try {
      // 层级切换暂时关闭，保存时不改 tagLevel。
      await save({ ...draft, tagLevel: setting.tagLevel });
      toast.success(t("tagSettingSaved"));
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("tagSettingFailed"));
    } finally {
      setSaving(false);
    }
  };

  const onConfirm = () => {
    if (draft.showAiTag === setting.showAiTag) {
      setOpen(false);
      return;
    }
    void persist();
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
    </>
  );
}
