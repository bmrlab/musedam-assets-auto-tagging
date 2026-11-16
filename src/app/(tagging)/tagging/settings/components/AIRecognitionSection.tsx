import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAX_VIDEO_CREDIT_FRAMES, VIDEO_CREDIT_INTERVAL_MS } from "@/lib/tagging-credit";
import { cn } from "@/lib/utils";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";

interface AIRecognitionSectionProps {
  imageMode: boolean;
  videoImageMode: boolean;
  onVideoImageModeChange: (enabled: boolean) => void;
  onImageModeChange: (enabled: boolean) => void;
  disabled?: boolean;
  testMode?: boolean;
  recognitionAccuracy: "precise" | "balanced" | "broad";
  onRecognitionAccuracyChange: (accuracy: "precise" | "balanced" | "broad") => void;
}

function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex shrink-0 items-center rounded text-basic-5 hover:text-basic-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-6"
        >
          <InfoIcon aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="max-w-sm space-y-2 p-3 text-xs leading-5"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

export function AIRecognitionSection({
  recognitionAccuracy,
  imageMode,
  videoImageMode,
  onVideoImageModeChange,
  onImageModeChange,
  disabled,
  testMode = false,
  onRecognitionAccuracyChange,
}: AIRecognitionSectionProps) {
  const t = useTranslations("Tagging.Settings.AIRecognition");
  const tFeature = useTranslations("Tagging.FeatureDecisionDiagnostics");
  const id = useId();
  const items = [
    { key: "precise", confidence: "confidenceHigh" },
    { key: "balanced", confidence: "confidenceMedium" },
    { key: "broad", confidence: "confidenceLow" },
  ] as const;
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-medium">{t("title")}</h3>
        <InfoTip label={t("title")}>
          <p>{t("recognitionHelp")}</p>
          {testMode && <p>{t("testScope")}</p>}
        </InfoTip>
      </div>
      <div className={cn("flex flex-col gap-6 p-4", !testMode && "md:p-6")}>
        <div
          className={cn(
            "grid gap-4",
            testMode ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 md:grid-cols-3",
          )}
        >
          {items.map((item) => (
            <button
              type="button"
              key={item.key}
              disabled={disabled}
              aria-pressed={recognitionAccuracy === item.key}
              className={cn(
                "rounded-lg border p-4 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                recognitionAccuracy === item.key
                  ? "border-primary-6 bg-primary-1 ring-1 ring-primary-6"
                  : "border-basic-4 hover:border-primary-6",
              )}
              onClick={() => onRecognitionAccuracyChange(item.key)}
            >
              <span className="mb-1 flex items-center justify-center gap-2 text-sm font-medium">
                {t(item.key)}
                {item.key === "balanced" && !testMode && (
                  <Tag variant="purple">{t("recommended")}</Tag>
                )}
              </span>
              <span className="block text-xs font-medium text-primary-6">{t(item.confidence)}</span>
              {!testMode && (
                <span className="mt-1 block text-xs text-basic-5 dark:text-basic-6">
                  {t(`${item.key}Desc`)}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-4 rounded-lg border border-basic-4 p-4">
          <h4 className="text-sm font-medium leading-[22px] text-basic-9">
            {tFeature("imageMode")}
          </h4>
          {(
            [
              {
                key: "image",
                label: "imageModeImages",
                hint: "imageModeImageDescription",
                checked: imageMode,
                change: onImageModeChange,
              },
              {
                key: "video",
                label: "imageModeVideos",
                hint: "imageModeVideoDescription",
                checked: videoImageMode,
                change: onVideoImageModeChange,
              },
            ] as const
          ).map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor={`${id}-${item.key}`}
                    className="cursor-pointer text-sm leading-[22px] text-basic-9"
                  >
                    {t(item.label)}
                  </label>
                  <InfoTip label={t(item.label)}>
                    <p>{t(item.key === "video" ? "videoModeHelp" : "imageModeHelp")}</p>
                    {item.key === "video" && <p>{t("imageModeVideoSampling")}</p>}
                    <p>{t("fallbackHelp")}</p>
                    {testMode ? (
                      <p>{t("testScope")}</p>
                    ) : (
                      item.key === "video" && (
                        <p>
                          {t("imageModeVideoBilling", {
                            seconds: VIDEO_CREDIT_INTERVAL_MS / 1000,
                            maxFrames: MAX_VIDEO_CREDIT_FRAMES,
                          })}
                        </p>
                      )
                    )}
                  </InfoTip>
                </div>
                {!testMode && (
                  <p
                    id={`${id}-${item.key}-help`}
                    className="mt-1 text-xs leading-4 text-basic-5 dark:text-basic-6"
                  >
                    {t(item.hint)}
                  </p>
                )}
              </div>
              <Switch
                id={`${id}-${item.key}`}
                aria-describedby={testMode ? `${id}-scope` : `${id}-${item.key}-help`}
                checked={item.checked}
                onCheckedChange={item.change}
                disabled={disabled}
                className="shrink-0"
              />
            </div>
          ))}
          {testMode && (
            <p id={`${id}-scope`} className="text-xs leading-4 text-basic-5 dark:text-basic-6">
              {t("testScope")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
