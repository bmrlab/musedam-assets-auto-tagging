"use client";

import type { FeatureEvidence as Evidence } from "@/lib/feature-decision/types";
import { useTranslations } from "next-intl";
import { ReviewEvidenceDetails } from "./ReviewEvidenceDetails";

/** Evidence comes from the saved decision, never inferred from the presence of input data. */
export function FeatureEvidence({ evidence, reason }: { evidence?: Evidence[]; reason?: string }) {
  const t = useTranslations("Tagging.Review");
  const sources = [...new Set(evidence ?? [])];
  return (
    <ReviewEvidenceDetails
      strategy={
        sources.length
          ? sources.map((source) => t(`evidenceSources.${source}`)).join(" / ")
          : undefined
      }
      evidence={reason}
    />
  );
}
