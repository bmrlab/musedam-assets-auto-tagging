import { cn } from "@/lib/utils";
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
          <h3 className="font-medium text-base">{t("title")}</h3>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              className={cn(
                "border rounded-lg p-4 cursor-pointer transition-all text-sm ",
                taggingMode === "direct"
                  ? "border-primary-6 bg-primary-1 ring-1 ring-primary-6"
                  : "border-basic-4 hover:border-primary-6",
              )}
              onClick={() => onTaggingModeChange("direct")}
            >
              <div className="text-center">
                <h3 className="font-medium mb-2">{t("direct")}</h3>
                <p className="text-xs text-basic-5">{t("directDesc")}</p>
              </div>
            </div>

            <div
              className={cn(
                "border rounded-lg p-4 cursor-pointer transition-all text-sm",
                taggingMode === "review"
                  ? "border-primary-6 bg-primary-1 ring-1 ring-primary-6"
                  : "border-basic-4 hover:border-primary-6",
              )}
              onClick={() => onTaggingModeChange("review")}
            >
              <div className="text-center">
                <h3 className="font-medium mb-2">{t("review")}</h3>
                <p className="text-basic-5 text-xs">{t("reviewDesc")}</p>
              </div>
            </div>
          </div>

          <div className="bg-primary-1 border border-primary-5 rounded-lg px-3 py-[14px]">
            <div className="flex gap-3 text-[13px]">
              <span className="font-medium ">{t("firstTimeRecommendation")}</span>
              <span className="ml-1">{t("firstTimeRecommendationDesc")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
