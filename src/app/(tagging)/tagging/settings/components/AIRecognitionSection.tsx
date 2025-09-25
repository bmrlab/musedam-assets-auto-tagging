import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";

interface AIRecognitionSectionProps {
  recognitionAccuracy: "precise" | "balanced" | "broad";
  onRecognitionAccuracyChange: (accuracy: "precise" | "balanced" | "broad") => void;
}

export function AIRecognitionSection({
  recognitionAccuracy,
  onRecognitionAccuracyChange,
}: AIRecognitionSectionProps) {
  const t = useTranslations("Tagging.Settings.AIRecognition");
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
      confidence: "80-100%",
      des: t("preciseDesc"),
    },
    {
      key: "balanced",
      title: t("balanced"),
      confidence: "70-100%",
      des: t("balancedDesc"),
      isRecommended: true,
    },
    {
      key: "broad",
      title: t("broad"),
      confidence: "60-100%",
      des: t("broadDesc"),
    },
  ];
  return (
    <div className="space-y-6">
      {/* AI 识别设置 */}
      <div className="bg-background border rounded-lg">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          <h3 className="font-medium text-sm">{t("title")}</h3>
          <InfoIcon className="size-4 text-basic-5" />
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {items.map((item) => {
              return (
                <div
                  key={item.key}
                  className={cn(
                    "border rounded-lg p-4 cursor-pointer transition-all relative ease-in-out duration-300",
                    recognitionAccuracy === item.key
                      ? "border-primary-6 bg-primary-1 ring-1 ring-primary-6"
                      : "border-border hover:border-primary-6",
                  )}
                  onClick={() => onRecognitionAccuracyChange(item.key)}
                >
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 ">
                      <h3 className="font-medium text-sm mb-[6px]">{item.title}</h3>
                      {item.isRecommended && <Tag variant="purple"> {t("recommended")}</Tag>}
                    </div>
                    <div className="text-xs font-medium text-primary-6 mb-1">
                      {item.confidence} {t("confidence")}
                    </div>
                    <p className="text-xs text-basic-5">{item.des}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
