import { Checkbox } from "@/components/ui/checkbox";
import { useTranslations } from "next-intl";

interface MatchingSources {
  basicInfo: boolean;
  materializedPath: boolean;
  contentAnalysis: boolean;
  tagKeywords: boolean;
}

interface MatchingStrategySectionProps {
  matchingSources: MatchingSources;
  onSourceChange: (source: keyof MatchingSources, checked: boolean) => void;
}

export function MatchingStrategySection({
  matchingSources,
  onSourceChange,
}: MatchingStrategySectionProps) {
  const t = useTranslations("Tagging.Settings.MatchingStrategy");

  return (
    <div className="space-y-6">
      {/* 匹配策略选择 */}
      <div className="bg-background border rounded-lg">
        <div className="px-4 py-3 border-b">
          <h3 className="font-medium text-sm">{t("title")}</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start space-x-3 p-3 border rounded-lg">
              <Checkbox
                checked={matchingSources.materializedPath}
                onCheckedChange={(checked) =>
                  onSourceChange("materializedPath", checked as boolean)
                }
                className="mt-0.5"
              />
              <div>
                <h3 className="font-medium">{t("filePathMatching")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("filePathMatchingDesc")}
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-3 border rounded-lg">
              <Checkbox
                checked={matchingSources.basicInfo}
                onCheckedChange={(checked) => onSourceChange("basicInfo", checked as boolean)}
                className="mt-0.5"
              />
              <div>
                <h3 className="font-medium">{t("assetNameMatching")}</h3>
                <p className="text-sm text-muted-foreground">{t("assetNameMatchingDesc")}</p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-3 border rounded-lg">
              <Checkbox
                checked={matchingSources.contentAnalysis}
                onCheckedChange={(checked) => onSourceChange("contentAnalysis", checked as boolean)}
                className="mt-0.5"
              />
              <div>
                <h3 className="font-medium">{t("aiGenerated")}</h3>
                <p className="text-sm text-muted-foreground">{t("aiGeneratedDesc")}</p>
              </div>
            </div>

            <div className="flex items-start space-x-3 p-3 border rounded-lg">
              <Checkbox
                checked={matchingSources.tagKeywords}
                onCheckedChange={(checked) => onSourceChange("tagKeywords", checked as boolean)}
                className="mt-0.5"
              />
              <div>
                <h3 className="font-medium">{t("existingTags")}</h3>
                <p className="text-sm text-muted-foreground">{t("existingTagsDesc")}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
