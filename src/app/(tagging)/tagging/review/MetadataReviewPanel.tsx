"use client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MetadataResults } from "../components/MetadataResults";
import { fetchMetadataReviews, reviewMetadata } from "./metadata-actions";
import { MetadataCurrentValues } from "./MetadataCurrentValues";

type Status = "pending" | "approved" | "rejected";
type Data = Awaited<ReturnType<typeof fetchMetadataReviews>>;
export function MetadataReviewPanel() {
  const t = useTranslations("Tagging.Metadata");
  const [data, setData] = useState<Data>();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<Status>("pending");
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const load = async () => {
    setBusy(true);
    setError(false);
    try {
      setData(await fetchMetadataReviews(page, status));
      setSelected([]);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError(false);
    setSelected([]);
    fetchMetadataReviews(page, status)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [page, status]);
  const act = async (ids: number[], action: "approve" | "reject") => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await reviewMetadata(ids, action);
      if (result.skipped) toast.message(t("manualKept"));
      if (result.applied) toast.success(t("appliedCount", { count: result.applied }));
      await load();
    } catch {
      toast.error(t("reviewFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value as Status);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-40" aria-label={t("title")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["pending", "approved", "rejected"] as const).map((s) => (
              <SelectItem key={s} value={s}>
                {t(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {status === "pending" && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label={t("selectAll")}
                checked={!!data?.rows.length && selected.length === data.rows.length}
                onCheckedChange={(checked) =>
                  setSelected(checked ? data?.rows.map((r) => r.id) || [] : [])
                }
              />
              {t("selectAll")}
            </label>
            <Button
              disabled={
                busy ||
                !selected.length ||
                selected.some((id) => !data?.rows.find((row) => row.id === id)?.available)
              }
              onClick={() => act(selected, "approve")}
            >
              {t("approve")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !selected.length}
              onClick={() => act(selected, "reject")}
            >
              {t("reject")}
            </Button>
          </>
        )}
      </div>
      {error ? (
        <div role="alert" className="p-4 text-sm">
          {t("loadFailed")}
          <Button variant="link" onClick={load}>
            {t("retry")}
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          {!busy && !data?.rows.length && <p className="p-4 text-sm text-basic-5 dark:text-basic-6">{t("empty")}</p>}
          {data?.rows.map((row) => (
            <article
              key={row.id}
              className="flex flex-col gap-3 rounded-lg border bg-background p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <label className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  {status === "pending" && (
                    <Checkbox
                      aria-label={row.name}
                      checked={selected.includes(row.id)}
                      onCheckedChange={(checked) =>
                        setSelected((previous) =>
                          checked ? [...previous, row.id] : previous.filter((id) => id !== row.id),
                        )
                      }
                    />
                  )}
                  <span className="truncate">{row.name}</span>
                </label>
                {status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      className="h-9"
                      disabled={busy || !row.available}
                      onClick={() => act([row.id], "approve")}
                    >
                      {t("approve")}
                    </Button>
                    <Button
                      className="h-9"
                      variant="outline"
                      disabled={busy}
                      onClick={() => act([row.id], "reject")}
                    >
                      {t("reject")}
                    </Button>
                  </div>
                )}
              </div>
              {!row.available && status === "pending" && (
                <p className="text-[13px] text-basic-5 dark:text-basic-6">{t("unavailable")}</p>
              )}
              <div className="flex flex-col gap-4 lg:flex-row">
                <MetadataCurrentValues assetObjectId={row.assetObjectId} refreshKey={status} />
                <div className="min-w-0 flex-1">
                  <MetadataResults predictions={[row.prediction]} />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="flex items-center justify-end gap-3 py-3">
        <Button variant="outline" disabled={busy || page === 1} onClick={() => setPage(page - 1)}>
          {t("previous")}
        </Button>
        <span className="text-sm">
          {page} / {Math.max(1, Math.ceil((data?.total || 0) / 20))}
        </span>
        <Button
          variant="outline"
          disabled={busy || page * 20 >= (data?.total || 0)}
          onClick={() => setPage(page + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
