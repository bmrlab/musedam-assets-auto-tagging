"use client";
import type { MetadataPrediction } from "@/lib/metadata/types";
import { useTranslations } from "next-intl";

export function MetadataResults({
  predictions = [],
  testResult = false,
}: {
  predictions?: MetadataPrediction[];
  testResult?: boolean;
}) {
  const t = useTranslations("Tagging.Metadata");

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      {!predictions.length && <p className="text-[13px] text-basic-6">{t("empty")}</p>}
      {predictions.map((raw, index) => {
        const item = testResult ? { ...raw, effective: raw.effective && raw.score >= 80 } : raw;
        return (
          <div key={`${item.fieldId}:${index}`} className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{item.fieldName}</span>
              <span>
                {item.checked === undefined
                  ? item.labels.join(" / ")
                  : t(item.checked ? "checked" : "unchecked")}
              </span>
              <span
                className={
                  item.effective
                    ? "rounded bg-[#F2F6FF] px-2 text-xs text-[#3366FF] dark:bg-[rgba(51,102,255,0.15)]"
                    : "rounded bg-[#FFFDF2] px-2 text-xs text-[#DB8B00] dark:bg-[#434343]"
                }
              >
                {t(item.effective ? "effective" : "candidate")}
              </span>
              <span className="text-xs text-basic-6">
                {t(item.score >= 80 ? "high" : item.score >= 60 ? "medium" : "low")}
              </span>
            </div>
            <details className="text-[13px] text-basic-6">
              <summary className="cursor-pointer font-medium">{t("evidence")}</summary>
              <div className="flex flex-col gap-2 py-2">
                {item.sources.map((source, index) => (
                  <p key={`${source.source}:${index}`} className="break-words">
                    {t(
                      (
                        {
                          basicInfo: "sourceBasicInfo",
                          materializedPath: "sourceMaterializedPath",
                          contentAnalysis: "sourceContentAnalysis",
                        } as const
                      )[source.source],
                    )}
                    : {source.evidence}
                  </p>
                ))}
              </div>
            </details>
          </div>
        );
      })}
    </section>
  );
}
