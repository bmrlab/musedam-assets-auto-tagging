"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  MoreHorizontal,
  X,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  deleteAssetIpAction,
  pollIpsAction,
  retryAssetIpProcessingAction,
  setAssetIpEnabledAction,
} from "./actions";
import IpDialog from "./IpDialog";
import IpImageHoverCard from "./IpImageHoverCard";
import SignedIpImage from "./SignedIpImage";
import { IpItem, IpLibraryPageData } from "./types";

function getCopy(locale: string) {
  const isChinese = locale.toLowerCase().startsWith("zh");

  if (isChinese) {
    return {
      title: "IP形象特征库",
      description: "管理品牌吉祥物、虚拟形象等IP特征",
      searchPlaceholder: "搜索IP形象名称",
      create: "新建 IP",
      empty: "暂无数据",
      filteredEmpty: "没有符合当前筛选条件的IP形象",
      retry: "重试",
    };
  }

  return {
    title: "IP Character Library",
    description: "Manage brand mascots, virtual characters, and other IP features",
    searchPlaceholder: "Search IP character name",
    create: "New IP",
    empty: "No data",
    filteredEmpty: "No IP characters match the current filters",
    retry: "Retry",
  };
}

function formatDate(date: Date | string, locale: string) {
  return new Intl.DateTimeFormat(locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(date));
}

function getIpStatusMeta(status: IpItem["status"]) {
  switch (status) {
    case "completed":
      return {
        label: "已完成",
        icon: CheckCircle2,
        className: "border-[#8cfac7] bg-[#edfff3] text-[#00e096]",
      };
    case "processing":
      return {
        label: "处理中",
        icon: LoaderCircle,
        className: "border-[#c7e2ff] bg-[#f2f8ff] text-[#0095ff]",
      };
    case "failed":
      return {
        label: "已失败",
        icon: XCircle,
        className: "border-[#ffa8b4] bg-[#fff2f2] text-[#ff3d71]",
      };
    default:
      return {
        label: "待处理",
        icon: Clock3,
        className: "border-[#d9e2f2] bg-[#f7f9fc] text-basic-5",
      };
  }
}

function IpImagesCell({ ip }: { ip: IpItem }) {
  const previewImages = ip.images;

  if (previewImages.length === 0) {
    return <span className="text-[14px] text-basic-5">-</span>;
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center">
        {previewImages.map((image, index) => (
          <IpImageHoverCard key={image.id} image={image} alt={`${ip.name} IP 图 ${index + 1}`}>
            <button
              type="button"
              className="relative -ml-2 first:ml-0 h-[22px] w-[22px] overflow-hidden rounded-[4px] border border-white bg-basic-2 shadow-sm"
              style={{ zIndex: previewImages.length - index }}
              aria-label={`预览 ${ip.name} IP 图 ${index + 1}`}
            >
              <SignedIpImage
                imageId={image.id}
                signedUrl={image.signedUrl}
                signedUrlExpiresAt={image.signedUrlExpiresAt}
                alt={`${ip.name} IP 图 ${index + 1}`}
                className="h-full w-full object-cover"
              />
            </button>
          </IpImageHoverCard>
        ))}
      </div>
      <span className="text-[14px] text-basic-5">{ip.images.length}张</span>
    </div>
  );
}

