"use client";

import { useTranslations } from "next-intl";

export function MatchedKeywordsBadge({ keywords }: { keywords?: string[] }) {
  const t = useTranslations("Tagging.Review");
  if (!keywords?.length) return null;
  const label = t("matchedKeywordsBadge", { keywords: keywords.join("、") });
  return (
    <span title={label} className="inline-flex max-w-full rounded px-1 text-xs leading-4 border border-current/40 bg-background/60">
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
