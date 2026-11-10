"use client";

import { AssetThumbnail } from "@/components/AssetThumbnail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { slugToId } from "@/lib/slug";
import type { AssetObjectExtra } from "@/prisma/client";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { fetchUnmatchedReviewAssets } from "./unmatched-actions";
import type { ReviewContent, ReviewStatus, UnmatchedFilters } from "./unmatched-query";

export function UnmatchedReviewPanel({
  content,
  metadataAvailable,
  isAdmin,
  onContentChange,
  onStatusChange,
}: {
  content: ReviewContent;
  metadataAvailable: boolean;
  isAdmin: boolean;
  onContentChange: (value: string) => void;
  onStatusChange: (value: ReviewStatus) => void;
}) {
  const t = useTranslations("Tagging.Review");
  const tm = useTranslations("Tagging.Metadata");
  const locale = useLocale();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchUnmatchedReviewAssets>>>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(40);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [time, setTime] = useState<UnmatchedFilters["time"]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setPage(1);
  }, [content]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    fetchUnmatchedReviewAssets(page, pageSize, { content, search: query, time })
      .then((result) => {
        if (!alive) return;
        const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
        if (page > lastPage) setPage(lastPage);
        else setData(result);
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
  }, [content, page, pageSize, query, time, refresh]);
  const dropdown = (
    value: string,
    label: string,
    options: [string, string][],
    change: (value: string) => void,
  ) => (
    <Select value={value} onValueChange={change}>
      <SelectTrigger aria-label={label} className="h-9 w-auto gap-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-background px-4 py-3">
        <span className="text-sm">
          {t("totalItems", { total: loading ? 0 : (data?.total ?? 0) })}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {dropdown(
            content,
            tm("reviewContent"),
            [
              ["all", `${tm("reviewContent")}：${tm("allContent")}`],
              ["tags", `${tm("reviewContent")}：${tm("onlyTags")}`],
              ["features", `${tm("reviewContent")}：${tm("onlyFeatures")}`],
              ...(metadataAvailable
                ? [["fields", `${tm("reviewContent")}：${tm("onlyFields")}`] as [string, string]]
                : []),
            ],
            onContentChange,
          )}
          {dropdown(
            "unmatched",
            t("allStatuses"),
            [
              ["all", t("allStatuses")],
              ["pending", tm("pending")],
              ["approved", tm("approved")],
              ...(isAdmin || content === "fields"
                ? [["rejected", tm("rejected")] as [string, string]]
                : []),
              ["unmatched", tm("unmatched")],
            ],
            (value) => onStatusChange(value as ReviewStatus),
          )}
          {dropdown(
            time,
            t("taggingInitiatedTime"),
            [
              ["all", t("allTime")],
              ["today", t("today")],
              ["week", t("thisWeek")],
              ["month", t("thisMonth")],
            ],
            (value) => {
              setTime(value as UnmatchedFilters["time"]);
              setPage(1);
            },
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search);
              setPage(1);
            }}
          >
            <Input
              aria-label={t("searchPlaceholder")}
              placeholder={t("searchPlaceholder")}
              value={search}
              maxLength={200}
              onChange={(event) => setSearch(event.target.value)}
            />
          </form>
        </div>
      </div>
      <p className="text-xs text-basic-5 dark:text-basic-6">{tm("unmatchedDescription")}</p>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p role="status" className="p-6 text-center text-sm text-basic-5">
            {t("loading")}
          </p>
        ) : error ? (
          <div role="alert" className="flex items-center justify-center gap-3 p-6">
            <span>{tm("loadFailed")}</span>
            <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>
              {tm("retry")}
            </Button>
          </div>
        ) : !data?.assets.length ? (
          <p className="p-6 text-center text-sm text-basic-5">{tm("noUnmatched")}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {data.assets.map(({ assetObject: asset, createdAt }) => {
              const extra = asset.extra as AssetObjectExtra | null;
              return (
                <article
                  key={asset.id}
                  className="flex items-start gap-4 rounded-lg border bg-background p-4"
                >
                  <AssetThumbnail
                    asset={{ extension: extra?.extension, thumbnailUrl: extra?.thumbnailAccessUrl }}
                    maxWidth={64}
                    maxHeight={64}
                    className="size-16 shrink-0 rounded-lg object-cover"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <h2 className="break-words text-base font-semibold">{asset.name}</h2>
                    <span className="text-xs text-basic-5 dark:text-basic-6">
                      {new Date(createdAt).toLocaleString(locale)}
                    </span>
                    <Button
                      variant="link"
                      className="h-auto justify-start self-start p-0"
                      onClick={() =>
                        dispatchMuseDAMClientAction("goto", {
                          url: `/detail/${slugToId("assetObject", asset.slug).toString()}`,
                          target: "_blank",
                        })
                      }
                    >
                      {t("openInMuseDAM")}
                    </Button>
                  </div>
                  <span className="rounded border px-2 py-1 text-xs text-basic-5 dark:text-basic-6">
                    {tm("unmatched")}
                  </span>
                </article>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          disabled={loading || page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          {tm("previous")}
        </Button>
        <span className="text-sm">
          {page} / {Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))}
        </span>
        <Button
          variant="outline"
          disabled={loading || page * pageSize >= (data?.total ?? 0)}
          onClick={() => setPage((value) => value + 1)}
        >
          {tm("next")}
        </Button>
        {dropdown(
          String(pageSize),
          t("itemsPerPage", { count: pageSize }),
          [20, 40, 80].map((size) => [String(size), t("itemsPerPage", { count: size })]),
          (value) => {
            setPageSize(Number(value));
            setPage(1);
          },
        )}
      </div>
    </div>
  );
}
