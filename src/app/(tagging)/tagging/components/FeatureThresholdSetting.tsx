"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FEATURE_CONFIDENCE_MIN, type FeatureType } from "@/lib/tagging/feature-confidence";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchFeatureThreshold, saveFeatureThreshold } from "./feature-threshold-actions";
export default function FeatureThresholdSetting({ type }: { type: FeatureType }) {
  const t = useTranslations("Tagging.FeatureThreshold");
  const [value, setValue] = useState<number>(FEATURE_CONFIDENCE_MIN[type]);
  const [draft, setDraft] = useState(String(value));
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    fetchFeatureThreshold(type)
      .then((n) => {
        if (active) {
          setValue(n);
          setDraft(String(n));
          setReady(true);
        }
      })
      .catch(() => toast.error(t("loadFailed")));
    return () => {
      active = false;
    };
  }, [type, t]);
  const valid =
    draft.trim() !== "" &&
    Number.isInteger(Number(draft)) &&
    Number(draft) >= 0 &&
    Number(draft) <= 100;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setDraft(String(value));
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-8 whitespace-nowrap rounded-md px-3 font-normal"
          disabled={!ready}
        >
          {ready ? t("trigger", { value }) : t("loading")}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-80 space-y-3 rounded-xl bg-background p-4 text-basic-8">
        <DialogTitle className="text-sm font-semibold">{t("title")}</DialogTitle>
        <DialogDescription className="text-sm text-basic-5">{t("hint")}</DialogDescription>
        <label className="flex items-center gap-2 text-sm">
          {t("minimum")}
          <Input
            type="number"
            min={0}
            max={100}
            step={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-8 w-20"
          />
          %
        </label>
        {type === "person" && <p className="text-xs text-basic-5">{t("personHint")}</p>}
        <Button
          className="h-8 w-full"
          disabled={!valid || saving}
          onClick={async () => {
            setSaving(true);
            try {
              const n = await saveFeatureThreshold(type, Number(draft));
              setValue(n);
              setOpen(false);
              toast.success(t("saved"));
            } catch {
              toast.error(t("saveFailed"));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? t("saving") : t("save")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
