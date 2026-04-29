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
import { MAX_PREVIEW_IMAGE_NUM } from "../brand/BrandLibraryClient";
import {
  deleteAssetPersonAction,
  pollPersonsAction,
  retryAssetPersonProcessingAction,
  setAssetPersonEnabledAction,
} from "./actions";
import PersonDialog from "./PersonDialog";
import PersonImageHoverCard from "./PersonImageHoverCard";
import SignedPersonImage from "./SignedPersonImage";
import { PersonItem, PersonLibraryPageData } from "./types";

type TranslationFunction = (key: string, values?: Record<string, string | number>) => string;

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

function getPersonStatusMeta(status: PersonItem["status"], t: TranslationFunction) {
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

function PersonImagesCell({
  person,
  t,
}: {
  person: PersonItem;
  t: TranslationFunction;
}) {
  const previewImages = person.images.slice(0, MAX_PREVIEW_IMAGE_NUM);

  if (person.images.length === 0) {
    return <span className="text-[14px] text-basic-5">-</span>;
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center">
        {previewImages.map((image, index) => (
          <PersonImageHoverCard
            key={image.id}
            image={image}
            alt={t("imageAltIndex", { name: person.name, index: index + 1 })}
          >
            <button
              type="button"
              className="relative -ml-2 first:ml-0 h-[22px] w-[22px] overflow-hidden rounded-[4px] border border-white bg-basic-2 shadow-sm"
              style={{ zIndex: previewImages.length - index }}
              aria-label={t("previewImage", { name: person.name, index: index + 1 })}
            >
              <SignedPersonImage
                imageId={image.id}
                signedUrl={image.signedUrl}
                signedUrlExpiresAt={image.signedUrlExpiresAt}
                alt={t("imageAltIndex", { name: person.name, index: index + 1 })}
                className="h-full w-full object-cover"
              />
            </button>
          </PersonImageHoverCard>
        ))}
      </div>
      <span className="text-[14px] text-basic-5">
        {t("imageCount", { count: person.images.length })}
      </span>
    </div>
  );
}

export default function PersonLibraryClient({
  initialData,
  debugPageEnabled,
}: {
  initialData: PersonLibraryPageData;
  debugPageEnabled: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("Tagging.PersonLibrary") as TranslationFunction;
  const tReview = useTranslations("Tagging.Review") as TranslationFunction;
  const [persons, setPersons] = useState(initialData.persons);
  const [personTypes, setPersonTypes] = useState(initialData.personTypes);
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
  const [activePerson, setActivePerson] = useState<PersonItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PersonItem | null>(null);
  const [disableTarget, setDisableTarget] = useState<PersonItem | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchEnableOpen, setBatchEnableOpen] = useState(false);
  const [batchDisableOpen, setBatchDisableOpen] = useState(false);
  const [pendingPersonIds, setPendingPersonIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const usedPersonTypeIds = useMemo(
    () =>
      Array.from(
        new Set(
          persons
            .map((person) => person.personTypeId)
            .filter((typeId): typeId is string => Boolean(typeId)),
        ),
      ),
    [persons],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearch, typeFilter, statusFilter, enabledFilter, sortOrder, pageSize]);

  useEffect(() => {
    if (typeFilter !== "all" && !personTypes.some((type) => String(type.id) === typeFilter)) {
      setTypeFilter("all");
    }
  }, [personTypes, typeFilter]);

  const filteredPersons = persons
    .filter((person) => {
      if (deferredSearch && !person.name.toLowerCase().includes(deferredSearch)) {
        return false;
      }

      if (typeFilter !== "all" && String(person.personTypeId ?? "") !== typeFilter) {
        return false;
      }

      if (statusFilter !== "all" && person.status !== statusFilter) {
        return false;
      }

      if (enabledFilter === "enabled" && !person.enabled) {
        return false;
      }

      if (enabledFilter === "disabled" && person.enabled) {
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

  const totalPages = Math.max(1, Math.ceil(filteredPersons.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const currentPagePersons = filteredPersons.slice(pageStart, pageStart + pageSize);
  const currentPageIds = currentPagePersons.map((person) => person.id);
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
    const pendingIds = persons
      .filter((person) => person.status === "processing" || person.status === "pending")
      .map((person) => person.id);

    if (pendingIds.length === 0) {
      return;
    }

    let disposed = false;

    async function poll() {
      const result = await pollPersonsAction(pendingIds);
      if (!result.success || disposed) {
        return;
      }

      setPersons((current) =>
        current.map((person) => result.data.persons.find((item) => item.id === person.id) ?? person),
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
  }, [persons]);

  function getProcessingErrorMessage(error: string | null) {
    if (!error) {
      return null;
    }

    switch (error) {
      case "person_not_found":
        return t("processingErrors.personNotFound");
      case "no_reference_images":
        return t("processingErrors.noReferenceImages");
      case "face_count_not_one":
        return t("processingErrors.faceCountNotOne");
      case "face_detection_failed":
        return t("processingErrors.faceDetectionFailed");
      case "generate_embedding_failed":
        return t("processingErrors.generateEmbeddingFailed");
      case "vector_store_sync_failed":
        return t("processingErrors.vectorStoreSyncFailed");
      case "unknown":
        return t("processingErrors.unknown");
      default:
        return error;
    }
  }

  function updatePersonInList(nextPerson: PersonItem) {
    setPersons((current) => {
      const existing = current.some((person) => person.id === nextPerson.id);
      if (!existing) {
        return [nextPerson, ...current];
      }

      return current.map((person) => (person.id === nextPerson.id ? nextPerson : person));
    });
  }

  function handleDialogSaved(person: PersonItem) {
    updatePersonInList(person);
    setDialogOpen(false);
    setActivePerson(null);
  }

  function handleOpenCreate() {
    setDialogMode("create");
    setActivePerson(null);
    setDialogOpen(true);
  }

  function handleOpenEdit(person: PersonItem) {
    setDialogMode("edit");
    setActivePerson(person);
    setDialogOpen(true);
  }

  function markPersonPending(personId: string, pending: boolean) {
    setPendingPersonIds((current) => {
      if (pending) {
        if (current.includes(personId)) {
          return current;
        }
        return [...current, personId];
      }

      return current.filter((id) => id !== personId);
    });
  }

  function handleToggleEnabled(person: PersonItem, enabled: boolean) {
    markPersonPending(person.id, true);

    startTransition(async () => {
      const result = await setAssetPersonEnabledAction(person.id, enabled);
      markPersonPending(person.id, false);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      updatePersonInList(result.data.person);
      toast.success(enabled ? t("enabledSuccess") : t("disabledSuccess"));
    });
  }

  function handleConfirmDisablePerson() {
    if (!disableTarget) {
      return;
    }

    handleToggleEnabled(disableTarget, false);
    setDisableTarget(null);
  }

  function handleDeletePerson() {
    if (!deleteTarget) {
      return;
    }

    markPersonPending(deleteTarget.id, true);

    startTransition(async () => {
      const result = await deleteAssetPersonAction(deleteTarget.id);
      markPersonPending(deleteTarget.id, false);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      setPersons((current) => current.filter((person) => person.id !== deleteTarget.id));
      setSelectedIds((current) => current.filter((id) => id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success(t("deletedSuccess"));
    });
  }

  function handleRetryProcessing(person: PersonItem) {
    markPersonPending(person.id, true);

    startTransition(async () => {
      const result = await retryAssetPersonProcessingAction(person.id);
      markPersonPending(person.id, false);

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      updatePersonInList(result.data.person);
      toast.success(t("retryStarted"));
    });
  }

  function handleTypeRenamed(typeId: string, name: string) {
    setPersons((current) =>
      current.map((person) =>
        person.personTypeId === typeId ? { ...person, personTypeName: name } : person,
      ),
    );
  }

  function handleTypeDeleted() {
    setPersons((current) => current.map((person) => person));
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
    targetIds.forEach((id) => markPersonPending(id, true));

    startTransition(async () => {
      const results = await Promise.all(
        targetIds.map(async (id) => {
          const result = await setAssetPersonEnabledAction(id, enabled);
          markPersonPending(id, false);
          return result;
        }),
      );

      const updatedPersons = results.filter((item) => item.success).map((item) => item.data.person);
      if (updatedPersons.length > 0) {
        const updatedById = new Map(updatedPersons.map((person) => [person.id, person]));
        setPersons((current) => current.map((person) => updatedById.get(person.id) ?? person));
      }

      const failedCount = results.length - updatedPersons.length;
      if (failedCount === 0) {
        toast.success(enabled ? t("batchEnabledSuccess") : t("batchDisabledSuccess"));
        return;
      }

      if (updatedPersons.length > 0) {
        toast.warning(
          t("batchPartialSuccess", { success: updatedPersons.length, failed: failedCount }),
        );
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
    targetIds.forEach((id) => markPersonPending(id, true));

    startTransition(async () => {
      const results = await Promise.all(
        targetIds.map(async (id) => {
          const result = await deleteAssetPersonAction(id);
          markPersonPending(id, false);
          return { id, result };
        }),
      );

      const successIds = results.filter((item) => item.result.success).map((item) => item.id);
      if (successIds.length > 0) {
        const successIdSet = new Set(successIds);
        setPersons((current) => current.filter((person) => !successIdSet.has(person.id)));
        setSelectedIds((current) => current.filter((id) => !successIdSet.has(id)));
      }

      const failedCount = results.length - successIds.length;
      if (failedCount === 0) {
        toast.success(t("batchDeletedSuccess"));
      } else if (successIds.length > 0) {
        toast.warning(
          t("batchPartialSuccess", { success: successIds.length, failed: failedCount }),
        );
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
      ? t("filteredEmpty")
      : t("empty");
  const isLibraryCompletelyEmpty = persons.length === 0;

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
                <Link href="/tagging/person/classify">{t("devClassify")}</Link>
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
                        {t("itemsSelected")}{" "}
                        <span className="text-[#3366FF]">{selectedIds.length}</span> /{" "}
                        {filteredPersons.length} {t("itemsCount")}
                      </>
                    ) : (
                      <>
                        {t("itemsTotal")} {filteredPersons.length} {t("itemsCount")}
                      </>
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
                      {personTypes.map((type) => (
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
                {filteredPersons.length === 0 ? (
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
                            <th className="w-[320px] px-4 py-0">{t("columnPersonName")}</th>
                            <th className="w-[180px] px-4 py-0">{t("columnPersonType")}</th>
                            <th className="w-[220px] px-4 py-0">{t("columnPersonImages")}</th>
                            <th className="w-[320px] px-4 py-0">{t("columnLinkedTags")}</th>
                            <th className="w-[160px] px-4 py-0">{t("columnStatus")}</th>
                            <th className="w-[140px] px-4 py-0">{t("columnEnabled")}</th>
                            <th className="w-[190px] px-4 py-0">{t("columnCreatedAt")}</th>
                            <th className="w-[90px] px-4 py-0 text-right">{t("columnActions")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentPagePersons.map((ip) => {
                            const statusMeta = getPersonStatusMeta(ip.status, t);
                            const pending = pendingPersonIds.includes(ip.id) || isPending;
                            const StatusIcon = statusMeta.icon;
                            const failedReason =
                              getProcessingErrorMessage(ip.processingError) ?? t("unknownError");
                            const subtitle = ip.notes;

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
                                <td className="h-[58px] px-4 py-0 align-middle">
                                  <div className="flex items-center gap-3">
                                    <div className="h-[30px] w-[30px] self-center overflow-hidden rounded-full bg-basic-2">
                                      {ip.images[0] ? (
                                        <PersonImageHoverCard
                                          image={ip.images[0]}
                                          alt={t("imageAlt", { name: ip.name })}
                                        >
                                          <button
                                            type="button"
                                            className="h-full w-full overflow-hidden"
                                            aria-label={t("previewImage", { name: ip.name })}
                                          >
                                            <SignedPersonImage
                                              imageId={ip.images[0].id}
                                              signedUrl={ip.images[0].signedUrl}
                                              signedUrlExpiresAt={ip.images[0].signedUrlExpiresAt}
                                              alt={t("imageAlt", { name: ip.name })}
                                              className="h-full w-full object-cover"
                                            />
                                          </button>
                                        </PersonImageHoverCard>
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
                                  {ip.personTypeName}
                                </td>
                                <td className="h-[58px] px-4 py-0 align-middle">
                                  <PersonImagesCell person={ip} t={t} />
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
                                      <span className="text-sm text-basic-5">
                                        {t("noLinkedTags")}
                                      </span>
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
                                          {t("processingErrorTooltip", { error: failedReason })}
                                        </TooltipContent>
                                      </Tooltip>
                                    ) : (
                                      <span
                                        className={`inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-[4px] border px-[6px] py-[3px] text-xs ${statusMeta.className}`}
                                      >
                                        <StatusIcon
                                          className={
                                            ip.status === "processing"
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
                                        {t("retry")}
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
                                        {t("edit")}
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

      <PersonDialog
        open={dialogOpen}
        mode={dialogMode}
        person={activePerson}
        personTypes={personTypes}
        usedPersonTypeIds={usedPersonTypeIds}
        tags={initialData.tags}
        onOpenChange={(nextOpen) => {
          setDialogOpen(nextOpen);
          if (!nextOpen) {
            setActivePerson(null);
          }
        }}
        onSaved={handleDialogSaved}
        onPersonTypesChange={setPersonTypes}
        onPersonTypeRenamed={handleTypeRenamed}
        onPersonTypeDeleted={handleTypeDeleted}
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
            <AlertDialogAction variant="dialogDanger" onClick={handleDeletePerson}>
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
            <AlertDialogAction variant="dialogDanger" onClick={handleConfirmDisablePerson}>
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
            <AlertDialogCancel>{t("confirmDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleBatchDeleteSelected}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchEnableOpen} onOpenChange={setBatchEnableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("batchDialog.enableDescription", { count: selectedIds.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirmDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleBatchEnableSelected}>
              {t("batchDialog.confirmEnable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchDisableOpen} onOpenChange={setBatchDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("batchDialog.disableDescription", { count: selectedIds.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("confirmDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="dialogDanger" onClick={handleBatchDisableSelected}>
              {t("confirmDialog.confirmDisable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
