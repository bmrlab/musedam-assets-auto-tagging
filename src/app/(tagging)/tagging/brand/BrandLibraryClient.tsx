"use client";

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
import Image from "next/image";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  MoreVertical,
  Plus,
  Search,
  Upload,
  XCircle,
} from "lucide-react";
import { useDeferredValue, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  deleteAssetLogoAction,
  pollBrandLogosAction,
  retryAssetLogoProcessingAction,
  setAssetLogoEnabledAction,
} from "./actions";
import BrandImageHoverCard from "./BrandImageHoverCard";
import BrandLogoDialog from "./BrandLogoDialog";
import SignedBrandImage from "./SignedBrandImage";
import { BrandLibraryPageData, BrandLogoItem } from "./types";

function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(date));
}

function getLogoStatusMeta(status: BrandLogoItem["status"]) {
  switch (status) {
    case "completed":
      return {
        label: "已完成",
        icon: CheckCircle2,
        className: "border-[#8ee0a8] bg-[#f3fff7] text-[#08b34d]",
      };
    case "processing":
      return {
        label: "处理中",
        icon: LoaderCircle,
        className: "border-[#9fc0ff] bg-[#f5f9ff] text-[#3370ff]",
      };
    case "failed":
      return {
        label: "已失败",
        icon: XCircle,
        className: "border-[#ff9ca8] bg-[#fff6f7] text-[#ff4d6a]",
      };
    default:
      return {
        label: "待处理",
        icon: Clock3,
        className: "border-[#d9e2f2] bg-[#f7f9fc] text-basic-5",
      };
  }
}

function LogoImagesCell({ logo }: { logo: BrandLogoItem }) {
  const previewImages = logo.images;

  if (previewImages.length === 0) {
    return <span className="text-sm text-basic-5">-</span>;
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center">
        {previewImages.map((image, index) => (
          <BrandImageHoverCard
            key={image.id}
            image={image}
            alt={`${logo.name} 标识图 ${index + 1}`}
          >
            <button
              type="button"
              className="relative -ml-2 first:ml-0 h-7 w-7 overflow-hidden rounded-[6px] border border-white bg-basic-2 shadow-sm"
              style={{ zIndex: previewImages.length - index }}
              aria-label={`预览 ${logo.name} 标识图 ${index + 1}`}
            >
              <SignedBrandImage
                imageId={image.id}
                signedUrl={image.signedUrl}
                signedUrlExpiresAt={image.signedUrlExpiresAt}
                alt={`${logo.name} 标识图 ${index + 1}`}
                className="h-full w-full object-cover"
              />
            </button>
          </BrandImageHoverCard>
        ))}
      </div>
      <span className="text-sm text-basic-5">{logo.images.length}张</span>
    </div>
  );
}

