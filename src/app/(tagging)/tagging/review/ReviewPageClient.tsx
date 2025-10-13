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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CheckIcon, Loader2Icon, Search, XIcon } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AssetWithAuditItemsBatch, fetchAssetsWithAuditItems, batchApproveAuditItemsAction, batchRejectAuditItemsAction } from "./actions";
import { ReviewItem } from "./ReviewItem";
import { useTheme } from "next-themes";
import Image from "next/image";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

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
  const [timeFilter, setTimeFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<AssetWithAuditItemsBatch[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    refreshDataWithFilters();
  }, []);

  const refreshDataWithFilters = useCallback(
    async (
      page: number = currentPage,
      status: TaggingAuditStatus | "all" = statusFilter,
      confidence: "all" | "high" | "medium" | "low" = confidenceFilter,
      search: string = searchQuery,
      time: "all" | "today" | "week" | "month" = timeFilter,
      size: number = pageSize,
    ) => {
      setIsLoading(true);
      try {
        const assetsResult = await fetchAssetsWithAuditItems(
          page,
          size,
          status === "all" ? undefined : status,
          confidence === "all" ? undefined : confidence,
          search || undefined,
          time === "all" ? undefined : time,
        );
        if (assetsResult.success) {
          const newAssets = assetsResult.data.assets;
          setAssets(newAssets);
          setTotalPages(assetsResult.data.totalPages);
          setTotal(assetsResult.data.total);

          // 保留已选择的资产，不过滤当前页面不存在的
          // setSelectedAssets 和 setSelectedAssetIds 保持不变
        }
      } catch (error) {
        console.error(t("refreshDataFailed"), error);
      } finally {
        setIsLoading(false);
      }
    },
    [currentPage, pageSize, statusFilter, confidenceFilter, searchQuery, timeFilter, t],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      refreshDataWithFilters(page, statusFilter, confidenceFilter, searchQuery, timeFilter);
    },
    [refreshDataWithFilters, statusFilter, confidenceFilter, searchQuery, timeFilter],
  );

  const handlePageSizeChange = useCallback(
    (newPageSize: string) => {
      const size = parseInt(newPageSize);
      setPageSize(size);
      setCurrentPage(1);
      refreshDataWithFilters(1, statusFilter, confidenceFilter, searchQuery, timeFilter, size);
    },
    [refreshDataWithFilters, statusFilter, confidenceFilter, searchQuery, timeFilter],
  );

  const handlePageInputSubmit = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const pageNumber = (e.target as HTMLInputElement).value as string;
        const page = parseInt(pageNumber);
        handlePageChange(page < 1 ? 1 : page > totalPages ? totalPages : page);
      }
    },
    [totalPages, handlePageChange],
  );


  // 计算选择状态
  const isAllSelected = assets.length > 0 && assets.every(asset => selectedAssetIds.has(asset.assetObject.id));
  const isIndeterminate = selectedAssetIds.size > 0 && !isAllSelected;

  // 全选/取消全选
  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      // 保留原本选择的，再叠加当前页面的
      const currentPageIds = new Set(assets.map(asset => asset.assetObject.id));
      const newSelectedIds = new Set([...selectedAssetIds, ...currentPageIds]);
      setSelectedAssetIds(newSelectedIds);

      // 合并已选择的资产和当前页面的资产，去重
      const existingAssets = selectedAssets.filter(asset => !currentPageIds.has(asset.assetObject.id));
      setSelectedAssets([...existingAssets, ...assets]);
    } else {
      // 取消全选时，只取消当前页面的选择，保留其他页面的选择
      const currentPageIds = new Set(assets.map(asset => asset.assetObject.id));
      const newSelectedIds = new Set([...selectedAssetIds].filter(id => !currentPageIds.has(id)));
      setSelectedAssetIds(newSelectedIds);

      setSelectedAssets(prev => prev.filter(asset => !currentPageIds.has(asset.assetObject.id)));
    }
  }, [assets, selectedAssetIds, selectedAssets]);

  // 单个选择
  const handleSelectAsset = useCallback((asset: AssetWithAuditItemsBatch, checked: boolean) => {
    if (checked) {
      setSelectedAssetIds(prev => new Set([...prev, asset.assetObject.id]));
      setSelectedAssets(prev => [...prev, asset]);
    } else {
      setSelectedAssetIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(asset.assetObject.id);
        return newSet;
      });
      setSelectedAssets(prev => prev.filter(a => a.assetObject.id !== asset.assetObject.id));
    }
  }, []);

  // 批量通过审核
  const handleBatchApprove = useCallback(async () => {
    if (selectedAssets.length === 0) return;

    setLoading(true);
    try {
      const result = await batchApproveAuditItemsAction({
        assetObjects: selectedAssets.map(asset => asset.assetObject),
        append: true,
      });

      if (result.success && result.data) {
        const { failedCount, deletedCount } = result.data;
        const successCount = selectedAssets.length - failedCount - deletedCount;

        if (failedCount === 0) {
          toast.success(t("batchApproveSuccess"));
        } else if (successCount === 0) {
          toast.error(t("noCorrespondingTag"))
          return;
        } else {
          toast.warning(t("batchApprovePartialSuccess", { successCount }) + (failedCount > 0 ? t("batchFailedCount", { failedCount }) : "") + (deletedCount > 0 ? t("batchDeletedCount", { deletedCount }) : ""));
        }
      } else {
        toast.error(t("batchApproveFailed"));
      }

      setCurrentPage(1)
      setSelectedAssets([]);
      setSelectedAssetIds(new Set());
      refreshDataWithFilters();
    } catch (error: unknown) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : t("batchApproveFailed"));
    } finally {
      setLoading(false);
    }
  }, [selectedAssets, t, refreshDataWithFilters]);

  // 批量拒绝审核
  const handleBatchReject = useCallback(async () => {
    if (selectedAssets.length === 0) return;

    setLoading(true);
    try {
      await batchRejectAuditItemsAction({
        assetObjects: selectedAssets.map(asset => asset.assetObject),
      });
      toast.success(t("batchRejectSuccess"));
      setCurrentPage(1)
      setSelectedAssets([]);
      setSelectedAssetIds(new Set());
      refreshDataWithFilters();
    } catch (error: unknown) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : t("batchRejectFailed"));
    } finally {
      setLoading(false);
    }
  }, [selectedAssets, t, refreshDataWithFilters]);

  return (
    <div className="flex flex-col space-y-[10px] min-h-full">
      {/* 筛选器和搜索 */}
      <div className="flex items-center justify-between py-4 px-5 bg-background border rounded-[6px]">
        <div className="text-[13px] font-medium flex items-center gap-3">
          <Checkbox
            className="size-4"
            checked={isAllSelected}
            indeterminate={selectedAssets.length > 0 && !isAllSelected}
            onCheckedChange={handleSelectAll}
            ref={(el) => {
              if (el) {
                (el as HTMLInputElement).indeterminate = isIndeterminate;
              }
            }}
          />
          {!selectedAssets.length ? t("totalItems", { total }) : t("selectedItemsCount", { count: selectedAssets.length, total })}


          {selectedAssets.length > 0 && <>
            <Button
              onClick={handleBatchApprove}
              size="sm"
              variant="default"
              className="rounded-[6px] "
              disabled={loading || selectedAssets.length === 0}
            >
              {loading ? <Loader2Icon className="size-[14px] animate-spin" /> : <CheckIcon className="size-[14px]" />}
              {t("add")}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className="rounded-[6px] bg-background text-danger-6 border-solid border-danger-6 border hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
                  disabled={loading || selectedAssets.length === 0}
                >
                  {loading ? <Loader2Icon className="size-[14px] animate-spin" /> : <XIcon className="size-[14px]" />}
                  {t("delete")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("rejectConfirmTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("batchRejectConfirmDescription", { assetNum: selectedAssets.length })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("rejectConfirmCancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleBatchReject}
                    variant="dialogDanger"
                  >
                    {t("rejectConfirmReject")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>}
        </div>
        <div className="flex flex-col sm:flex-row justify-end gap-4">
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              const newStatus = value as TaggingAuditStatus | "all";
              setStatusFilter(newStatus);
              setCurrentPage(1);
              refreshDataWithFilters(1, newStatus, confidenceFilter, searchQuery, timeFilter);
            }}
          >
            <SelectTrigger className="min-w-32 w-fit !h-8 rounded-[6px]">
              <SelectValue placeholder={t("allStatuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatuses")}</SelectItem>
              <SelectItem value="pending">{t("pending")}</SelectItem>
              <SelectItem value="approved">{t("approved")}</SelectItem>
              {/* <SelectItem value="rejected">{t("rejected")}</SelectItem> */}
            </SelectContent>
          </Select>
          <Select
            value={confidenceFilter}
            onValueChange={(value) => {
              const newConfidence = value as "all" | "high" | "medium" | "low";
              setConfidenceFilter(newConfidence);
              setCurrentPage(1);
              refreshDataWithFilters(1, statusFilter, newConfidence, searchQuery, timeFilter);
            }}
          >
            <SelectTrigger className="min-w-32 w-fit !h-8 rounded-[6px]">
              <SelectValue placeholder={t("allConfidence")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allConfidence")}</SelectItem>
              <SelectItem value="high">{t("precise")}</SelectItem>
              <SelectItem value="medium">{t("balanced")}</SelectItem>
              <SelectItem value="low">{t("broad")}</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={timeFilter}
            onValueChange={(value) => {
              const newTime = value as "all" | "today" | "week" | "month";
              setTimeFilter(newTime);
              setCurrentPage(1);
              refreshDataWithFilters(1, statusFilter, confidenceFilter, searchQuery, newTime);
            }}
          >
            <SelectTrigger className="min-w-32 w-fit !h-8 rounded-[6px]">
              <SelectValue placeholder={t("taggingInitiatedTime")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allTime")}</SelectItem>
              <SelectItem value="today">{t("today")}</SelectItem>
              <SelectItem value="week">{t("thisWeek")}</SelectItem>
              <SelectItem value="month">{t("thisMonth")}</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex-1 max-w-[209px] relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-basic-5" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setCurrentPage(1);
                  refreshDataWithFilters(
                    1,
                    statusFilter,
                    confidenceFilter,
                    searchQuery,
                    timeFilter,
                  );
                }
              }}
              className="pl-10 h-8 rounded-[6px]"
            />
          </div>
        </div>
      </div>

      {/* 右侧主要内容 */}
      {isLoading ? (
        <Card className="flex-1 flex items-center justify-center">
          <CardContent className="pt-6 text-center">
            <Loader2Icon className="size-5 animate-spin text-primary-6 mx-auto mb-4" />
            <p>{t("loading")}</p>
          </CardContent>
        </Card>
      ) : assets.length === 0 ? (
        <Card className="flex-1 flex items-center justify-center">
          <CardContent className="pt-6 text-center">
            <Image
              width={171}
              height={120}
              src={isDark ? "/emptyDataDark.svg" : "/emptyData.svg"}
              alt="empty"
              className="h-[120px] w-auto mx-auto mb-4"
            />
            <p className='text-[20px] font-semibold leading-[28px] mb-2'>{t("noPendingTags")}</p>
            <p className="text-sm text-basic-5">{t("enableAutoTaggingDesc")}</p>
            <Button variant="default" size="sm" className="mt-6" onClick={() => dispatchMuseDAMClientAction("goto", { url: "/home/dashboard/tag" })}>{t("goToTaggingManagement")}</Button>
          </CardContent>
        </Card>
      ) : <>
        {assets.map((asset) => (
          <ReviewItem
            {...asset}
            batchLoading={loading}
            onSuccess={() => refreshDataWithFilters()}
            CheckboxComponent={<Checkbox
              className="size-4"
              checked={selectedAssetIds.has(asset.assetObject.id)}
              onCheckedChange={(checked) => handleSelectAsset(asset, checked as boolean)}
            />}
            key={asset.assetObject.id}
          />
        ))}


        {/* 分页组件 */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-[14px]">
          {/* 页码输入 */}
          <Input
            placeholder={t("pageInputPlaceholder")}
            min="1"
            max={totalPages}
            onKeyDown={handlePageInputSubmit}
            className="rounded-[6px] max-w-[270px] flex-1 h-[38px]"
          />


          {/* 分页导航 */}
          <div className="flex items-center gap-2">
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
                    disabled={currentPage <= 1}
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

                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (currentPage < totalPages) {
                        handlePageChange(currentPage + 1);
                      }
                    }}
                    disabled={currentPage >= totalPages}
                    ariaLabel={tCommon("pagination.goToNextPage")}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
            {/* 每页条数选择 */}
            <div className="flex items-center gap-2 text-sm text-basic-5">
              <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 40, 50, 100].map((item) => (
                    <SelectItem key={item} value={item.toString()}>{t("itemsPerPage", { count: item })}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>{t("itemsUnit")}</span>
            </div>
          </div>
        </div>
      </>
      }
    </div>
  );
}
