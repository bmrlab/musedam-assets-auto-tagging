"use client";

import type { FeatureEvidence as Evidence } from "@/lib/feature-decision/types";
import { useTranslations } from "next-intl";

/** Evidence comes from the saved decision, never inferred from the presence of input data. */
export function FeatureEvidence({ evidence, reason }: { evidence?: Evidence[]; reason?: string }) {
  const t = useTranslations("Tagging.Review");
  const sources = [...new Set(evidence ?? [])];
  return (
    <div className="mt-1 text-xs leading-4 text-current/75">
      <div className="flex flex-wrap items-center gap-1">
        <span>{t("recognitionEvidence")}:</span>
        {sources.length ? (
          sources.map((source) => (
            <span key={source} className="rounded border border-current/30 px-1.5 py-0.5">
              {t(`evidenceSources.${source}`)}
            </span>
          ))
        ) : (
          <span>{t("evidenceNotRecorded")}</span>
        )}
      </div>
      {reason ? (
        <p className="mt-1 whitespace-pre-wrap break-words">{reason}</p>
      ) : null}
    </div>
  );
}
