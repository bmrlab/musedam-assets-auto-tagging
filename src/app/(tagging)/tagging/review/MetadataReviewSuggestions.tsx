"use client";
import { Button } from "@/components/ui/button";
import { ClockCircleIcon, TagAIIcon } from "@/components/ui/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { MetadataPrediction } from "@/lib/metadata/types";
import { cn } from "@/lib/utils";
import { CheckIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ReviewConfidence } from "./components/ReviewConfidence";
import { ReviewEvidenceDropdown } from "./components/ReviewEvidenceDropdown";
export type MetadataSuggestion = {
  id: number;
  status: string;
  prediction: MetadataPrediction;
  available?: boolean;
};
export function MetadataReviewSuggestions({
  rows,
  createdAt,
  busy,
  excludedIds = [],
  onToggle,
}: {
  rows: MetadataSuggestion[];
  createdAt?: Date | string;
  busy?: boolean;
  excludedIds?: number[];
  onToggle: (id: number) => void;
}) {
  const t = useTranslations("Tagging.Metadata");
  const locale = useLocale();
  const tr = useTranslations("Tagging.Review");
  const sources = {
    basicInfo: "sourceBasicInfo",
    materializedPath: "sourceMaterializedPath",
    contentAnalysis: "sourceContentAnalysis",
  } as const;
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3 rounded-md bg-basic-1/80 p-4 dark:bg-basic-1 text-sm leading-[22px]">
      <div className="flex flex-wrap items-center gap-2">
        <TagAIIcon className="size-4 shrink-0" />
        <h3 className="font-medium">{t("aiTitle")}</h3>
        <span className="text-xs text-basic-5 dark:text-basic-6">{t("fillHint")}</span>
        {createdAt && (
          <time
            dateTime={new Date(createdAt).toISOString()}
            className="ml-auto flex items-center gap-1 text-xs text-basic-5 dark:text-basic-6"
          >
            <ClockCircleIcon className="size-4" />
            {new Intl.DateTimeFormat(locale, {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }).format(new Date(createdAt))}
          </time>
        )}
      </div>
      {!rows.length && <p className="text-[13px] text-basic-5 dark:text-basic-6">{t("empty")}</p>}
      <TooltipProvider>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {rows.map(({ id, status, prediction: item, available = true }) => {
            const excluded = excludedIds.includes(id);
            const tone = excluded
              ? "border-dashed border-basic-4 bg-basic-2 text-basic-5 dark:text-basic-6"
              : item.score >= 80
                ? "border-primary-3 bg-primary-1 text-primary-6 dark:border-primary-8/60 dark:bg-primary-6/15 dark:text-primary-8"
                : item.score >= 70
                  ? "border-success-3 bg-success-1 text-success-7 dark:border-success-5/60 dark:bg-success-6/10 dark:text-success-5"
                  : "border-warning-3 bg-warning-1 text-warning-7 dark:border-warning-5/60 dark:bg-warning-6/10 dark:text-warning-5";
            const label = `${item.fieldName}：${item.checked === undefined ? item.labels.join("、") : t(item.checked ? "checked" : "unchecked")}`;
            return (
              <div
                key={id}
                className={cn(
                  "group flex min-w-0 items-center gap-2 rounded-md border p-3",
                  tone,
                  !available && status === "pending" && "opacity-50",
                )}
              >
                <span className="min-w-0 flex-1 break-words text-[13px] leading-[22px]">
                  {label}
                </span>
                <span
                  role="meter"
                  aria-label={t("confidence")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(item.score)}
                  className="flex w-12 shrink-0 overflow-hidden rounded-full bg-current/20"
                >
                  <span
                    className="h-1 bg-current"
                    style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }}
                  />
                </span>
                <ReviewConfidence score={item.score} />
                <ReviewEvidenceDropdown name={label}>
                  {item.sources.length ? (
                    item.sources.map((source, i) => (
                      <div key={i} className="flex min-w-0 flex-col gap-1">
                        <span className="text-xs text-basic-5 dark:text-basic-6">
                          {t(sources[source.source])}
                        </span>
                        <p className="whitespace-pre-wrap break-words">
                          {source.evidence || tr("evidenceNotRecorded")}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p>{tr("evidenceNotRecorded")}</p>
                  )}
                  {!available && status === "pending" && <p>{t("unavailable")}</p>}
                </ReviewEvidenceDropdown>
                {status === "pending" ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5 shrink-0 bg-transparent text-basic-5 hover:bg-transparent hover:text-current focus-visible:ring-2 focus-visible:ring-primary-6 dark:text-basic-6"
                        disabled={busy || (excluded && !available)}
                        aria-label={`${tr(excluded ? "tooltipAdd" : "tooltipRemove")} ${item.fieldName}`}
                        onClick={() => onToggle(id)}
                      >
                        {excluded ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{tr(excluded ? "tooltipAdd" : "tooltipRemove")}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span className="text-xs text-basic-5 dark:text-basic-6">
                    {t(status === "approved" ? "approved" : "rejected")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </TooltipProvider>
    </section>
  );
}
