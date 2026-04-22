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
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
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

function getLogoStatusMeta(status: BrandLogoItem["status"], t: ReturnType<typeof useTranslations>) {
  switch (status) {
    case "completed":
      return {
        label: t("statusCompleted"),
        icon: CheckCircle2,
        className: "border-[#8cfac7] bg-[#edfff3] text-[#00e096]",
      };
    case "processing":
      return {
        label: t("statusProcessing"),
        icon: LoaderCircle,
        className: "border-[#c7e2ff] bg-[#f2f8ff] text-[#0095ff]",
      };
    case "failed":
      return {
        label: t("statusFailed"),
        icon: XCircle,
        className: "border-[#ffa8b4] bg-[#fff2f2] text-[#ff3d71]",
      };
    default:
      return {
        label: t("statusPending"),
        icon: Clock3,
        className: "border-[#d9e2f2] bg-[#f7f9fc] text-basic-5",
      };
  }
}

function LogoImagesCell({ logo, t }: { logo: BrandLogoItem; t: ReturnType<typeof useTranslations> }) {
  const previewImages = logo.images;

  if (previewImages.length === 0) {
    return <span className="text-[14px] text-basic-5">-</span>;
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center">
        {previewImages.map((image, index) => (
          <BrandImageHoverCard
            key={image.id}
            image={image}
            alt={t("imageAltIndex", { name: logo.name, index: index + 1 })}
          >
            <button
              type="button"
              className="relative -ml-2 first:ml-0 h-[22px] w-[22px] overflow-hidden rounded-[4px] border border-white bg-basic-2 shadow-sm"
              style={{ zIndex: previewImages.length - index }}
              aria-label={t("previewImage", { name: logo.name })}
            >
              <SignedBrandImage
                imageId={image.id}
                signedUrl={image.signedUrl}
                signedUrlExpiresAt={image.signedUrlExpiresAt}
                alt={t("imageAltIndex", { name: logo.name, index: index + 1 })}
                className="h-full w-full object-cover"
              />
            </button>
          </BrandImageHoverCard>
        ))}
      </div>
      <span className="text-[14px] text-basic-5">{t("imageCount", { count: logo.images.length })}</span>
    </div>
  );
}