export default function BrandLibraryClient({ initialData }: { initialData: BrandLibraryPageData }) {
  const t = useTranslations("Tagging.BrandLibrary");
  const [logos, setLogos] = useState(initialData.logos);
  const [logoTypes, setLogoTypes] = useState(initialData.logoTypes);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [enabledFilter, setEnabledFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [pageSize, setPageSize] = useState(40);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [activeLogo, setActiveLogo] = useState<BrandLogoItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandLogoItem | null>(null);
  const [pendingLogoIds, setPendingLogoIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearch, typeFilter, statusFilter, enabledFilter, sortOrder, pageSize]);

  useEffect(() => {
    if (typeFilter !== "all" && !logoTypes.some((type) => String(type.id) === typeFilter)) {
      setTypeFilter("all");
    }
  }, [logoTypes, typeFilter]);

  const filteredLogos = logos
    .filter((logo) => {
      if (deferredSearch && !logo.name.toLowerCase().includes(deferredSearch)) {
        return false;
      }

      if (typeFilter !== "all" && String(logo.logoTypeId ?? "") !== typeFilter) {
        return false;
      }

      if (statusFilter !== "all" && logo.status !== statusFilter) {
        return false;
      }

      if (enabledFilter === "enabled" && !logo.enabled) {
        return false;
      }

      if (enabledFilter === "disabled" && logo.enabled) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      return sortOrder === "newest" ? rightTime - leftTime : leftTime - rightTime;
    });

  const totalPages = Math.max(1, Math.ceil(filteredLogos.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const currentPageLogos = filteredLogos.slice(pageStart, pageStart + pageSize);
  const currentPageIds = currentPageLogos.map((logo) => logo.id);
  const selectedOnPage = currentPageIds.filter((id) => selectedIds.includes(id));
  const allSelectedOnPage = currentPageIds.length > 0 && selectedOnPage.length === currentPageIds.length;
  const someSelectedOnPage = selectedOnPage.length > 0 && !allSelectedOnPage;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    const pendingIds = logos
      .filter((logo) => logo.status === "processing" || logo.status === "pending")
      .map((logo) => logo.id);

    if (pendingIds.length === 0) {
      return;
    }

    let disposed = false;

    async function poll() {
      const result = await pollBrandLogosAction(pendingIds);
      if (!result.success || disposed) {
        return;
      }

      setLogos((current) =>
        current.map((logo) => result.data.logos.find((item) => item.id === logo.id) ?? logo),
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
  }, [logos]);

  function getProcessingErrorMessage(error: string | null) {
    if (!error) {
      return null;
    }

    switch (error) {
      case "logo_not_found":
        return t("processingErrors.logoNotFound");
      case "no_reference_images":
        return t("processingErrors.noReferenceImages");
      case "image_fetch_failed":
        return t("processingErrors.imageFetchFailed");
      case "jina_request_failed":
        return t("processingErrors.jinaRequestFailed");
      case "embedding_count_mismatch":
        return t("processingErrors.embeddingCountMismatch");
      case "vector_store_sync_failed":
        return t("processingErrors.vectorStoreSyncFailed");
      case "unknown":
        return t("processingErrors.unknown");
      default:
        return error;
    }
  }

  function updateLogoInList(nextLogo: BrandLogoItem) {
    setLogos((current) => {
      const existing = current.some((logo) => logo.id === nextLogo.id);
      if (!existing) {
        return [nextLogo, ...current];
      }

      return current.map((logo) => (logo.id === nextLogo.id ? nextLogo : logo));
    });
  }

  function handleDialogSaved(logo: BrandLogoItem) {
    updateLogoInList(logo);
    setDialogOpen(false);
    setActiveLogo(null);
  }

  function handleOpenCreate() {
    setDialogMode("create");
    setActiveLogo(null);
    setDialogOpen(true);
  }

  function handleOpenEdit(logo: BrandLogoItem) {
    setDialogMode("edit");
    setActiveLogo(logo);
    setDialogOpen(true);
  }

  function markLogoPending(logoId: string, pending: boolean) {
    setPendingLogoIds((current) => {
      if (pending) {
        if (current.includes(logoId)) {
          return current;
        }
        return [...current, logoId];
      }

      return current.filter((id) => id !== logoId);
    });
  }

  function handleToggleEnabled(logo: BrandLogoItem, enabled: boolean) {
    markLogoPending(logo.id, true);

    startTransition(async () => {
      const result = await setAssetLogoEnabledAction(logo.id, enabled);
      markLogoPending(logo.id, false);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      updateLogoInList(result.data.logo);
      toast.success(enabled ? "品牌标识已启用" : "品牌标识已停用");
    });
  }

  function handleDeleteLogo() {
    if (!deleteTarget) {
      return;
    }

    markLogoPending(deleteTarget.id, true);

    startTransition(async () => {
      const result = await deleteAssetLogoAction(deleteTarget.id);
      markLogoPending(deleteTarget.id, false);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      setLogos((current) => current.filter((logo) => logo.id !== deleteTarget.id));
      setSelectedIds((current) => current.filter((id) => id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("品牌标识已删除");
    });
  }

  function handleRetryProcessing(logo: BrandLogoItem) {
    markLogoPending(logo.id, true);

    startTransition(async () => {
      const result = await retryAssetLogoProcessingAction(logo.id);
      markLogoPending(logo.id, false);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      updateLogoInList(result.data.logo);
      toast.success(t("retryStarted"));
    });
  }

  function handleTypeRenamed(typeId: string, name: string) {
    setLogos((current) =>
      current.map((logo) => (logo.logoTypeId === typeId ? { ...logo, logoTypeName: name } : logo)),
    );
  }

  function handleTypeDeleted(typeId: string) {
    setLogos((current) => current.map((logo) => (logo.logoTypeId === typeId ? logo : logo)));
  }

  function handleSelectAllOnPage(checked: boolean) {
    if (checked) {
      setSelectedIds((current) => Array.from(new Set([...current, ...currentPageIds])));
      return;
    }

    setSelectedIds((current) => current.filter((id) => !currentPageIds.includes(id)));
  }

  function handlePageJump() {
    const nextPage = Number(pageInput);
    if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > totalPages) {
      return;
    }

    setCurrentPage(nextPage);
    setPageInput("");
  }

  const emptyText = deferredSearch || typeFilter !== "all" || statusFilter !== "all" || enabledFilter !== "all"
    ? "没有符合当前筛选条件的品牌标识"
    : t("empty");

  return (
    <>
      <div className="flex min-h-[620px] flex-1 flex-col py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-[28px] leading-[40px] font-semibold text-basic-8">{t("title")}</h2>
            <p className="mt-1 text-sm leading-5 text-basic-5">{t("description")}</p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row xl:w-auto">
            <div className="relative w-full sm:w-[320px]">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-basic-5" />
              <Input
                className="h-10 rounded-[8px] pl-10"
                placeholder={t("searchPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            <Button type="button" variant="outline" className="h-10 rounded-[8px] px-4" disabled>
              <Upload className="size-4" />
              {t("importExport")}
            </Button>

            <Button type="button" variant="outline" className="h-10 rounded-[8px] px-4" asChild>
              <Link href="/tagging/brand/classify">{t("devClassify")}</Link>
            </Button>

            <Button type="button" className="h-10 rounded-[8px] px-4" onClick={handleOpenCreate}>
              <Plus className="size-4" />
              {t("create")}
            </Button>
          </div>
        </div>

        <div className="mt-6 rounded-[16px] border bg-background">
          <div className="flex flex-col gap-4 border-b px-6 py-4 xl:flex-row xl:items-center xl:justify-between">
            <label className="inline-flex items-center gap-3 text-sm text-basic-8">
              <Checkbox
                checked={allSelectedOnPage}
                indeterminate={someSelectedOnPage}
                onCheckedChange={(checked) => handleSelectAllOnPage(Boolean(checked))}
              />
              全部 {filteredLogos.length} 项
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-10 min-w-[132px] rounded-[10px]">
                  <SelectValue placeholder="全部类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  {logoTypes.map((type) => (
                    <SelectItem key={type.id} value={String(type.id)}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 min-w-[160px] rounded-[10px]">
                  <SelectValue placeholder="全部处理状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部处理状态</SelectItem>
                  <SelectItem value="completed">已完成</SelectItem>
                  <SelectItem value="pending">待处理</SelectItem>
                  <SelectItem value="processing">处理中</SelectItem>
                  <SelectItem value="failed">已失败</SelectItem>
                </SelectContent>
              </Select>

              <Select value={enabledFilter} onValueChange={setEnabledFilter}>
                <SelectTrigger className="h-10 min-w-[160px] rounded-[10px]">
                  <SelectValue placeholder="全部启用状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部启用状态</SelectItem>
                  <SelectItem value="enabled">已启用</SelectItem>
                  <SelectItem value="disabled">已停用</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as "newest" | "oldest")}>
                <SelectTrigger className="h-10 min-w-[124px] rounded-[10px]">
                  <SelectValue placeholder="最新创建" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">最新创建</SelectItem>
                  <SelectItem value="oldest">最早创建</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filteredLogos.length === 0 ? (
            <div className="flex min-h-[420px] items-center justify-center px-6 py-10">
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
              <div className="overflow-x-auto">
                <table className="min-w-full table-fixed">
                  <thead>
                    <tr className="border-b text-left text-sm text-basic-5">
                      <th className="w-[52px] px-6 py-4"></th>
                      <th className="w-[320px] px-4 py-4">标识名称</th>
                      <th className="w-[180px] px-4 py-4">标识类型</th>
                      <th className="w-[220px] px-4 py-4">标识图片</th>
                      <th className="w-[320px] px-4 py-4">关联标签</th>
                      <th className="w-[160px] px-4 py-4">处理状态</th>
                      <th className="w-[140px] px-4 py-4">启用状态</th>
                      <th className="w-[190px] px-4 py-4">创建时间</th>
                      <th className="w-[90px] px-4 py-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentPageLogos.map((logo) => {
                      const statusMeta = getLogoStatusMeta(logo.status);
                      const pending = pendingLogoIds.includes(logo.id) || isPending;
                      const StatusIcon = statusMeta.icon;

                      return (
                        <tr key={logo.id} className="border-b last:border-b-0">
                          <td className="px-6 py-5 align-top">
                            <Checkbox
                              checked={selectedIds.includes(logo.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedIds((current) =>
                                    current.includes(logo.id) ? current : [...current, logo.id],
                                  );
                                  return;
                                }

                                setSelectedIds((current) => current.filter((id) => id !== logo.id));
                              }}
                            />
                          </td>
                          <td className="px-4 py-5 align-top">
                            <div className="flex items-start gap-3">
                              <div className="mt-0.5 h-10 w-10 overflow-hidden rounded-[10px] bg-basic-2">
                                {logo.images[0] ? (
                                  <BrandImageHoverCard image={logo.images[0]} alt={`${logo.name} 标识图`}>
                                    <button
                                      type="button"
                                      className="h-full w-full overflow-hidden"
                                      aria-label={`预览 ${logo.name} 标识图`}
                                    >
                                      <SignedBrandImage
                                        imageId={logo.images[0].id}
                                        signedUrl={logo.images[0].signedUrl}
                                        signedUrlExpiresAt={logo.images[0].signedUrlExpiresAt}
                                        alt={`${logo.name} 标识图`}
                                        className="h-full w-full object-cover"
                                      />
                                    </button>
                                  </BrandImageHoverCard>
                                ) : null}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[18px] font-medium leading-7 text-basic-8">
                                  {logo.name}
                                </div>
                                {logo.notes ? (
                                  <p className="mt-1 line-clamp-2 text-sm text-basic-5">{logo.notes}</p>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-5 align-top text-[15px] text-basic-8">{logo.logoTypeName}</td>
                          <td className="px-4 py-5 align-top">
                            <LogoImagesCell logo={logo} />
                          </td>
                          <td className="px-4 py-5 align-top">
                            <div className="flex flex-wrap gap-2">
                              {logo.tags.length > 0 ? (
                                logo.tags.map((tag) => (
                                  <span
                                    key={tag.id}
                                    className="inline-flex rounded-[8px] border border-[#d9e2f2] bg-[#f7f9fc] px-3 py-1 text-sm text-basic-8"
                                  >
                                    {tag.tagPath.join(" > ")}
                                  </span>
                                ))
                              ) : (
                                <span className="text-sm text-basic-5">未关联标签</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-5 align-top">
                            <div className="space-y-2">
                              <div className="flex items-center gap-3">
                                <span
                                  className={`inline-flex items-center gap-1 rounded-[8px] border px-3 py-1 text-sm ${statusMeta.className}`}
                                >
                                  <StatusIcon className={statusMeta.label === "处理中" ? "size-4 animate-spin" : "size-4"} />
                                  {statusMeta.label}
                                </span>
                                {logo.status === "failed" ? (
                                  <button
                                    type="button"
                                    className="text-sm font-medium text-[#3370ff] transition-colors hover:text-[#1d55d1] disabled:cursor-not-allowed disabled:text-basic-5"
                                    onClick={() => handleRetryProcessing(logo)}
                                    disabled={pending}
                                  >
                                    {t("retry")}
                                  </button>
                                ) : null}
                              </div>
                              {logo.status === "failed" && logo.processingError ? (
                                <p className="text-xs leading-5 text-[#ff4d6a]">
                                  {getProcessingErrorMessage(logo.processingError)}
                                </p>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-5 align-top">
                            <Switch
                              checked={logo.enabled}
                              onCheckedChange={(checked) => handleToggleEnabled(logo, checked)}
                              disabled={pending}
                            />
                          </td>
                          <td className="px-4 py-5 align-top text-[15px] text-basic-8">
                            {formatDate(logo.createdAt)}
                          </td>
                          <td className="px-4 py-5 align-top text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" disabled={pending}>
                                  <MoreVertical className="size-4 text-basic-5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-32 rounded-[12px] p-2">
                                <DropdownMenuItem onClick={() => handleOpenEdit(logo)}>编辑</DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setDeleteTarget(logo)}
                                  className="text-danger-6 focus:text-danger-6"
                                >
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

              <div className="flex flex-col gap-4 border-t px-6 py-4 xl:flex-row xl:items-center xl:justify-between">
                <Input
                  value={pageInput}
                  onChange={(event) => setPageInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handlePageJump();
                    }
                  }}
                  placeholder="输入页数并回车跳转"
                  className="h-10 w-[230px] rounded-[8px]"
                />

                <div className="flex items-center gap-3 self-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={safeCurrentPage <= 1}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <div className="inline-flex min-w-10 items-center justify-center rounded-[8px] border border-primary px-3 py-2 text-sm text-primary">
                    {safeCurrentPage}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={safeCurrentPage >= totalPages}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                  <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                    <SelectTrigger className="h-10 min-w-[110px] rounded-[8px]">
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
            </>
          )}
        </div>
      </div>

      <BrandLogoDialog
        open={dialogOpen}
        mode={dialogMode}
        logo={activeLogo}
        logoTypes={logoTypes}
        tags={initialData.tags}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen);
          if (!nextOpen) {
            setActiveLogo(null);
          }
        }}
        onSaved={handleDialogSaved}
        onLogoTypesChange={setLogoTypes}
        onLogoTypeRenamed={handleTypeRenamed}
        onLogoTypeDeleted={handleTypeDeleted}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除品牌标识</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `确认删除“${deleteTarget.name}”吗？该操作为软删除，不会移除 OSS 中的图片资源。` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleDeleteLogo}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
