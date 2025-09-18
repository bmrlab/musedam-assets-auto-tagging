"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { File, Loader2Icon, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AssetWithAuditItemsBatch, fetchAssetsWithAuditItems } from "./actions";
import { ReviewItem } from "./ReviewItem";

type TaggingAuditStatus = "pending" | "approved" | "rejected";

export default function ReviewPageClient() {
  const t = useTranslations("Tagging.Review");
  const tCommon = useTranslations("Tagging.Common");
  const [assets, setAssets] = useState<AssetWithAuditItemsBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TaggingAuditStatus | "all">("pending");
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "medium" | "low">(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const refreshData = useCallback(async () => {
    setIsLoading(true);
    try {
      const assetsResult = await fetchAssetsWithAuditItems(
        currentPage,
        pageSize,
        statusFilter === "all" ? undefined : statusFilter,
        confidenceFilter === "all" ? undefined : confidenceFilter,
        searchQuery || undefined,
      );
      if (assetsResult.success) {
        setAssets(assetsResult.data.assets);
        setTotalPages(assetsResult.data.totalPages);
        setTotal(assetsResult.data.total);
      }
    } catch (error) {
      console.error(t("refreshDataFailed"), error);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, pageSize, statusFilter, confidenceFilter, searchQuery, t]);

  useEffect(() => {
    refreshData();
  }, []);

  const handleFilterChange = useCallback(() => {
    setCurrentPage(1);
    refreshData();
  }, [refreshData]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    refreshData()
  }, [refreshData]);

  return (
    <div className="space-y-6">
      {/* 筛选器和搜索 */}
      <div className="flex flex-col sm:flex-row justify-end gap-4 py-2 px-3 bg-background border rounded-md">
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as TaggingAuditStatus | "all");
            setTimeout(handleFilterChange, 100);
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder={t("allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allStatuses")}</SelectItem>
            <SelectItem value="pending">{t("pending")}</SelectItem>
            <SelectItem value="approved">{t("approved")}</SelectItem>
            <SelectItem value="rejected">{t("rejected")}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={confidenceFilter}
          onValueChange={(value) => {
            setConfidenceFilter(value as "all" | "high" | "medium" | "low");
            setTimeout(handleFilterChange, 100);
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder={t("allConfidence")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allConfidence")}</SelectItem>
            <SelectItem value="high">{t("precise")}</SelectItem>
            <SelectItem value="medium">{t("balanced")}</SelectItem>
            <SelectItem value="low">{t("broad")}</SelectItem>
          </SelectContent>
        </Select>

        <Select disabled>
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t("taggingInitiatedTime")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allTime")}</SelectItem>
            <SelectItem value="today">{t("today")}</SelectItem>
            <SelectItem value="week">{t("thisWeek")}</SelectItem>
            <SelectItem value="month">{t("thisMonth")}</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleFilterChange();
              }
            }}
            className="pl-10"
          />
        </div>
      </div>

      {/* 右侧主要内容 */}
      {isLoading ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <Loader2Icon className="size-8 animate-spin mx-auto mb-4" />
            <p>{t("loading")}</p>
          </CardContent>
        </Card>
      ) : assets.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <File className="h-12 w-12 mx-auto mb-4" />
            <p>{t("noAssetsToReview")}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {assets.map((asset) => <ReviewItem key={asset.assetObject.id} {...asset} onSuccess={() => refreshData()} />)}

          {/* 分页组件 */}
          {totalPages > 1 && (
            <div className="flex justify-center mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (currentPage > 1) {
                          handlePageChange(currentPage - 1);
                        }
                      }}
                      className={currentPage <= 1 ? "pointer-events-none opacity-50" : ""}
                      previousText={tCommon("pagination.previous")}
                      ariaLabel={tCommon("pagination.goToPreviousPage")}
                    />
                  </PaginationItem>

                  {/* 页码 */}
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }

                    return (
                      <PaginationItem key={pageNum}>
                        <PaginationLink
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            handlePageChange(pageNum);
                          }}
                          isActive={currentPage === pageNum}
                        >
                          {pageNum}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}

                  {/* 省略号在 Review 暂未出现的逻辑，如后续加入，请传 morePagesText */}

                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (currentPage < totalPages) {
                          handlePageChange(currentPage + 1);
                        }
                      }}
                      className={currentPage >= totalPages ? "pointer-events-none opacity-50" : ""}
                      nextText={tCommon("pagination.next")}
                      ariaLabel={tCommon("pagination.goToNextPage")}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}

        </>
      )}
    </div>
  );
}
