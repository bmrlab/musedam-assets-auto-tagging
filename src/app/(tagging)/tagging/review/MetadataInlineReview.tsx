"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import type { AssetWithAuditItemsBatch } from "./actions";
import { reviewMetadata } from "./metadata-actions";
import { MetadataCurrentValues } from "./MetadataCurrentValues";
import { MetadataReviewSuggestions } from "./MetadataReviewSuggestions";
export function MetadataInlineReview({
  rows = [],
  assetObjectId,
  onSuccess,
}: {
  assetObjectId: number;
  rows: AssetWithAuditItemsBatch["metadataReviews"];
  onSuccess?: () => void;
}) {
  const t = useTranslations("Tagging.Metadata");
  const [busy, setBusy] = useState(false);
  const act = async (id: number, action: "approve" | "reject") => {
    setBusy(true);
    try {
      const result = await reviewMetadata([id], action);
      if (result.skipped) toast.message(t("manualKept"));
      if (result.applied) toast.success(t("appliedCount", { count: result.applied }));
      onSuccess?.();
    } catch {
      toast.error(t("reviewFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <MetadataCurrentValues
        assetObjectId={assetObjectId}
        refreshKey={rows.map((row) => `${row.id}:${row.status}`).join(",")}
      />
      <MetadataReviewSuggestions
        rows={rows}
        busy={busy}
        onReview={(ids, action) => act(ids[0], action)}
      />
    </div>
  );
}