export default function BrandLibraryClient({
  initialData,
  debugPageEnabled,
}: {
  initialData: BrandLibraryPageData;
  debugPageEnabled: boolean;
}) {
  const t = useTranslations("Tagging.BrandLibrary");
  const tReview = useTranslations("Tagging.Review");
  const [logos, setLogos] = useState(initialData.logos);
  const [logoTypes, setLogoTypes] = useState(initialData.logoTypes);
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
  const [activeLogo, setActiveLogo] = useState<BrandLogoItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandLogoItem | null>(null);
  const [disableTarget, setDisableTarget] = useState<BrandLogoItem | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchEnableOpen, setBatchEnableOpen] = useState(false);
  const [batchDisableOpen, setBatchDisableOpen] = useState(false);
  const [pendingLogoIds, setPendingLogoIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const usedLogoTypeIds = useMemo(
    () =>
      Array.from(
        new Set(
          logos
            .map((logo) => logo.logoTypeId)
            .filter((typeId): typeId is string => Boolean(typeId)),
        ),
      ),
    [logos],
  );

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

  const totalPages = Math.max(1, Math.ceil(filteredLogos.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const currentPageLogos = filteredLogos.slice(pageStart, pageStart + pageSize);
  const currentPageIds = currentPageLogos.map((logo) => logo.id);
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
      toast.success(enabled ? t("enabledSuccess") : t("disabledSuccess"));
    });
  }

  function handleConfirmDisableLogo() {
    if (!disableTarget) {
      return;
    }

    handleToggleEnabled(disableTarget, false);
    setDisableTarget(null);
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
      toast.success(t("deletedSuccess"));
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

  function handleBatchSetEnabled(enabled: boolean) {
    if (selectedIds.length === 0) {
      return;
    }

    const targetIds = [...selectedIds];
    targetIds.forEach((id) => markLogoPending(id, true));

    startTransition(async () => {
      const results = await Promise.all(
        targetIds.map(async (id) => {
          const result = await setAssetLogoEnabledAction(id, enabled);
          markLogoPending(id, false);
          return result;
        }),
      );

      const updatedLogos = results.filter((item) => item.success).map((item) => item.data.logo);
      if (updatedLogos.length > 0) {
        const updatedById = new Map(updatedLogos.map((logo) => [logo.id, logo]));
        setLogos((current) => current.map((logo) => updatedById.get(logo.id) ?? logo));
      }

      const failedCount = results.length - updatedLogos.length;
      if (failedCount === 0) {
        toast.success(enabled ? t("batchEnabledSuccess") : t("batchDisabledSuccess"));
        return;
      }

      if (updatedLogos.length > 0) {
        toast.warning(t("batchPartialSuccess", { success: updatedLogos.length, failed: failedCount }));
        return;
      }

      toast.error(enabled ? t("batchEnableFailed") : t("batchDisableFailed"));
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
    targetIds.forEach((id) => markLogoPending(id, true));

    startTransition(async () => {
      const results = await Promise.all(
        targetIds.map(async (id) => {
          const result = await deleteAssetLogoAction(id);
          markLogoPending(id, false);
          return { id, result };
        }),
      );

      const successIds = results.filter((item) => item.result.success).map((item) => item.id);
      if (successIds.length > 0) {
        const successIdSet = new Set(successIds);
        setLogos((current) => current.filter((logo) => !successIdSet.has(logo.id)));
        setSelectedIds((current) => current.filter((id) => !successIdSet.has(id)));
      }

      const failedCount = results.length - successIds.length;
      if (failedCount === 0) {
        toast.success(t("batchDeletedSuccess"));
      } else if (successIds.length > 0) {
        toast.warning(t("batchPartialSuccess", { success: successIds.length, failed: failedCount }));
      } else {
        toast.error(t("batchDeleteFailed"));
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
      ? t("emptyFiltered")
      : t("empty");
  const isLibraryCompletelyEmpty = logos.length === 0;

  return (
    <>
      <div className="flex min-h-[calc(100dvh-120px)] flex-1 flex-col pb-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-xl font-semibold">{t("title")}</h2>
            <p className="mt-1 text-sm leading-5 text-basic-5">{t("description")}</p>
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
                placeholder={t("searchPlaceholder")}
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
              {t("importExport")}
            </Button>

            {debugPageEnabled ? (
              <Button type="button" variant="outline" className="h-8 rounded-[8px] px-4" asChild>
                <Link href="/tagging/brand/classify">{t("devClassify")}</Link>
              </Button>
            ) : null}

            <Button
              type="button"
              className="h-8 gap-1 rounded-[6px] border border-[#3366FF] bg-[#3366FF] px-3 py-1 text-[14px] leading-[22px] font-normal text-[#FFFFFF]"
              onClick={handleOpenCreate}
            >
              <Image src="/Icon/white-plus.svg" alt="" width={14} height={14} />
              {t("create")}
            </Button>
          </div>
        </div>

        <div className="mt-[20px] flex min-h-0 flex-1 flex-col gap-[10px] ">
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
                        {t("itemsSelected")} <span className="text-[#3366FF]">{selectedIds.length}</span> /{" "}
                        {filteredLogos.length} {t("itemsCount")}
                      </>
                    ) : (
                      <>{t("itemsTotal")} {filteredLogos.length} {t("itemsCount")}</>
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
                        {t("enable")}
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
                        {t("disable")}
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
                        {t("delete")}
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
                      <SelectValue placeholder={t("allTypes")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("allTypes")}</SelectItem>
                      {logoTypes.map((type) => (
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
                      <SelectValue placeholder={t("allStatuses")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("allStatuses")}</SelectItem>
                      <SelectItem value="completed">{t("statusCompleted")}</SelectItem>
                      <SelectItem value="processing">{t("statusProcessing")}</SelectItem>
                      <SelectItem value="failed">{t("statusFailed")}</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={enabledFilter} onValueChange={setEnabledFilter}>
                    <SelectTrigger
                      size="sm"
                      className="h-8 justify-end gap-2 rounded-[6px] border border-[#C5CEE0] px-3 py-1 text-[14px] font-normal text-[#192038]"
                    >
                      <SelectValue placeholder={t("allEnabledStatuses")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("allEnabledStatuses")}</SelectItem>
                      <SelectItem value="enabled">{t("enabled")}</SelectItem>
                      <SelectItem value="disabled">{t("disabled")}</SelectItem>
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
                      <SelectValue placeholder={t("sortNewest")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">{t("sortNewest")}</SelectItem>
                      <SelectItem value="oldest">{t("sortOldest")}</SelectItem>
                      <SelectItem value="name-asc">{t("sortNameAsc")}</SelectItem>
                      <SelectItem value="name-desc">{t("sortNameDesc")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex min-h-[calc(100dvh-280px)] flex-1 flex-col rounded-[8px] border bg-background">
                {filteredLogos.length === 0 ? (
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
                            <th className="w-[320px] px-4 py-0">{t("columnLogoName")}</th>
                            <th className="w-[180px] px-4 py-0">{t("columnLogoType")}</th>
                            <th className="w-[220px] px-4 py-0">{t("columnLogoImages")}</th>
                            <th className="w-[320px] px-4 py-0">{t("columnLinkedTags")}</th>
                            <th className="w-[160px] px-4 py-0">{t("columnStatus")}</th>
                            <th className="w-[140px] px-4 py-0">{t("columnEnabled")}</th>
                            <th className="w-[190px] px-4 py-0">{t("columnCreatedAt")}</th>
                            <th className="w-[90px] px-4 py-0 text-right">{t("columnActions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentPageLogos.map((logo) => {
                            const statusMeta = getLogoStatusMeta(logo.status, t);
                            const pending = pendingLogoIds.includes(logo.id) || isPending;
                            const StatusIcon = statusMeta.icon;
                            const failedReason =
                              getProcessingErrorMessage(logo.processingError) ?? t("unknownError");

                            return (
                              <tr key={logo.id} className="h-[58px] border-b last:border-b-0">
                                <td className="h-[58px] px-6 py-0 align-middle">
                                  <Checkbox
                                    className="border-[#C5CEE0] data-[state=checked]:border-[#3366FF] data-[state=checked]:bg-[#3366FF]"
                                    checked={selectedIds.includes(logo.id)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setSelectedIds((current) =>
                                          current.includes(logo.id)
                                            ? current
                                            : [...current, logo.id],
                                        );
                                        return;
                                      }

                                      setSelectedIds((current) =>
                                        current.filter((id) => id !== logo.id),
                                      );
                                    }}
                                  />
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle">
                                  <div className="flex items-center gap-3">
                                    <div className="h-[30px] w-[30px] overflow-hidden rounded-[4px] bg-basic-2">
                                      {logo.images[0] ? (
                                        <BrandImageHoverCard
                                          image={logo.images[0]}
                                          alt={`${logo.name} 标识图`}
                                        >
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
                                      <div className="truncate text-[14px] leading-[20px] font-medium text-basic-8">
                                        {logo.name}
                                      </div>
                                      {logo.notes ? (
                                        <p className="mt-1 line-clamp-2 text-sm text-basic-5">
                                          {logo.notes}
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle text-[14px] text-basic-8">
                                  {logo.logoTypeName}
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle">
                                  <LogoImagesCell logo={logo} t={t} />
                                </td>
                                <td
                                  className={`h-[58px] px-4 align-middle ${
                                    logo.tags.length > 1 ? "py-2" : "py-0"
                                  }`}
                                >
                                  <div className="flex flex-wrap gap-2">
                                    {logo.tags.length > 0 ? (
                                      logo.tags.map((tag) => (
                                        <span
                                          key={tag.id}
                                          className="inline-flex items-center rounded-[4px] border border-[#C5CEE0] px-[6px] py-[3px] text-[12px] font-normal leading-[16px] text-[#101426]"
                                        >
                                          {tag.tagPath.join(" > ")}
                                        </span>
                                    ))
                                  ) : (
                                    <span className="text-sm text-basic-5">{t("noLinkedTags")}</span>
                                  )}
                                  </div>
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle">
                                  <div
                                    className={`flex items-center ${
                                      logo.status === "failed" ? "gap-[8px]" : "gap-3"
                                    }`}
                                  >
                                    {logo.status === "failed" ? (
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
                                          {t("processingErrorTooltip", { error: failedReason })}
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span
                                        className={`inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-[4px] border px-[6px] py-[3px] text-xs ${statusMeta.className}`}
                                      >
                                        <StatusIcon
                                          className={
                                            logo.status === "processing"
                                              ? "size-3.5 animate-spin"
                                              : "size-3.5"
                                          }
                                        />
                                        {statusMeta.label}
                                      </span>
                                    )}
                                    {logo.status === "failed" ? (
                                      <button
                                        type="button"
                                        className="whitespace-nowrap text-[12px] leading-[16px] font-normal text-[#3366FF] transition-colors hover:text-[#1d55d1] disabled:cursor-not-allowed disabled:text-basic-5"
                                        onClick={() => handleRetryProcessing(logo)}
                                        disabled={pending}
                                      >
                                        {t("retry")}
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle">
                                  <Switch
                                    checked={logo.enabled}
                                    onCheckedChange={(checked) =>
                                      checked
                                        ? handleToggleEnabled(logo, true)
                                        : setDisableTarget(logo)
                                    }
                                    disabled={pending}
                                    className="h-4 w-7 data-[state=checked]:bg-[#3366FF] [&_[data-slot=switch-thumb]]:size-3 [&_[data-slot=switch-thumb]]:data-[state=checked]:translate-x-[calc(100%+2px)] [&_[data-slot=switch-thumb]]:data-[state=unchecked]:translate-x-[2px]"
                                  />
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle whitespace-nowrap text-[14px] text-basic-8">
                                  {formatDate(logo.createdAt)}
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
                                        onClick={() => handleOpenEdit(logo)}
                                        className="gap-2 px-[10px] py-[5px] text-[14px] font-normal leading-[22px] text-[#192038]"
                                      >
                                        <Image
                                          src="/Icon/Edit.svg"
                                          alt=""
                                          width={14}
                                          height={14}
                                          aria-hidden="true"
                                        />
                                        {t("edit")}
                                      </DropdownMenuItem>
                                      <div className="my-1 h-px bg-[#E4E9F2]" />
                                      <DropdownMenuItem
                                        onClick={() => setDeleteTarget(logo)}
                                        className="gap-2 px-[10px] py-[5px] text-[14px] font-normal leading-[22px] text-[#FF3D71] focus:text-[#FF3D71]"
                                      >
                                        <Image
                                          src="/Icon/Delete.svg"
                                          alt=""
                                          width={14}
                                          height={14}
                                          aria-hidden="true"
                                        />
                                        {t("delete")}
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
                            <SelectItem value="20">{t("itemsPerPage20")}</SelectItem>
                            <SelectItem value="40">{t("itemsPerPage40")}</SelectItem>
                            <SelectItem value="80">{t("itemsPerPage80")}</SelectItem>
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

      <BrandLogoDialog
        open={dialogOpen}
        mode={dialogMode}
        logo={activeLogo}
        logoTypes={logoTypes}
        usedLogoTypeIds={usedLogoTypeIds}
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

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? t("confirmDialog.deleteDescription", { name: deleteTarget.name })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirmDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleDeleteLogo}>
              {t("confirmDialog.confirmDelete")}
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
            <AlertDialogTitle>{t("confirmDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {disableTarget
                ? t("confirmDialog.disableDescription", { name: disableTarget.name })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirmDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleConfirmDisableLogo}>
              {t("confirmDialog.confirmDisable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDeleteOpen} onOpenChange={setBatchDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("batchDialog.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("batchDialog.deleteDescription", { count: selectedIds.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("batchDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleBatchDeleteSelected}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchEnableOpen} onOpenChange={setBatchEnableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("batchDialog.enableTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("batchDialog.enableDescription", { count: selectedIds.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("batchDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchEnableSelected}>{t("batchDialog.confirmEnable")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDisableOpen} onOpenChange={setBatchDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("batchDialog.disableTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("batchDialog.disableDescription", { count: selectedIds.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("batchDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleBatchDisableSelected}>
              {t("batchDialog.confirmDisable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
