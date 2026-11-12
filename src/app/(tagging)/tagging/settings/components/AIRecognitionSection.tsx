import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import { MAX_VIDEO_CREDIT_FRAMES, VIDEO_CREDIT_INTERVAL_MS } from "@/lib/tagging-credit";
import { cn } from "@/lib/utils";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";

interface AIRecognitionSectionProps {
  imageMode: boolean;
  videoImageMode: boolean;
  onVideoImageModeChange: (enabled: boolean) => void;
  onImageModeChange: (enabled: boolean) => void;
  disabled?: boolean;
  recognitionAccuracy: "precise" | "balanced" | "broad";
  onRecognitionAccuracyChange: (accuracy: "precise" | "balanced" | "broad") => void;
}

export function AIRecognitionSection({
  recognitionAccuracy,
  imageMode,
  videoImageMode,
  onVideoImageModeChange,
  onImageModeChange,
  disabled,
  onRecognitionAccuracyChange,
}: AIRecognitionSectionProps) {
  const t = useTranslations("Tagging.Settings.AIRecognition");
  const tFeature = useTranslations("Tagging.FeatureDecisionDiagnostics");
  const items: {
    key: "precise" | "balanced" | "broad";
    title: string;
    confidence: string;
    des: string;
    isRecommended?: boolean;
  }[] = [
    {
      key: "precise",
      title: t("precise"),
      confidence: t("confidenceHigh"),
      des: t("preciseDesc"),
    },
    {
      key: "balanced",
      title: t("balanced"),
      confidence: t("confidenceMedium"),
      des: t("balancedDesc"),
      isRecommended: true,
    },
    {
      key: "broad",
      title: t("broad"),
      confidence: t("confidenceLow"),
      des: t("broadDesc"),
    },
  ];
  return (
    <div className="space-y-6">
      {/* AI 识别设置 */}
      <div className="bg-background border rounded-[6px]">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <h3 className="font-medium text-sm">{t("title")}</h3>
          <InfoIcon className="size-4 text-basic-5" />
        </div>
        <div className="p-4 md:p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {items.map((item) => {
              return (
                <div
                  key={item.key}
                  className={cn(
                    "border rounded-lg p-4 cursor-pointer transition-all relative ease-in-out duration-300",
                    recognitionAccuracy === item.key
                      ? "border-primary-6 bg-primary-1 ring-1 ring-primary-6"
                      : "border-basic-4 hover:border-primary-6",
                  )}
                  onClick={() => onRecognitionAccuracyChange(item.key)}
                >
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-[6px]">
                      <h3 className="font-medium text-sm">{item.title}</h3>
                      {item.isRecommended && <Tag variant="purple"> {t("recommended")}</Tag>}
                    </div>
                    <div className="text-xs font-medium text-primary-6 mb-1">{item.confidence}</div>
                    <p className="text-xs text-basic-5">{item.des}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 flex flex-col gap-4 rounded-lg border border-basic-4 p-4">
            <h4 className="text-sm font-medium leading-[22px] text-basic-9">
              {tFeature("imageMode")}
            </h4>
            {(
              [
                {
                  id: "team-feature-image-mode",
                  label: "imageModeImages",
                  hint: imageMode ? "imageModeImageOn" : "imageModeImageOff",
                  billing: false,
                  checked: imageMode,
                  change: onImageModeChange,
                },
                {
                  id: "team-feature-video-image-mode",
                  label: "imageModeVideos",
                  hint: videoImageMode ? "imageModeVideoOn" : "imageModeVideoOff",
                  billing: true,
                  checked: videoImageMode,
                  change: onVideoImageModeChange,
                },
              ] as const
            ).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={item.id}
                    className="cursor-pointer text-sm leading-[22px] text-basic-9"
                  >
                    {t(item.label)}
                  </label>
                  <p id={`${item.id}-help`} className="mt-1 text-xs leading-4 text-basic-5">
                    {t(item.hint)}
                  </p>
                  {item.billing && (
                    <p id={`${item.id}-billing`} className="mt-1 text-xs leading-4 text-basic-5">
                      {t("imageModeVideoBilling", {
                        seconds: VIDEO_CREDIT_INTERVAL_MS / 1000,
                        maxFrames: MAX_VIDEO_CREDIT_FRAMES,
                      })}
                    </p>
                  )}
                </div>
                <Switch
                  id={item.id}
                  className="shrink-0"
                  aria-describedby={`${item.id}-help${item.billing ? ` ${item.id}-billing` : ""}`}
                  checked={item.checked}
                  onCheckedChange={item.change}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
