"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export function ReviewEvidenceDetails({
  strategy,
  evidence,
}: {
  strategy?: ReactNode;
  evidence?: ReactNode;
}) {
  const t = useTranslations("Tagging.Review");
  return (
    <dl className="flex min-w-0 flex-col gap-1 text-[13px] leading-[22px]">
      <div className="flex items-start gap-2">
        <dt className="w-14 shrink-0 text-basic-5 dark:text-basic-6">
          {t("evidenceStrategyLabel")}
        </dt>
        <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          {strategy || t("evidenceNotRecorded")}
        </dd>
      </div>
      <div className="flex items-start gap-2">
        <dt className="w-14 shrink-0 text-basic-5 dark:text-basic-6">
          {t("evidenceContentLabel")}
        </dt>
        <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words">
          {evidence || t("evidenceNotRecorded")}
        </dd>
      </div>
    </dl>
  );
}
