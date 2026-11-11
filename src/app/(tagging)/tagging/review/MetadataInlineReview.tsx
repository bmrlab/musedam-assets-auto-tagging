"use client";
import type { AssetWithAuditItemsBatch } from "./actions";
import { MetadataReviewSuggestions } from "./MetadataReviewSuggestions";

export function MetadataInlineReview({
  rows = [],
  busy,
  excludedIds,
  onToggle,
}: {
  rows: AssetWithAuditItemsBatch["metadataReviews"];
  busy?: boolean;
  excludedIds?: number[];
  onToggle: (id: number) => void;
}) {
  return (
    <MetadataReviewSuggestions
      rows={rows}
      busy={busy}
      excludedIds={excludedIds}
      onToggle={onToggle}
    />
  );
}
