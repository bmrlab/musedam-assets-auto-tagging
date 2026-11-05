"use client";
import type { MetadataPrediction } from "@/lib/metadata/types";
import { CheckIcon, TablePropertiesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function MetadataPredictionRow({
  item,
  children,
}: {
  item: MetadataPrediction;
  children?: ReactNode;
}) {
  const t = useTranslations("Tagging.Metadata");
  const sourceKeys = {
    basicInfo: "sourceBasicInfo",
    materializedPath: "sourceMaterializedPath",
    contentAnalysis: "sourceContentAnalysis",
  } as const;
  return (
    <div
      className={`flex flex-col gap-2 rounded-md border p-3 text-sm leading-[22px] ${item.effective ? "border-primary-2 bg-primary-1/50 dark:border-primary-6/40 dark:bg-primary-6/10" : "border-warning-3 bg-warning-1/50 dark:border-warning-6/40 dark:bg-warning-6/10"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CheckIcon
          className={`size-4 shrink-0 ${item.effective ? "text-primary-6" : "text-warning-7"}`}
        />
        <span className="min-w-0 flex-1 break-words font-medium">
          {item.fieldName}：
          {item.checked === undefined
            ? item.labels.join(" / ")
            : t(item.checked ? "checked" : "unchecked")}
        </span>
        <span className="text-xs text-basic-5 dark:text-basic-6">
          {t("confidence")}：{t(item.score >= 80 ? "high" : item.score >= 60 ? "medium" : "low")} ·{" "}
          {Math.round(item.score)}%
        </span>
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-basic-5 dark:text-basic-6">
        <span>
          {[...new Set(item.sources.map((source) => t(sourceKeys[source.source])))].join(" / ")}
        </span>
        <span>· {t(item.effective ? "effective" : "candidate")}</span>
      </div>
      <details className="text-[13px] leading-[18px] text-basic-5 dark:text-basic-6">
        <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-6">
          {t("evidence")}
        </summary>
        <div className="flex flex-col gap-2 pt-2">
          {item.sources.map((source, index) => (
            <p key={`${source.source}:${index}`} className="break-words">
              {t(sourceKeys[source.source])}: {source.evidence}
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}

export function MetadataResults({
  predictions = [],
  testResult = false,
}: {
  predictions?: MetadataPrediction[];
  testResult?: boolean;
}) {
  const t = useTranslations("Tagging.Metadata");
  const displayed = testResult ? predictions.filter((item) => item.score >= 60) : predictions;
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-background p-4 text-basic-8 dark:text-[#FAFAFA]">
      <div className="flex flex-wrap items-center gap-2">
        <TablePropertiesIcon className="size-4" />
        <h3 className="text-sm font-semibold">
          {t("title")} ({displayed.length})
        </h3>
        {testResult && (
          <p className="text-[13px] leading-[18px] text-basic-5 dark:text-basic-6">
            {t("testHint")}
          </p>
        )}
      </div>
      {!displayed.length && (
        <p className="text-[13px] text-basic-5 dark:text-basic-6">{t("empty")}</p>
      )}
      {displayed.map((raw, index) => (
        <MetadataPredictionRow
          key={`${raw.fieldId}:${index}`}
          item={testResult ? { ...raw, effective: raw.effective && raw.score >= 80 } : raw}
        />
      ))}
    </section>
  );
}
