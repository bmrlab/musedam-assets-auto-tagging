"use client";
import { Button } from "@/components/ui/button";
import { ClockCircleIcon, TagAIIcon } from "@/components/ui/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { MetadataPrediction } from "@/lib/metadata/types";
import { CheckIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
  onReview,
}: {
  rows: MetadataSuggestion[];
  createdAt?: Date | string;
  busy?: boolean;
  onReview: (ids: number[], action: "approve" | "reject") => void;
}) {
  const t = useTranslations("Tagging.Metadata");
  const locale = useLocale();
  const sources = {
    basicInfo: "sourceBasicInfo",
    materializedPath: "sourceMaterializedPath",
    contentAnalysis: "sourceContentAnalysis",
  } as const;
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg bg-basic-1 p-4 text-sm leading-[22px]">
      <div className="flex flex-wrap items-center gap-2">
        <TagAIIcon className="size-4 shrink-0" />
        <h3 className="font-medium">{t("aiTitle")}</h3>
        <span className="text-xs text-basic-5 dark:text-basic-6">{t("emptyFieldsHint")}</span>
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
        <div className="flex flex-wrap items-start gap-2">
          {rows.map(({ id, status, prediction: item, available = true }) => {
            const tone =
              item.score >= 80
                ? "border-primary-6 text-primary-6 dark:border-primary-8/60 dark:text-primary-8"
                : item.score >= 60
                  ? "border-success-7 text-success-7 dark:text-success-5"
                  : "border-warning-7 text-warning-7 dark:text-warning-5";
            const label = `${item.fieldName}：${item.checked === undefined ? item.labels.join("、") : t(item.checked ? "checked" : "unchecked")}`;
            return (
              <div
                key={id}
                className={`group flex max-w-full items-center gap-2 rounded-md border border-dashed px-2 py-1 ${tone} ${!available && status === "pending" ? "opacity-50" : ""}`}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="flex min-w-0 flex-wrap items-center gap-2 text-left text-[13px] leading-[22px] outline-none focus-visible:ring-2 focus-visible:ring-primary-6"
                      aria-label={`${label} · ${t("confidence")} ${Math.round(item.score)}%`}
                    >
                      <span className="break-words">{label}</span>
                      <span
                        role="meter"
                        aria-label={t("confidence")}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(item.score)}
                        className="flex w-12 shrink-0 overflow-hidden rounded-full bg-basic-3 dark:bg-basic-4"
                      >
                        <span
                          className="h-[3px] bg-current"
                          style={{ width: `${Math.max(0, Math.min(100, item.score))}%` }}
                        />
                      </span>
                      <span className="text-xs">
                        {t(item.score >= 80 ? "high" : item.score >= 60 ? "medium" : "low")}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80 text-xs leading-5">
                    <p>
                      {t("confidence")}：{Math.round(item.score)}%
                    </p>
                    {item.sources.map((source, i) => (
                      <p key={i}>
                        {t(sources[source.source])}：{source.evidence}
                      </p>
                    ))}
                    {!available && status === "pending" && <p>{t("unavailable")}</p>}
                  </TooltipContent>
                </Tooltip>
                {status === "pending" ? (
                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 text-basic-5 hover:text-primary-6 dark:text-basic-6"
                      disabled={busy || !available}
                      aria-label={`${t("approve")} ${item.fieldName}`}
                      onClick={() => onReview([id], "approve")}
                    >
                      <CheckIcon className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-0 p-0 text-basic-5 opacity-0 transition-[width,opacity] hover:text-danger-6 group-hover:w-5 group-hover:opacity-100 focus-visible:w-5 focus-visible:opacity-100 dark:text-basic-6"
                      disabled={busy}
                      aria-label={`${t("reject")} ${item.fieldName}`}
                      onClick={() => onReview([id], "reject")}
                    >
                      <XIcon className="size-3" />
                    </Button>
                  </div>
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
