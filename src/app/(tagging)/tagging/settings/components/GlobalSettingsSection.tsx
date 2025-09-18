import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { SettingsIcon, TagIcon, TagsIcon } from "lucide-react";
import { useTranslations } from "next-intl";

interface GlobalSettingsSectionProps {
  isTaggingEnabled: boolean;
  onTaggingEnabledChange: (enabled: boolean) => void;
}

export function GlobalSettingsSection({
  isTaggingEnabled,
  onTaggingEnabledChange,
}: GlobalSettingsSectionProps) {
  const t = useTranslations("Tagging.Settings.Global");

  return (
    <div className="space-y-6">
      {/* AI 自动打标引擎 */}
      <div className="bg-background border rounded-lg">

        <div className="px-4 py-3 border-b">
          <h3 className="font-medium text-base">{t("title")}</h3>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-sm">{t("enableTagging")}</h3>
              <p className="text-[13px] text-basic-6 mt-1">{t("enableTaggingDesc")}</p>
            </div>
            <Switch checked={isTaggingEnabled} onCheckedChange={onTaggingEnabledChange} />
          </div>

          <div className="flex items-center gap-2 text-muted-foreground">
            <Button variant="outline" size="sm" onClick={() => dispatchMuseDAMClientAction("goto", { url: "/home/dashboard/tag" })}>
              <TagsIcon className="rotate-180 scale-y-[-1]" />
              {t("manageTagSystem")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
