"use client";
import { Button } from "@/components/ui/button";
import { metadataDisplayValues } from "@/lib/metadata/display";
import { TablePropertiesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { fetchReviewMetadataValues } from "./metadata-actions";

export function MetadataCurrentValues({
  assetObjectId,
  refreshKey = "",
}: {
  assetObjectId: number;
  refreshKey?: string;
}) {
  const t = useTranslations("Tagging.Metadata");
  const [values, setValues] = useState<Record<string, unknown>>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setValues(undefined);
    setFailed(false);
    fetchReviewMetadataValues(assetObjectId)
      .then((result) => {
        if (alive) setValues(result);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [assetObjectId, refreshKey, retry]);
  const rows = metadataDisplayValues(values);
  const display = (value: unknown): string =>
    typeof value === "boolean"
      ? t(value ? "checked" : "unchecked")
      : Array.isArray(value)
        ? value.map(display).join(" / ")
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg border bg-background p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <TablePropertiesIcon className="size-4" />
        {t("title")}
      </h3>
      {failed ? (
        <div role="alert" className="text-[13px] text-basic-5 dark:text-basic-6">
          {t("loadFailed")}
          <Button variant="link" onClick={() => setRetry(retry + 1)}>
            {t("retry")}
          </Button>
        </div>
      ) : values === undefined ? (
        <p role="status" className="text-[13px] text-basic-5 dark:text-basic-6">
          {t("loading")}
        </p>
      ) : rows.length ? (
        <div className="flex flex-wrap gap-2">
          {rows.map((row) => (
            <span
              key={row.name}
              className="max-w-full break-words rounded border bg-background px-2 py-1 text-[13px] leading-[18px]"
            >
              {row.name}：{display(row.value)}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-basic-5 dark:text-basic-6">{t("currentEmpty")}</p>
      )}
    </section>
  );
}
