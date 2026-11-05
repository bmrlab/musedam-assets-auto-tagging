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
import { Button } from "@/components/ui/button";
import { TagsIcon } from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { TablePropertiesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AITaggingConfirmDialog } from "./AITaggingConfirmDialog";

interface GlobalSettingsSectionProps {
  isTaggingEnabled: boolean;
  isMetadataEnabled: boolean;
  metadataAvailable?: boolean;
  disabled?: boolean;
  onMetadataEnabledChange: (enabled: boolean) => void;
  onTaggingEnabledChange: (enabled: boolean) => void;
  hasTags?: boolean;
  hasOngoingTasks?: boolean;
  ongoingTasksCount?: number;
}

export function GlobalSettingsSection({
  isTaggingEnabled,
  isMetadataEnabled,
  metadataAvailable,
  disabled,
  onMetadataEnabledChange,
  onTaggingEnabledChange,
}: GlobalSettingsSectionProps) {
  const t = useTranslations("Tagging.Settings.Global");
  const [metadataConfirm, setMetadataConfirm] = useState<boolean | null>(null);
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
              <h3 className="font-medium text-sm">
                {t(metadataAvailable ? "tagSystemSwitch" : "enableTagging")}
              </h3>
              <p className="text-[13px] text-basic-6 mt-1">
                {isTaggingEnabled ? t("enableTaggingDesc") : t("disabledDesc")}
              </p>
            </div>
            <Switch
              disabled={disabled}
              aria-label={t("tagSystemSwitch")}
              checked={isTaggingEnabled}
              onCheckedChange={handleSwitchChange}
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                dispatchMuseDAMClientAction("goto", {
                  url: "/home/dashboard/tag",
                  target: "_blank",
                })
              }
            >
              <TagsIcon />
              {t("manageTagSystem")}
            </Button>
          </div>
          {metadataAvailable && (
            <div className="flex flex-col gap-4 border-t pt-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium">{t("metadataSwitch")}</h3>
                  <p className="text-[13px] text-basic-6">
                    {t(
                      isMetadataEnabled
                        ? "metadataEnabledDescription"
                        : "metadataDisabledDescription",
                    )}
                  </p>
                </div>
                <Switch
                  aria-label={t("metadataSwitch")}
                  checked={isMetadataEnabled}
                  disabled={disabled}
                  onCheckedChange={setMetadataConfirm}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    dispatchMuseDAMClientAction("goto", {
                      url: "/home/dashboard/metadata",
                      target: "_blank",
                    })
                  }
                >
                  <TablePropertiesIcon className="size-4" />
                  {t("manageMetadata")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={metadataConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setMetadataConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(metadataConfirm ? "enableMetadataTitle" : "disableMetadataTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(metadataConfirm ? "enableMetadataConfirm" : "disableMetadataConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (metadataConfirm !== null) onMetadataEnabledChange(metadataConfirm);
                setMetadataConfirm(null);
              }}
            >
              {t("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
