import { Button } from "@/components/ui/button";
import { TagsIcon } from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AITaggingConfirmDialog } from "./AITaggingConfirmDialog";

interface GlobalSettingsSectionProps {
  isTaggingEnabled: boolean;
  onTaggingEnabledChange: (enabled: boolean) => void;
  hasTags?: boolean;
  hasOngoingTasks?: boolean;
  ongoingTasksCount?: number;
}

export function GlobalSettingsSection({
  isTaggingEnabled,
  onTaggingEnabledChange,
}: GlobalSettingsSectionProps) {
  const t = useTranslations("Tagging.Settings.Global");
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"enable" | "disable" | null>(null);

  const handleSwitchChange = (checked: boolean) => {
    const action = checked ? "enable" : "disable";
    setPendingAction(action);
    setConfirmDialogOpen(true);
  };

  const handleConfirm = () => {
    if (pendingAction) {
      const newValue = pendingAction === "enable";
      onTaggingEnabledChange(newValue);
    }
    setPendingAction(null);
  };

  const handleCancel = () => {
    setPendingAction(null);
  };

  return (
    <div className="space-y-6">
      {/* AI 自动打标引擎 */}
      <div className="bg-background border rounded-[6px]">
        <div className="px-4 py-3 border-b">
          <h3 className="font-medium text-base">{t("title")}</h3>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-sm">{t("enableTagging")}</h3>
              <p className="text-[13px] text-basic-6 mt-1">
                {isTaggingEnabled ? t("enableTaggingDesc") : t("disabledDesc")}
              </p>
            </div>
            <Switch checked={isTaggingEnabled} onCheckedChange={handleSwitchChange} />
          </div>

          <div className="flex items-center gap-2 text-basic-5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatchMuseDAMClientAction("goto", { url: "/home/dashboard/tag", target: "_blank" })}
            >
              <TagsIcon />
              {t("manageTagSystem")}
            </Button>
          </div>
        </div>
      </div>

      <AITaggingConfirmDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        action={pendingAction || "enable"}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}
