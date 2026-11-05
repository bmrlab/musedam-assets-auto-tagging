"use client";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { MetadataResults } from "../components/MetadataResults";
import type { AssetWithAuditItemsBatch } from "./actions";
import { reviewMetadata } from "./metadata-actions";
export function MetadataInlineReview({
  rows = [],
  onSuccess,
}: {
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
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{t("title")}</h3>
      {!rows.length && <p className="text-[13px] text-basic-6">{t("empty")}</p>}
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-2">
          <MetadataResults predictions={[row.prediction]} />
          {row.status === "pending" ? (
            <div className="flex justify-end gap-2">
              <Button className="h-9" disabled={busy} onClick={() => act(row.id, "approve")}>
                {t("approve")}
              </Button>
              <Button
                className="h-9"
                variant="outline"
                disabled={busy}
                onClick={() => act(row.id, "reject")}
              >
                {t("reject")}
              </Button>
            </div>
          ) : (
            <span className="text-xs text-basic-6">{t(row.status)}</span>
          )}
        </div>
      ))}
    </section>
  );
}
