"use client";
import { Button } from "@/components/ui/button";
import { SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { MetadataPredictionRow } from "../components/MetadataResults";
import type { AssetWithAuditItemsBatch } from "./actions";
import { reviewMetadata } from "./metadata-actions";
import { MetadataCurrentValues } from "./MetadataCurrentValues";
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
      <section className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SparklesIcon className="size-4" />
          <h3 className="text-sm font-semibold">{t("aiTitle")}</h3>
          <span className="text-xs text-basic-5 dark:text-basic-6">{t("fillHint")}</span>
        </div>
        {!rows.length && <p className="text-[13px] text-basic-5 dark:text-basic-6">{t("empty")}</p>}
        {rows.map((row) => (
          <MetadataPredictionRow key={row.id} item={row.prediction}>
            {row.status === "pending" ? (
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => act(row.id, "approve")}>
                  {t("approve")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => act(row.id, "reject")}
                >
                  {t("reject")}
                </Button>
              </div>
            ) : (
              <span className="text-xs text-basic-5 dark:text-basic-6">{t(row.status)}</span>
            )}
          </MetadataPredictionRow>
        ))}
      </section>
    </div>
  );
}
