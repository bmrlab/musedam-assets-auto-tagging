import { cn } from "@/lib/utils";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";

interface TaggingModeSectionProps {
  taggingMode: "direct" | "review";
  onTaggingModeChange: (mode: "direct" | "review") => void;
}

export function TaggingModeSection({ taggingMode, onTaggingModeChange }: TaggingModeSectionProps) {
  const t = useTranslations("Tagging.Settings.TaggingMode");

  return (
    <div className="space-y-6">
      {/* 打标模式 */}
      <div className="bg-background border rounded-lg">
        <div className="px-4 py-3 border-b">
          <h3 className="font-medium text-sm">{t("title")}</h3>
        </div>
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              className={cn(
                "border rounded-lg p-6 cursor-pointer transition-all",
                taggingMode === "direct"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => onTaggingModeChange("direct")}
            >
              <div className="text-center">
                <h3 className="font-medium mb-2">{t("direct")}</h3>
                <p className="text-sm text-muted-foreground">{t("directDesc")}</p>
              </div>
            </div>

            <div
              className={cn(
                "border rounded-lg p-6 cursor-pointer transition-all",
                taggingMode === "review"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => onTaggingModeChange("review")}
            >
              <div className="text-center">
                <h3 className="font-medium mb-2">{t("review")}</h3>
                <p className="text-sm text-muted-foreground">{t("reviewDesc")}</p>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <div className="flex gap-3">
              <InfoIcon className="size-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="text-sm">
                <span className="font-medium text-blue-900 dark:text-blue-100">
                  {t("firstTimeRecommendation")}
                </span>
                <span className="text-blue-800 dark:text-blue-200 ml-1">
                  {t("firstTimeRecommendationDesc")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
