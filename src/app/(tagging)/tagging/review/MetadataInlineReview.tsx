"use client";
import type { AssetWithAuditItemsBatch } from "./actions";
import { MetadataCurrentValues } from "./MetadataCurrentValues";
import { MetadataReviewSuggestions } from "./MetadataReviewSuggestions";

export function MetadataInlineReview({
  rows = [],
  assetObjectId,
  busy,
  excludedIds,
  onToggle,
}: {
  assetObjectId: number;
  rows: AssetWithAuditItemsBatch["metadataReviews"];
  busy?: boolean;
  excludedIds?: number[];
  onToggle: (id: number) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <MetadataCurrentValues
        assetObjectId={assetObjectId}
        refreshKey={rows.map((row) => `${row.id}:${row.status}`).join(",")}
      />
      <MetadataReviewSuggestions
        rows={rows}
        busy={busy}
        excludedIds={excludedIds}
        onToggle={onToggle}
      />
    </div>
  );
}
