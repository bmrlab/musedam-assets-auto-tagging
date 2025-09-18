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

  const sections: {
    key: keyof MatchingSources;
    title: string;
    desc: string;
  }[] = [
      {
        key: "materializedPath",
        title: t("filePathMatching"),
        desc: t("filePathMatchingDesc")
      },
      {
        key: "basicInfo",
        title: t("assetNameMatching"),
        desc: t("assetNameMatchingDesc")
      },
      {
        key: "contentAnalysis",
        title: t("aiGenerated"),
        desc: t("aiGeneratedDesc")
      },
      {
        key: "tagKeywords",
        title: t("existingTags"),
        desc: t("existingTagsDesc")
      }
    ]
  return (
    <div className="space-y-6">
      {/* 匹配策略选择 */}
      <div className="bg-background border rounded-lg">
        <div className="px-4 py-3 border-b">
          <h3 className="font-medium text-base">{t("title")}</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sections.map(({ key, title, desc }) => {
              return <div className="flex items-start space-x-2 p-4 border rounded-lg bg-basic-1" key={key}>
                <Checkbox
                  checked={matchingSources[key]}
                  onCheckedChange={(checked) => onSourceChange(key, checked as boolean)}
                  className="mt-0.5"
                />
                <div>
                  <h3 className="font-medium text-sm leading-[22px] mb-1">{title}</h3>
                  <p className="text-xs text-basic-5">{desc}</p>
                </div>
              </div>
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
