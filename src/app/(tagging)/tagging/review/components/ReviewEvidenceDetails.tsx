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
    <dl className="flex min-w-0 flex-col text-[13px] leading-[22px]">
      <div className="flex items-start gap-3">
        <dt className="w-[52px] shrink-0 text-basic-5 dark:text-basic-6">
          {t("evidenceStrategyLabel")}
        </dt>
        <dd className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-words">
          {strategy || t("evidenceNotRecorded")}
        </dd>
      </div>
      <div className="flex items-start gap-3">
        <dt className="w-[52px] shrink-0 text-basic-5 dark:text-basic-6">
          {t("evidenceContentLabel")}
        </dt>
        <dd className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-words">
          {evidence || t("evidenceNotRecorded")}
        </dd>
      </div>
    </dl>
  );
}
