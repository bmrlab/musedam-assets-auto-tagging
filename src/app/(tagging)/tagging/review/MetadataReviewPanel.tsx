"use client";
import { AssetThumbnail } from "@/components/AssetThumbnail";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatSize } from "@/lib/utils";
import type { AssetObjectExtra } from "@/prisma/client";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchMetadataReviewAssets, reviewMetadata } from "./metadata-actions";
import { defaultMetadataReviewFilters, type MetadataReviewFilters } from "./metadata-review-query";
import { applyMetadataReviewSelection } from "./metadata-review-selection";
import { MetadataReviewSuggestions } from "./MetadataReviewSuggestions";
import type { ReviewStatus } from "./unmatched-query";
type Data = Awaited<ReturnType<typeof fetchMetadataReviewAssets>>;
export function MetadataReviewPanel({
  onContentChange,
  initialStatus = "pending",
  onStatusChange,
}: {
  initialStatus?: MetadataReviewFilters["status"];
  onStatusChange?: (value: ReviewStatus) => void;
  onContentChange?: (value: string) => void;
}) {
  const t = useTranslations("Tagging.Metadata");
  const tr = useTranslations("Tagging.Review");
  const [data, setData] = useState<Data>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(40);
  const [filters, setFilters] = useState({ ...defaultMetadataReviewFilters, status: initialStatus });
  const [search, setSearch] = useState("");
  const [excludedIds, setExcludedIds] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    setSelected([]);
    fetchMetadataReviewAssets(page, pageSize, filters)
      .then((result) => {
        if (alive) {
          const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
          if (page > lastPage) setPage(lastPage);
          else setData(result);
        }
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [page, pageSize, filters, refresh]);
  const change = <K extends keyof MetadataReviewFilters>(
    key: K,
    value: MetadataReviewFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const assets = data?.assets || [];
  const pendingAssets = assets.filter((asset) =>
    asset.rows.some((row) => row.status === "pending"),
  );
  const selectedRows = assets
    .filter((asset) => selected.includes(asset.assetObject.id))
    .flatMap((asset) => asset.rows.filter((row) => row.status === "pending"));
  const disabled = busy || loading;
  const allSelected =
    !!pendingAssets.length &&
    pendingAssets.every((asset) => selected.includes(asset.assetObject.id));
  const act = async (ids: number[], action: "approve" | "reject") => {
    if (disabled || !ids.length) return;
    setBusy(true);
    try {
      let applied = 0,
        skipped = 0;
      const review = async (batch: number[], decision: "approve" | "reject") => {
        const result = await reviewMetadata(batch, decision);
        applied += result.applied;
        if (decision === "approve") skipped += result.skipped;
      };
      if (action === "approve") {
        await applyMetadataReviewSelection(ids.map(id => ({ id, status: "pending" })), excludedIds, review);
      } else {
        for (let i = 0; i < ids.length; i += 100) await review(ids.slice(i, i + 100), action);
      }
      if (action === "approve" && skipped) toast.message(t("manualKept"));
      if (applied) toast.success(t("appliedCount", { count: applied }));
    } catch {
      toast.error(t("reviewFailed"));
    } finally {
      setBusy(false);
      setRefresh((v) => v + 1);
    }
  };
  const dropdown = (
    value: string,
    options: [string, string][],
    label: string,
    onChange: (value: string) => void,
    className = "",
  ) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={`h-9 w-auto gap-2 rounded-md text-[13px] ${className}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / pageSize));
  const pages = [
    ...new Set([
      1,
      ...Array.from(
        { length: 5 },
        (_, i) => Math.max(1, Math.min(page - 2, totalPages - 4)) + i,
      ).filter((p) => p <= totalPages),
      totalPages,
    ]),
  ];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4" aria-busy={disabled}>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-background px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3 max-sm:w-full max-sm:[&>[data-slot=select-trigger]]:w-full text-sm">
          <Checkbox
            aria-label={t("selectAll")}
            checked={allSelected}
            indeterminate={!!selected.length && !allSelected}
            disabled={disabled || !pendingAssets.length}
            onCheckedChange={(checked) =>
              setSelected(checked ? pendingAssets.map((a) => a.assetObject.id) : [])
            }
          />
          <span>
            {selected.length
              ? tr("selectedItemsCount", { count: selected.length, total: data?.total || 0 })
              : tr("totalItems", { total: data?.total || 0 })}
          </span>
          {!!selected.length && (
            <>
              <Button
                size="sm"
                disabled={
                  disabled || !selectedRows.length || selectedRows.some((r) => !r.available && !excludedIds.includes(r.id))
                }
                onClick={() =>
                  act(
                    selectedRows.map((r) => r.id),
                    "approve",
                  )
                }
              >
                <CheckIcon className="size-4" />
                {t("approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || !selectedRows.length}
                onClick={() =>
                  act(
                    selectedRows.map((r) => r.id),
                    "reject",
                  )
                }
              >
                <XIcon className="size-4" />
                {t("reject")}
              </Button>
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3 max-sm:w-full max-sm:[&>[data-slot=select-trigger]]:w-full">
          {dropdown(
            "fields",
            [
              ["all", `${t("reviewContent")}：${t("allContent")}`],
              ["tags", `${t("reviewContent")}：${t("onlyTags")}`],
              ["features", `${t("reviewContent")}：${t("onlyFeatures")}`],
              ["fields", `${t("reviewContent")}：${t("onlyFields")}`],
            ],
            t("reviewContent"),
            (value) => onContentChange?.(value),
          )}
          {dropdown(
            filters.source,
            [
              ["all", `${t("source")}：${t("allSources")}`],
              ["basicInfo", t("sourceBasicInfo")],
              ["materializedPath", t("sourceMaterializedPath")],
              ["contentAnalysis", t("sourceContentAnalysis")],
            ],
            t("source"),
            (value) => change("source", value as MetadataReviewFilters["source"]),
          )}
          {dropdown(
            filters.status,
            [
              ["all", tr("allStatuses")],
              ["pending", t("pending")],
              ["approved", t("approved")],
              ["rejected", t("rejected")],
              ["unmatched", t("unmatched")],
            ],
            tr("allStatuses"),
            (value) => {
              if (value !== "unmatched") change("status", value as MetadataReviewFilters["status"]);
              onStatusChange?.(value as ReviewStatus);
            },
          )}
          {dropdown(
            filters.confidence,
            [
              ["all", tr("allConfidence")],
              ["high", t("high")],
              ["medium", t("medium")],
              ["low", t("low")],
            ],
            tr("allConfidence"),
            (value) => change("confidence", value as MetadataReviewFilters["confidence"]),
          )}
          {dropdown(
            filters.time,
            [
              ["all", tr("taggingInitiatedTime")],
              ["today", tr("today")],
              ["week", tr("thisWeek")],
              ["month", tr("thisMonth")],
            ],
            tr("taggingInitiatedTime"),
            (value) => change("time", value as MetadataReviewFilters["time"]),
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              change("search", search);
            }}
            className="relative w-full sm:w-52"
          >
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-basic-5" />
            <Input
              aria-label={tr("searchPlaceholder")}
              placeholder={tr("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 rounded-md pl-9 text-[13px]"
            />
          </form>
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto max-md:flex-none max-md:overflow-visible">
        {loading ? (
          <div role="status" className="flex justify-center gap-2 p-8 text-sm text-basic-5">
            <Loader2Icon className="size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : error ? (
          <div role="alert" className="p-4 text-sm">
            {t("loadFailed")}
            <Button variant="link" onClick={() => setRefresh((v) => v + 1)}>
              {t("retry")}
            </Button>
          </div>
        ) : !assets.length ? (
          <p className="p-8 text-center text-sm text-basic-5 dark:text-basic-6">{t("empty")}</p>
        ) : (
          assets.map((asset) => {
            const extra = asset.assetObject.extra as AssetObjectExtra;
            const pending = asset.rows.filter((row) => row.status === "pending");
            return (
              <article
                key={asset.assetObject.id}
                className="flex flex-col gap-4 rounded-lg border bg-background p-4"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <Checkbox
                    className="mt-2"
                    aria-label={asset.assetObject.name}
                    checked={selected.includes(asset.assetObject.id)}
                    disabled={disabled || !pending.length}
                    onCheckedChange={(checked) =>
                      setSelected((previous) =>
                        checked
                          ? [...previous, asset.assetObject.id]
                          : previous.filter((id) => id !== asset.assetObject.id),
                      )
                    }
                  />
                  <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-basic-1 dark:bg-basic-3">
                    <AssetThumbnail
                      asset={{
                        extension: extra?.extension,
                        thumbnailUrl: extra?.thumbnailAccessUrl,
                      }}
                      maxWidth={64}
                      maxHeight={64}
                      className="size-16 rounded-lg object-cover"
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h2 className="[overflow-wrap:anywhere] text-base font-semibold leading-6">
                      {asset.assetObject.name}
                    </h2>
                    <p className="text-xs text-basic-5 dark:text-basic-6">
                      {[
                        extra?.extension?.toUpperCase(),
                        extra?.size == null ? undefined : formatSize(extra.size),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {!!pending.length && (
                    <div className="flex shrink-0 flex-wrap gap-2 max-sm:w-full max-sm:justify-end">
                      <Button
                        size="sm"
                        className="rounded-md"
                        disabled={disabled || pending.some((row) => !row.available && !excludedIds.includes(row.id))}
                        onClick={() =>
                          act(
                            pending.map((row) => row.id),
                            "approve",
                          )
                        }
                      >
                        <CheckIcon className="size-4" />
                        {t("approve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-md"
                        disabled={disabled}
                        onClick={() =>
                          act(
                            pending.map((row) => row.id),
                            "reject",
                          )
                        }
                      >
                        <XIcon className="size-4" />
                        {t("reject")}
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                  <MetadataReviewSuggestions
                    rows={asset.rows}
                    createdAt={asset.createdAt}
                    busy={disabled}
                    excludedIds={excludedIds}
                    onToggle={(id) => setExcludedIds(current => current.includes(id)
                      ? current.filter(item => item !== id) : [...current, id])}
                  />
                </div>
              </article>
            );
          })
        )}
      </div>
      <nav
        aria-label={t("next")}
        className="flex shrink-0 flex-wrap items-center justify-end gap-1 py-2 text-xs text-basic-5 dark:text-basic-6"
      >
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={disabled || page === 1}
          aria-label={t("previous")}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        {pages.map((p, i) => (
          <span key={p} className="flex items-center">
            {i > 0 && p > pages[i - 1] + 1 && <span className="px-1">…</span>}
            <Button
              variant="ghost"
              className={`size-8 p-0 text-xs ${p === page ? "text-primary-6" : ""}`}
              aria-current={p === page ? "page" : undefined}
              disabled={disabled}
              onClick={() => setPage(p)}
            >
              {p}
            </Button>
          </span>
        ))}
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={disabled || page === totalPages}
          aria-label={t("next")}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRightIcon className="size-4" />
        </Button>
        {dropdown(
          String(pageSize),
          [20, 40, 80].map((size) => [String(size), tr("itemsPerPage", { count: size })]),
          tr("itemsPerPage", { count: pageSize }),
          (value) => {
            setPageSize(Number(value));
            setPage(1);
          },
          "border-0 shadow-none",
        )}
      </nav>
    </div>
  );
}