export default function IpLibraryClient({
  initialData,
  debugPageEnabled,
}: {
  initialData: IpLibraryPageData;
  debugPageEnabled: boolean;
}) {
  const locale = useLocale();
  const copy = getCopy(locale);
  const tReview = useTranslations("Tagging.Review");
  const [ips, setIps] = useState(initialData.ips);
  const [ipTypes, setIpTypes] = useState(initialData.ipTypes);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [enabledFilter, setEnabledFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name-asc" | "name-desc">(
    "newest",
  );
  const [pageSize, setPageSize] = useState(40);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [activeIp, setActiveIp] = useState<IpItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IpItem | null>(null);
  const [disableTarget, setDisableTarget] = useState<IpItem | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchEnableOpen, setBatchEnableOpen] = useState(false);
  const [batchDisableOpen, setBatchDisableOpen] = useState(false);
  const [pendingIpIds, setPendingIpIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const usedIpTypeIds = useMemo(
    () =>
      Array.from(
        new Set(ips.map((ip) => ip.ipTypeId).filter((typeId): typeId is string => Boolean(typeId))),
      ),
    [ips],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearch, typeFilter, statusFilter, enabledFilter, sortOrder, pageSize]);

  useEffect(() => {
    if (typeFilter !== "all" && !ipTypes.some((type) => String(type.id) === typeFilter)) {
      setTypeFilter("all");
    }
  }, [ipTypes, typeFilter]);

  const filteredIps = ips
    .filter((ip) => {
      if (deferredSearch && !ip.name.toLowerCase().includes(deferredSearch)) {
        return false;
      }

      if (typeFilter !== "all" && String(ip.ipTypeId ?? "") !== typeFilter) {
        return false;
      }

      if (statusFilter !== "all" && ip.status !== statusFilter) {
        return false;
      }

      if (enabledFilter === "enabled" && !ip.enabled) {
        return false;
      }

      if (enabledFilter === "disabled" && ip.enabled) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      if (sortOrder === "name-asc") {
        return left.name.localeCompare(right.name, "zh-CN");
      }

      if (sortOrder === "name-desc") {
        return right.name.localeCompare(left.name, "zh-CN");
      }

      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      return sortOrder === "newest" ? rightTime - leftTime : leftTime - rightTime;
    });

  const totalPages = Math.max(1, Math.ceil(filteredIps.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const currentPageIps = filteredIps.slice(pageStart, pageStart + pageSize);
  const currentPageIds = currentPageIps.map((ip) => ip.id);
  const selectedOnPage = currentPageIds.filter((id) => selectedIds.includes(id));
  const allSelectedOnPage =
    currentPageIds.length > 0 && selectedOnPage.length === currentPageIds.length;
  const someSelectedOnPage = selectedOnPage.length > 0 && !allSelectedOnPage;
  const hasSelection = selectedIds.length > 0;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    const pendingIds = ips
      .filter((ip) => ip.status === "processing" || ip.status === "pending")
      .map((ip) => ip.id);

    if (pendingIds.length === 0) {
      return;
    }

    let disposed = false;

    async function poll() {
      const result = await pollIpsAction(pendingIds);
      if (!result.success || disposed) {
        return;
      }

      setIps((current) =>
        current.map((ip) => result.data.ips.find((item) => item.id === ip.id) ?? ip),
      );
    }

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [ips]);

  function getProcessingErrorMessage(error: string | null) {
    if (!error) {
      return null;
    }

    switch (error) {
      case "ip_not_found":
        return "IP形象不存在或已被删除";
      case "no_reference_images":
        return "缺少参考图片，无法生成向量";
      case "image_fetch_failed":
        return "读取参考图片失败";
      case "jina_request_failed":
        return "调用 Jina 生成向量失败";
      case "embedding_count_mismatch":
        return "返回的向量数量与参考图片数量不一致";
      case "vector_store_sync_failed":
        return "同步向量到 Qdrant 失败";
      case "unknown":
        return "IP形象处理失败";
      default:
        return error;
    }
  }

  function updateIpInList(nextIp: IpItem) {
    setIps((current) => {
      const existing = current.some((ip) => ip.id === nextIp.id);
      if (!existing) {
        return [nextIp, ...current];
      }

      return current.map((ip) => (ip.id === nextIp.id ? nextIp : ip));
    });
  }

  function handleDialogSaved(ip: IpItem) {
    updateIpInList(ip);
    setDialogOpen(false);
    setActiveIp(null);
  }

  function handleOpenCreate() {
    setDialogMode("create");
    setActiveIp(null);
    setDialogOpen(true);
  }

  function handleOpenEdit(ip: IpItem) {
    setDialogMode("edit");
    setActiveIp(ip);
    setDialogOpen(true);
  }

  function markIpPending(ipId: string, pending: boolean) {
    setPendingIpIds((current) => {
      if (pending) {
        if (current.includes(ipId)) {
          return current;
        }
        return [...current, ipId];
      }

      return current.filter((id) => id !== ipId);
    });
  }

  function handleToggleEnabled(ip: IpItem, enabled: boolean) {
    markIpPending(ip.id, true);

    startTransition(async () => {
      const result = await setAssetIpEnabledAction(ip.id, enabled);
      markIpPending(ip.id, false);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      updateIpInList(result.data.ip);
      toast.success(enabled ? "IP形象已启用" : "IP形象已禁用");
    });
  }

  function handleConfirmDisableIp() {
    if (!disableTarget) {
      return;
    }

    handleToggleEnabled(disableTarget, false);
    setDisableTarget(null);
  }

  function handleDeleteIp() {
    if (!deleteTarget) {
      return;
    }

    markIpPending(deleteTarget.id, true);

    startTransition(async () => {
      const result = await deleteAssetIpAction(deleteTarget.id);
      markIpPending(deleteTarget.id, false);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      setIps((current) => current.filter((ip) => ip.id !== deleteTarget.id));
      setSelectedIds((current) => current.filter((id) => id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("IP形象已删除");
    });
  }

  function handleRetryProcessing(ip: IpItem) {
    markIpPending(ip.id, true);

    startTransition(async () => {
      const result = await retryAssetIpProcessingAction(ip.id);
      markIpPending(ip.id, false);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      updateIpInList(result.data.ip);
      toast.success("已重新发起处理");
    });
  }

  function handleTypeRenamed(typeId: string, name: string) {
    setIps((current) =>
      current.map((ip) => (ip.ipTypeId === typeId ? { ...ip, ipTypeName: name } : ip)),
    );
  }

  function handleTypeDeleted(typeId: string) {
    setIps((current) => current.map((ip) => (ip.ipTypeId === typeId ? ip : ip)));
  }

  function handleSelectAllOnPage(checked: boolean) {
    if (checked) {
      setSelectedIds((current) => Array.from(new Set([...current, ...currentPageIds])));
      return;
    }

    setSelectedIds((current) => current.filter((id) => !currentPageIds.includes(id)));
  }

  function handleBatchSetEnabled(enabled: boolean) {
    if (selectedIds.length === 0) {
      return;
    }

    const targetIds = [...selectedIds];
    targetIds.forEach((id) => markIpPending(id, true));

    startTransition(async () => {
      const results = await Promise.all(
        targetIds.map(async (id) => {
          const result = await setAssetIpEnabledAction(id, enabled);
          markIpPending(id, false);
          return result;
        }),
      );

      const updatedIps = results.filter((item) => item.success).map((item) => item.data.ip);
      if (updatedIps.length > 0) {
        const updatedById = new Map(updatedIps.map((ip) => [ip.id, ip]));
        setIps((current) => current.map((ip) => updatedById.get(ip.id) ?? ip));
      }

      const failedCount = results.length - updatedIps.length;
      if (failedCount === 0) {
        toast.success(enabled ? "已批量启用所选IP形象" : "已批量禁用所选IP形象");
        return;
      }

      if (updatedIps.length > 0) {
        toast.warning(`操作部分成功：成功 ${updatedIps.length} 项，失败 ${failedCount} 项`);
        return;
      }

      toast.error(enabled ? "批量启用失败，请稍后重试" : "批量禁用失败，请稍后重试");
    });
  }

  function handleBatchDisableSelected() {
    if (selectedIds.length === 0) {
      setBatchDisableOpen(false);
      return;
    }

    handleBatchSetEnabled(false);
    setBatchDisableOpen(false);
  }

  function handleBatchEnableSelected() {
    if (selectedIds.length === 0) {
      setBatchEnableOpen(false);
      return;
    }

    handleBatchSetEnabled(true);
    setBatchEnableOpen(false);
  }

  function handleBatchDeleteSelected() {
    if (selectedIds.length === 0) {
      setBatchDeleteOpen(false);
      return;
    }

    const targetIds = [...selectedIds];
    targetIds.forEach((id) => markIpPending(id, true));

    startTransition(async () => {
      const results = await Promise.all(
        targetIds.map(async (id) => {
          const result = await deleteAssetIpAction(id);
          markIpPending(id, false);
          return { id, result };
        }),
      );

      const successIds = results.filter((item) => item.result.success).map((item) => item.id);
      if (successIds.length > 0) {
        const successIdSet = new Set(successIds);
        setIps((current) => current.filter((ip) => !successIdSet.has(ip.id)));
        setSelectedIds((current) => current.filter((id) => !successIdSet.has(id)));
      }

      const failedCount = results.length - successIds.length;
      if (failedCount === 0) {
        toast.success("已批量删除所选IP形象");
      } else if (successIds.length > 0) {
        toast.warning(`删除部分成功：成功 ${successIds.length} 项，失败 ${failedCount} 项`);
      } else {
        toast.error("批量删除失败，请稍后重试");
      }

      setBatchDeleteOpen(false);
    });
  }

  function handlePageJump() {
    const nextPage = Number(pageInput);
    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages) {
      return;
    }

    setCurrentPage(nextPage);
    setPageInput("");
  }

  const emptyText =
    deferredSearch || typeFilter !== "all" || statusFilter !== "all" || enabledFilter !== "all"
      ? copy.filteredEmpty
      : copy.empty;
  const isLibraryCompletelyEmpty = ips.length === 0;

  return (
    <>
      <div className="flex min-h-[calc(100dvh-120px)] flex-1 flex-col pb-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-semibold">{copy.title}</h2>
            <p className="mt-1 text-sm leading-5 text-basic-5">{copy.description}</p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
            <div className="relative w-[200px]">
              <Image
                src="/Icon/Search.svg"
                alt=""
                width={14}
                height={14}
                className="pointer-events-none absolute top-1/2 left-[10px] -translate-y-1/2"
              />
              <Input
                className="h-8 w-[200px] rounded-[6px] border border-[#C5CEE0] bg-[#FFFFFF] px-[10px] py-1 pl-[32px] text-[14px] leading-[22px] font-normal text-[#8F9BB3]/80 placeholder:text-[14px] placeholder:leading-[22px] placeholder:font-normal placeholder:text-[#8F9BB3]/80"
                placeholder={copy.searchPlaceholder}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-8 gap-1 rounded-[6px] border border-[#C5CEE0] bg-[#FFFFFF] px-3 py-1 text-[14px] leading-[22px] font-normal text-[#101426]"
              disabled
            >
              <Image src="/Icon/export.svg" alt="" width={14} height={14} />
              批量导入/导出
            </Button>

            {debugPageEnabled ? (
              <Button type="button" variant="outline" className="h-8 rounded-[8px] px-4" asChild>
                <Link href="/tagging/ip/classify">开发分类测试</Link>
              </Button>
            ) : null}

            <Button
              type="button"
              className="h-8 gap-1 rounded-[6px] border border-[#3366FF] bg-[#3366FF] px-3 py-1 text-[14px] leading-[22px] font-normal text-[#FFFFFF]"
              onClick={handleOpenCreate}
            >
              <Image src="/Icon/white-plus.svg" alt="" width={14} height={14} />
              {copy.create}
            </Button>
          </div>
        </div>

        <div className="mt-[20px] flex min-h-0 flex-1 flex-col gap-[10px]">
          {isLibraryCompletelyEmpty ? (
            <div className="flex min-h-[calc(100dvh-280px)] flex-1 items-center justify-center px-6 py-10">
              <div className="text-center">
                <Image
                  width={171}
                  height={120}
                  src="/emptyData.svg"
                  alt=""
                  className="mx-auto h-[120px] w-auto"
                />
                <p className="mt-4 text-sm leading-5 text-basic-5">{emptyText}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex min-h-[64px] flex-wrap items-center gap-3 rounded-[8px] border border-[#E4E9F2] bg-background px-5 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-[12px]">
                  <Checkbox
                    className="size-4 border-[#C5CEE0] data-[state=checked]:border-[#3366FF] data-[state=checked]:bg-[#3366FF]"
                    checked={allSelectedOnPage}
                    indeterminate={someSelectedOnPage}
                    onCheckedChange={(checked) => handleSelectAllOnPage(Boolean(checked))}
                  />
                  <span className="text-[14px] leading-[20px] font-normal text-[#2E3A59]">
                    {hasSelection ? (
                      <>
                        选中 <span className="text-[#3366FF]">{selectedIds.length}</span> /{" "}
                        {filteredIps.length} 项
                      </>
                    ) : (
                      <>全部 {filteredIps.length} 项</>
                    )}
                  </span>

                  {hasSelection ? (
                    <div className="mr-1 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1 rounded-[6px] border border-[#3366FF] bg-[#3366FF] px-3 py-1 text-[14px] leading-[22px] font-normal text-white"
                        onClick={() => setBatchEnableOpen(true)}
                        disabled={isPending}
                      >
                        <Check className="h-[14px] w-[14px]" />
                        启用
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 rounded-[6px] border border-[#FF3D71] bg-white px-3 py-1 text-[14px] leading-[22px] font-normal text-[#FF3D71] hover:bg-[#FFF2F5] hover:text-[#FF3D71]"
                        onClick={() => setBatchDisableOpen(true)}
                        disabled={isPending}
                      >
                        <X className="h-[14px] w-[14px]" />
                        禁用
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1 rounded-[6px] border border-[#FF3D71] bg-white px-3 py-1 text-[14px] leading-[22px] font-normal text-[#FF3D71] hover:bg-[#FFF2F5] hover:text-[#FF3D71]"
                        onClick={() => setBatchDeleteOpen(true)}
                        disabled={isPending}
                      >
                        <Image src="/Icon/Delete.svg" alt="" width={14} height={14} />
                        删除
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="flex w-full flex-wrap items-center gap-3 md:ml-auto md:w-auto">
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger
                      size="sm"
                      className="h-8 justify-end gap-2 rounded-[6px] border border-[#C5CEE0] px-3 py-1 text-[14px] font-normal text-[#192038]"
                    >
                      <SelectValue placeholder="全部类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部类型</SelectItem>
                      {ipTypes.map((type) => (
                        <SelectItem key={type.id} value={String(type.id)}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger
                      size="sm"
                      className="h-8 justify-end gap-2 rounded-[6px] border border-[#C5CEE0] px-3 py-1 text-[14px] font-normal text-[#192038]"
                    >
                      <SelectValue placeholder="全部处理状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部处理状态</SelectItem>
                      <SelectItem value="completed">已完成</SelectItem>
                      <SelectItem value="processing">处理中</SelectItem>
                      <SelectItem value="failed">已失败</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={enabledFilter} onValueChange={setEnabledFilter}>
                    <SelectTrigger
                      size="sm"
                      className="h-8 justify-end gap-2 rounded-[6px] border border-[#C5CEE0] px-3 py-1 text-[14px] font-normal text-[#192038]"
                    >
                      <SelectValue placeholder="全部启用状态" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部启用状态</SelectItem>
                      <SelectItem value="enabled">已启用</SelectItem>
                      <SelectItem value="disabled">已禁用</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={sortOrder}
                    onValueChange={(value) =>
                      setSortOrder(value as "newest" | "oldest" | "name-asc" | "name-desc")
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="h-8 justify-end gap-2 rounded-[6px] border border-[#C5CEE0] px-3 py-1 text-[14px] font-normal text-[#192038]"
                    >
                      <SelectValue placeholder="最新创建" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">最新创建</SelectItem>
                      <SelectItem value="oldest">最早创建</SelectItem>
                      <SelectItem value="name-asc">名称 A-Z</SelectItem>
                      <SelectItem value="name-desc">名称 Z-A</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex min-h-[calc(100dvh-280px)] flex-1 flex-col rounded-[8px] border bg-background">
                {filteredIps.length === 0 ? (
                  <div className="flex min-h-[420px] flex-1 items-center justify-center px-6 py-10">
                    <div className="text-center">
                      <Image
                        width={171}
                        height={120}
                        src="/emptyData.svg"
                        alt=""
                        className="mx-auto h-[120px] w-auto"
                      />
                      <p className="mt-4 text-sm leading-5 text-basic-5">{emptyText}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex-1 overflow-x-auto">
                      <table className="min-w-full table-fixed [&_th]:font-medium [&_th]:leading-5 [&_th]:align-middle [&_td]:leading-5 [&_td]:align-middle">
                        <thead>
                          <tr className="h-[45px] border-b text-left text-[14px] leading-[20px] text-[#8F9BB3]">
                            <th className="w-[52px] px-6 py-0"></th>
                            <th className="w-[320px] px-4 py-0">IP 形象名称</th>
                            <th className="w-[180px] px-4 py-0">IP 类型</th>
                            <th className="w-[220px] px-4 py-0">IP 图片</th>
                            <th className="w-[320px] px-4 py-0">关联标签</th>
                            <th className="w-[160px] px-4 py-0">处理状态</th>
                            <th className="w-[140px] px-4 py-0">启用状态</th>
                            <th className="w-[190px] px-4 py-0">创建时间</th>
                            <th className="w-[90px] px-4 py-0 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentPageIps.map((ip) => {
                            const statusMeta = getIpStatusMeta(ip.status);
                            const pending = pendingIpIds.includes(ip.id) || isPending;
                            const StatusIcon = statusMeta.icon;
                            const failedReason =
                              getProcessingErrorMessage(ip.processingError) ?? "未知错误";
                            const subtitle = ip.description || ip.notes;

                            return (
                              <tr key={ip.id} className="h-[58px] border-b last:border-b-0">
                                <td className="h-[58px] px-6 py-0 align-middle">
                                  <Checkbox
                                    className="border-[#C5CEE0] data-[state=checked]:border-[#3366FF] data-[state=checked]:bg-[#3366FF]"
                                    checked={selectedIds.includes(ip.id)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setSelectedIds((current) =>
                                          current.includes(ip.id) ? current : [...current, ip.id],
                                        );
                                        return;
                                      }

                                      setSelectedIds((current) =>
                                        current.filter((id) => id !== ip.id),
                                      );
                                    }}
                                  />
                                </td>
                                <td className="h-[58px] px-4 pt-3 pb-2 align-top">
                                  <div className="flex items-start gap-3">
                                    <div className="h-[30px] w-[30px] self-center overflow-hidden rounded-[4px] bg-basic-2">
                                      {ip.images[0] ? (
                                        <IpImageHoverCard
                                          image={ip.images[0]}
                                          alt={`${ip.name} IP 图`}
                                        >
                                          <button
                                            type="button"
                                            className="h-full w-full overflow-hidden"
                                            aria-label={`预览 ${ip.name} IP 图`}
                                          >
                                            <SignedIpImage
                                              imageId={ip.images[0].id}
                                              signedUrl={ip.images[0].signedUrl}
                                              signedUrlExpiresAt={ip.images[0].signedUrlExpiresAt}
                                              alt={`${ip.name} IP 图`}
                                              className="h-full w-full object-cover"
                                            />
                                          </button>
                                        </IpImageHoverCard>
                                      ) : null}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-[14px] leading-[20px] font-medium text-basic-8">
                                        {ip.name}
                                      </div>
                                      {subtitle ? (
                                        // show first 3 lines of subtitle
                                        <p className="mt-1.5 line-clamp-3 text-sm leading-[20px] text-basic-5">
                                          {subtitle}
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle text-[14px] text-basic-8">
                                  {ip.ipTypeName}
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle">
                                  <IpImagesCell ip={ip} />
                                </td>
                                <td
                                  className={`h-[58px] px-4 align-middle ${ip.tags.length > 1 ? "py-2" : "py-0"}`}
                                >
                                  <div className="flex flex-wrap gap-2">
                                    {ip.tags.length > 0 ? (
                                      ip.tags.map((tag) => (
                                        <span
                                          key={tag.id}
                                          className="inline-flex items-center rounded-[4px] border border-[#C5CEE0] px-[6px] py-[3px] text-[12px] font-normal leading-[16px] text-[#101426]"
                                        >
                                          {tag.tagPath.join(" > ")}
                                        </span>
                                      ))
                                    ) : (
                                      <span className="text-sm text-basic-5">未关联标签</span>
                                    )}
                                  </div>
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle">
                                  <div
                                    className={`flex items-center ${ip.status === "failed" ? "gap-[8px]" : "gap-3"}`}
                                  >
                                    {ip.status === "failed" ? (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span
                                            className={`inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-[4px] border px-[6px] py-[3px] text-xs ${statusMeta.className}`}
                                          >
                                            <StatusIcon className="size-3.5" />
                                            {statusMeta.label}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" sideOffset={8}>
                                          {`无法提取有效特征：${failedReason}`}
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span
                                        className={`inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-[4px] border px-[6px] py-[3px] text-xs ${statusMeta.className}`}
                                      >
                                        <StatusIcon
                                          className={
                                            statusMeta.label === "处理中"
                                              ? "size-3.5 animate-spin"
                                              : "size-3.5"
                                          }
                                        />
                                        {statusMeta.label}
                                      </span>
                                    )}
                                    {ip.status === "failed" ? (
                                      <button
                                        type="button"
                                        className="whitespace-nowrap text-[12px] leading-[16px] font-normal text-[#3366FF] transition-colors hover:text-[#1d55d1] disabled:cursor-not-allowed disabled:text-basic-5"
                                        onClick={() => handleRetryProcessing(ip)}
                                        disabled={pending}
                                      >
                                        {copy.retry}
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle">
                                  <Switch
                                    checked={ip.enabled}
                                    onCheckedChange={(checked) =>
                                      checked ? handleToggleEnabled(ip, true) : setDisableTarget(ip)
                                    }
                                    disabled={pending}
                                    className="h-4 w-7 data-[state=checked]:bg-[#3366FF] [&_[data-slot=switch-thumb]]:size-3 [&_[data-slot=switch-thumb]]:data-[state=checked]:translate-x-[calc(100%+2px)] [&_[data-slot=switch-thumb]]:data-[state=unchecked]:translate-x-[2px]"
                                  />
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle whitespace-nowrap text-[14px] text-basic-8">
                                  {formatDate(ip.createdAt, locale)}
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle text-right">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" disabled={pending}>
                                        <MoreHorizontal className="size-4 text-basic-5" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent
                                      align="end"
                                      className="w-[120px] rounded-[6px] border border-[#E4E9F2] p-1"
                                    >
                                      <DropdownMenuItem
                                        onClick={() => handleOpenEdit(ip)}
                                        className="gap-2 px-[10px] py-[5px] text-[14px] font-normal leading-[22px] text-[#192038]"
                                      >
                                        <Image
                                          src="/Icon/Edit.svg"
                                          alt=""
                                          width={14}
                                          height={14}
                                          aria-hidden="true"
                                        />
                                        编辑
                                      </DropdownMenuItem>
                                      <div className="my-1 h-px bg-[#E4E9F2]" />
                                      <DropdownMenuItem
                                        onClick={() => setDeleteTarget(ip)}
                                        className="gap-2 px-[10px] py-[5px] text-[14px] font-normal leading-[22px] text-[#FF3D71] focus:text-[#FF3D71]"
                                      >
                                        <Image
                                          src="/Icon/Delete.svg"
                                          alt=""
                                          width={14}
                                          height={14}
                                          aria-hidden="true"
                                        />
                                        删除
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-auto flex flex-col gap-4 border-t px-6 py-4 xl:flex-row xl:items-center xl:justify-between">
                      <Input
                        value={pageInput}
                        onChange={(event) => setPageInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            handlePageJump();
                          }
                        }}
                        placeholder={tReview("pageInputPlaceholder")}
                        className="h-8 w-[180px] rounded-[6px] border border-[#C5CEE0] px-3 py-[5px] gap-1"
                      />

                      <div className="flex items-center gap-3 self-end">
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 border-0 shadow-none hover:bg-transparent"
                            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                            disabled={safeCurrentPage <= 1}
                          >
                            <ChevronLeft className="size-4" />
                          </Button>
                          <div className="inline-flex h-8 min-w-8 items-center justify-center rounded-[8px] border border-[#3366FF] px-3 text-sm text-[#3366FF]">
                            {safeCurrentPage}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 border-0 shadow-none hover:bg-transparent"
                            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                            disabled={safeCurrentPage >= totalPages}
                          >
                            <ChevronRight className="size-4" />
                          </Button>
                        </div>
                        <Select
                          value={String(pageSize)}
                          onValueChange={(value) => setPageSize(Number(value))}
                        >
                          <SelectTrigger size="sm" className="h-8 min-w-[110px] rounded-[8px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="20">20条/页</SelectItem>
                            <SelectItem value="40">40条/页</SelectItem>
                            <SelectItem value="80">80条/页</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <IpDialog
        open={dialogOpen}
        mode={dialogMode}
        ip={activeIp}
        ipTypes={ipTypes}
        usedIpTypeIds={usedIpTypeIds}
        tags={initialData.tags}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen);
          if (!nextOpen) {
            setActiveIp(null);
          }
        }}
        onSaved={handleDialogSaved}
        onIpTypesChange={setIpTypes}
        onIpTypeRenamed={handleTypeRenamed}
        onIpTypeDeleted={handleTypeDeleted}
      />

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>操作提示</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `确定要删除“${deleteTarget.name}”吗？删除后将无法恢复，已打上的关联标签不会自动移除。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleDeleteIp}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(disableTarget)}
        onOpenChange={(open) => !open && setDisableTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>操作提示</AlertDialogTitle>
            <AlertDialogDescription>
              {disableTarget
                ? `确定要禁用“${disableTarget.name}”吗？禁用后，新上传的素材将不会自动识别该条目并打上关联标签，已完成打标的素材不受影响。`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleConfirmDisableIp}>
              确认禁用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>批量删除IP形象</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除选中的 {selectedIds.length}{" "}
              个条目吗？删除后将无法恢复，已打上的关联标签不会自动移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleBatchDeleteSelected}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchEnableOpen} onOpenChange={setBatchEnableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>操作提示</AlertDialogTitle>
            <AlertDialogDescription>
              确定要启用选中的 {selectedIds.length} 个条目吗？启用后，将参与AI自动识别和打标
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchEnableSelected}>确认启用</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDisableOpen} onOpenChange={setBatchDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>操作提示</AlertDialogTitle>
            <AlertDialogDescription>
              确定要禁用选中的 {selectedIds.length}{" "}
              个条目吗？禁用后，新上传的素材将不会自动识别该条目并打上关联标签，已完成打标的素材不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleBatchDisableSelected}>
              确认禁用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
