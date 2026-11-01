import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SOURCE_WEIGHT_MAX, SOURCE_WEIGHT_MIN, SourceWeights } from "@/app/(tagging)/types";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

interface MatchingSources {
  basicInfo: boolean;
  materializedPath: boolean;
  contentAnalysis: boolean;
  tagKeywords: boolean;
}

interface MatchingStrategySectionProps {
  matchingSources: MatchingSources;
  sourceWeights: SourceWeights;
  onSourceChange: (source: keyof MatchingSources, checked: boolean) => void;
  onWeightChange: (source: keyof SourceWeights, weight: number) => void;
}

function WeightInput({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (weight: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  // 失焦或回车时才提交：超出范围的值截断到边界，非法输入回退到当前值，保留一位小数
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next =
      Math.round(Math.min(SOURCE_WEIGHT_MAX, Math.max(SOURCE_WEIGHT_MIN, parsed)) * 10) / 10;
    setDraft(String(next));
    if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <Input
      type="number"
      inputMode="decimal"
      min={SOURCE_WEIGHT_MIN}
      max={SOURCE_WEIGHT_MAX}
      step={0.1}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
      className="h-7 w-20 text-sm"
    />
  );
}

export function MatchingStrategySection({
  matchingSources,
  sourceWeights,
  onSourceChange,
  onWeightChange,
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
      <div className="bg-background border rounded-[6px]">
        <div className="px-4 py-3 border-b">
          <h3 className="font-medium text-base">{t("title")}</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sections.map(({ key, title, desc }) => {
              return <div className="flex items-start space-x-2 p-4 border rounded-lg border-basic-4" key={key}>
                <Checkbox
                  checked={matchingSources[key]}
                  onCheckedChange={(checked) => onSourceChange(key, checked as boolean)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <h3 className="font-medium text-sm leading-[22px] mb-1">{title}</h3>
                  <p className="text-xs text-basic-5">{desc}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-xs text-basic-5">{t("weight")}</span>
                    <WeightInput
                      value={sourceWeights[key]}
                      disabled={!matchingSources[key]}
                      onCommit={(weight) => onWeightChange(key, weight)}
                    />
                  </div>
                </div>
              </div>
            })}
          </div>
          <p className="text-xs text-basic-5 mt-4">
            {t("weightHint", { min: SOURCE_WEIGHT_MIN, max: SOURCE_WEIGHT_MAX })}
          </p>
        </div>
      </div>
    </div>
  );
}
