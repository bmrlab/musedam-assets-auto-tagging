"use client";

import { Button } from "@/components/ui/button";
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
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { cn } from "@/lib/utils";
import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  EnterpriseTagSetting,
  useEnterpriseTagSetting,
} from "../hooks/useEnterpriseTagSetting";

function HiddenCountHint({
  template,
  count,
  loading,
}: {
  template: string;
  count: number;
  loading: boolean;
}) {
  const [before, after = ""] = template.split("__COUNT__");
  return (
    <>
      {before}
      {loading ? (
        <span className="mx-0.5 inline-block h-3.5 w-4 animate-pulse rounded-sm bg-basic-3 align-middle" />
      ) : (
        count
      )}
      {after}
    </>
  );
}

function readHiddenTagCount(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const record = data as Record<string, unknown>;
  const direct = Number(record.hiddenTagCount);
  if (Number.isFinite(direct)) return direct > 0 ? Math.floor(direct) : 0;
  if (record.result) return readHiddenTagCount(record.result);
  if (record.data) return readHiddenTagCount(record.data);
  return 0;
}

export function TagSettingDialog({
  onLevelChanged,
  fallbackHiddenCount = 0,
}: {
  onLevelChanged?: () => void;
  /** 主站预检没有返回时，用本地标签树里的第 4 层数量 */
  fallbackHiddenCount?: number;
}) {
  const t = useTranslations("TagsPage");
  const { setting, save } = useEnterpriseTagSetting();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EnterpriseTagSetting>(setting);
  const [hiddenTagCount, setHiddenTagCount] = useState(0);
  const [checkingHiddenCount, setCheckingHiddenCount] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(setting);
  }, [open, setting]);

  useEffect(() => {
    if (!open || draft.tagLevel !== 3) {
      setCheckingHiddenCount(false);
      setHiddenTagCount(0);
      return;
    }
    let cancelled = false;
    setCheckingHiddenCount(true);
    setHiddenTagCount(0);
    const finish = (count: number) => {
      if (cancelled) return;
      window.clearTimeout(timer);
      setHiddenTagCount(count);
      setCheckingHiddenCount(false);
    };
    const timer = window.setTimeout(() => finish(fallbackHiddenCount), 3000);
    void dispatchMuseDAMClientAction("check-tag-setting", { tagLevel: 3 })
      .then((data) => finish(readHiddenTagCount(data)))
      .catch(() => finish(fallbackHiddenCount));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, draft.tagLevel, fallbackHiddenCount]);

  const persist = async (levelChanged: boolean) => {
    setSaving(true);
    try {
      await save(draft);
      if (levelChanged) onLevelChanged?.();
      toast.success(t("tagSettingSaved"));
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
    void persist(draft.tagLevel !== setting.tagLevel);
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
              {draft.tagLevel === 3 && (checkingHiddenCount || hiddenTagCount > 0) && (
                <p className="text-[13px] leading-5 text-basic-5">
                  <HiddenCountHint
                    template={t("hideFourthLevelTagsHint", { count: "__COUNT__" })}
                    count={hiddenTagCount}
                    loading={checkingHiddenCount}
                  />
                </p>
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
    </>
  );
}
