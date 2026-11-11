"use client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

export function ReviewConfidence({
  score,
  high = 80,
  medium = 70,
  level: explicitLevel,
}: {
  score: number;
  high?: number;
  medium?: number;
  level?: "high" | "medium" | "low";
}) {
  const t = useTranslations("Tagging.Metadata");
  const tr = useTranslations("Tagging.Review");
  const level = explicitLevel ?? (score >= high ? "high" : score >= medium ? "medium" : "low");
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="shrink-0 rounded-sm text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary-6"
            aria-label={`${t("confidence")}：${t(level)}`}
          >
            {t(level)}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tr(`confidenceHints.${level}`)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
