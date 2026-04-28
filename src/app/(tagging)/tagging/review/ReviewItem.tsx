"use client";

import { getBrandRecommendationFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { getIpRecommendationFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import { AssetThumbnail } from "@/components/AssetThumbnail";
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
import { Button } from "@/components/ui/button";
import { BrandIcon, ClockCircleIcon, IpIcon, TagAIIcon, TagsIcon } from "@/components/ui/icons";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { slugToId } from "@/lib/slug";
import { cn, formatSize } from "@/lib/utils";
import { AssetObjectExtra, AssetObjectTags, TaggingAuditStatus } from "@/prisma/client";
import { CheckIcon, DotIcon, Loader2Icon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  approveAuditItemsAction,
  AssetWithAuditItemsBatch,
  rejectAuditItemsAction,
} from "./actions";

function getIpRecommendedTagsTitle(locale: string, ipLabel: string) {
  const normalizedLocale = locale.toLowerCase();

  if (normalizedLocale === "zh-tw") {
    return `${ipLabel}推薦標籤`;
  }

  if (normalizedLocale.startsWith("zh")) {
    return `${ipLabel}推荐标签`;
  }

  return `${ipLabel} Recommended Tags`;
}

function getNoIpRecommendationText(locale: string, ipLabel: string) {
  const normalizedLocale = locale.toLowerCase();

  if (normalizedLocale === "zh-tw") {
    return `暫無${ipLabel}識別標籤`;
  }

  if (normalizedLocale.startsWith("zh")) {
    return `暂无${ipLabel}识别标签`;
  }

  return `No ${ipLabel} recognition tags`;
}

function getIpNoConfidentMatchText(locale: string, ipName: string, confidence: number) {
  const normalizedLocale = locale.toLowerCase();

  if (normalizedLocale === "zh-tw") {
    return `目前最佳匹配為 ${ipName}（${confidence}%），但尚未達到推薦閾值`;
  }

  if (normalizedLocale.startsWith("zh")) {
    return `当前最佳匹配为 ${ipName}（${confidence}%），但尚未达到推荐阈值`;
  }

  return `Best match is ${ipName} (${confidence}%), but it did not meet the recommendation threshold.`;
}

export function ReviewItem({
  assetObject,
  batch,
  onSuccess,
  CheckboxComponent,
  batchLoading,
}: AssetWithAuditItemsBatch & {
  CheckboxComponent: React.ReactNode;
  batchLoading?: boolean;
}) {
  const t = useTranslations("Tagging.Review");
  const locale = useLocale();
  const normalizedLocale = locale.toLowerCase();
  const tSidebar = useTranslations("Tagging.Sidebar");
  const ipLabel = tSidebar("ip");
  const ipRecommendedTagsTitle = getIpRecommendedTagsTitle(locale, ipLabel);
  const noBrandRecommendationText =
    normalizedLocale === "zh-tw"
      ? "暫無品牌識別標籤"
      : normalizedLocale.startsWith("zh")
        ? "暂无品牌识别标签"
        : "No brand recognition tags";
  const noIpRecommendationText = getNoIpRecommendationText(locale, ipLabel);
  const [loading, setLoading] = useState(false);
  const [rejectedItems, setRejectedItems] = useState<number[]>([]);
  const [rejectedBrandItems, setRejectedBrandItems] = useState<number[]>([]);
  const [rejectedIpItems, setRejectedIpItems] = useState<number[]>([]);

  const realLoading = batchLoading || loading;

  const finalBatch = useMemo(() => {
    let hasDefaultBatch = false;
    return batch.filter((group) => {
      if (group.queueItem.taskType === "default") {
        if (hasDefaultBatch) {
          return false;
        }
        hasDefaultBatch = true;
      }
      return true;
    });
  }, [batch]);

  const filteredOutAuditItems = useMemo(() => {
    const finalBatchSet = new Set(finalBatch);
    const items: AssetWithAuditItemsBatch["batch"][number]["taggingAuditItems"][number][] = [];
    batch.forEach((group) => {
      if (!finalBatchSet.has(group)) {
        group.taggingAuditItems.forEach((auditItem) => {
          items.push(auditItem);
        });
      }
    });
    return items;
  }, [batch, finalBatch]);

  const auditItemsSet = useMemo(() => {
    const set = new Set<AssetWithAuditItemsBatch["batch"][number]["taggingAuditItems"][number]>();
    finalBatch.forEach(({ taggingAuditItems }) => {
      taggingAuditItems.forEach((auditItem) => {
        set.add(auditItem);
      });
    });
    return set;
  }, [finalBatch]);

  const brandRecommendationsByQueueId = useMemo(
    () =>
      new Map(
        finalBatch.map((group) => [
          group.queueItem.id,
          getBrandRecommendationFromQueueResult(group.queueItem.result),
        ]),
      ),
    [finalBatch],
  );
  const ipRecommendationsByQueueId = useMemo(
    () =>
      new Map(
        finalBatch.map((group) => [
          group.queueItem.id,
          getIpRecommendationFromQueueResult(group.queueItem.result),
        ]),
      ),
    [finalBatch],
  );

  const brandTagIds = useMemo(
    () =>
      Array.from(
        new Set(
          Array.from(brandRecommendationsByQueueId.values()).flatMap((brandRecommendation) =>
            !brandRecommendation || brandRecommendation.noConfidentMatch
              ? []
              : brandRecommendation.recommendedTags
                  .map((tag) => tag.assetTagId)
                  .filter((tagId) => !rejectedBrandItems.includes(tagId)),
          ),
        ),
      ),
    [brandRecommendationsByQueueId, rejectedBrandItems],
  );
  const ipTagIds = useMemo(
    () =>
      Array.from(
        new Set(
          Array.from(ipRecommendationsByQueueId.values()).flatMap((ipRecommendation) =>
            !ipRecommendation || ipRecommendation.noConfidentMatch
              ? []
              : ipRecommendation.recommendedTags
                  .map((tag) => tag.assetTagId)
                  .filter((tagId) => !rejectedIpItems.includes(tagId)),
          ),
        ),
      ),
    [ipRecommendationsByQueueId, rejectedIpItems],
  );

  const hasPendingAuditItems = useMemo(
    () => Array.from(auditItemsSet).some((auditItem) => auditItem.status === "pending"),
    [auditItemsSet],
  );

  const approveAuditItems = useCallback(
    async ({ append }: { append: boolean }) => {
      setLoading(true);

      const auditItems: {
        id: number;
        leafTagId: number | null;
        status: TaggingAuditStatus;
      }[] = Array.from(auditItemsSet).map(({ id, leafTagId }) => ({
        id,
        leafTagId: leafTagId ?? null,
        status: leafTagId && rejectedItems.includes(leafTagId) ? "rejected" : ("approved" as const),
      }));

      const filteredOutItems = filteredOutAuditItems.map(({ id, leafTagId }) => ({
        id,
        leafTagId: leafTagId ?? null,
        status: "rejected" as TaggingAuditStatus,
      }));

      const allAuditItems = [...auditItems, ...filteredOutItems];

      if (!allAuditItems.length && brandTagIds.length === 0 && ipTagIds.length === 0) {
        toast.error(t("noCorrespondingTag"));
        setLoading(false);
        return;
      }

      try {
        const result = await approveAuditItemsAction({
          assetSlug: assetObject.slug,
          auditItems: allAuditItems,
          brandTagIds,
          ipTagIds,
          append,
        });

        if (!result.success) {
          if (result.message === "Asset not found") {
            const rejectResult = await rejectAuditItemsAction({ assetSlug: assetObject.slug });
            if (rejectResult.success) {
              toast.warning(t("assetDeleted"));
              onSuccess?.();
            } else {
              toast.error(rejectResult.message || t("applyFailed"));
            }
            return;
          }

          toast.error(result.message || t("applyFailed"));
          return;
        }

        toast.success(t("applySuccess"));
        onSuccess?.();
      } catch (error: unknown) {
        console.error(error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        toast.error(errorMessage || t("applyFailed"));
      } finally {
        setLoading(false);
      }
    },
    [
      assetObject.slug,
      auditItemsSet,
      brandTagIds,
      filteredOutAuditItems,
      ipTagIds,
      onSuccess,
      rejectedItems,
      t,
    ],
  );

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));
  };

  const handleReject = useCallback(async () => {
    setLoading(true);
    try {
      const result = await rejectAuditItemsAction({ assetSlug: assetObject.slug });
      if (result.success) {
        toast.success(t("rejectSuccess"));
        onSuccess?.();
      } else {
        toast.error(result.message || t("rejectFailed"));
      }
    } catch (error: unknown) {
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(errorMessage || t("rejectFailed"));
    } finally {
      setLoading(false);
    }
  }, [assetObject.slug, onSuccess, t]);

  return (
    <div className="bg-background border rounded-[6px] px-6 pt-8 pb-6 space-y-6">
      <div className="flex items-center gap-4">
        {CheckboxComponent}
        <div
          className="shrink-0 size-[86px] cursor-pointer relative"
          onClick={() => {
            const assetId = slugToId("assetObject", assetObject.slug);
            dispatchMuseDAMClientAction("goto", {
              url: `/detail/${assetId.toString()}`,
              target: "_blank",
            });
          }}
        >
          <AssetThumbnail
            asset={{
              thumbnailUrl: (assetObject.extra as AssetObjectExtra | null)?.thumbnailAccessUrl,
              extension: (assetObject.extra as AssetObjectExtra | null)?.extension,
            }}
            maxWidth={86}
            maxHeight={86}
            className="rounded-[10px] size-[86px]"
          />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-basic" title={assetObject.name}>
            {assetObject.name}
          </h3>
          <div className="flex items-center gap-0.5 text-xs text-basic-5 mt-1">
            <span>{(assetObject.extra as AssetObjectExtra).extension?.toUpperCase()}</span>
            <DotIcon className="size-3" />
            <span>
              {formatSize((assetObject.extra as AssetObjectExtra).size)?.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          {(hasPendingAuditItems || brandTagIds.length > 0 || ipTagIds.length > 0) && (
            <Button
              size="sm"
              disabled={realLoading}
              variant="default"
              onClick={() => approveAuditItems({ append: true })}
              className="h-[28px] rounded-[6px] px-2"
            >
              {loading ? (
                <Loader2Icon className="size-[14px] animate-spin" />
              ) : (
                <CheckIcon className="size-[14px]" />
              )}
              {t("add")}
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="danger"
                className="h-[28px] rounded-[6px] px-2"
                disabled={realLoading}
              >
                {loading ? (
                  <Loader2Icon className="size-[14px] animate-spin" />
                ) : (
                  <XIcon className="size-[14px]" />
                )}
                {t("delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("rejectConfirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("rejectConfirmDescription", { assetName: assetObject.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("rejectConfirmCancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleReject} variant="dialogDanger">
                  {t("rejectConfirmReject")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[rgba(247,249,252,0.8)] dark:bg-basic-1 rounded-md p-4 col-span-1">
          <div className="flex items-center gap-2 mb-2">
            <TagsIcon className="size-4" />
            <span className="text-sm font-medium">{t("tags")}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(assetObject.tags as AssetObjectTags).map((tag, index) => (
              <span
                key={index}
                className="inline-flex items-center px-2 py-1 rounded-sm text-xs border bg-background text-foreground"
              >
                {tag.tagPath.join(" > ")}
              </span>
            ))}
          </div>
        </div>

        <div className="col-span-1 flex flex-col gap-[6px]">
          {finalBatch.map(({ queueItem, taggingAuditItems }, index) => {
            const brandRecommendation = brandRecommendationsByQueueId.get(queueItem.id);
            const ipRecommendation = ipRecommendationsByQueueId.get(queueItem.id);
            const isLatestBatch = finalBatch.length > 1 && index === 0;
            const hasBrandTags = Boolean(
              brandRecommendation &&
                !brandRecommendation.noConfidentMatch &&
                brandRecommendation.recommendedTags.length > 0,
            );
            const hasIpTags = Boolean(
              ipRecommendation &&
                !ipRecommendation.noConfidentMatch &&
                ipRecommendation.recommendedTags.length > 0,
            );
            const visibleAuditItems = taggingAuditItems.filter(
              (auditItem) => auditItem.leafTagId && auditItem.tagPath.length > 0,
            );

            return (
              <div key={queueItem.id} className="flex flex-col gap-[6px]">
                <div className="w-full bg-[rgba(247,249,252,0.8)] dark:bg-basic-1 rounded-md p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TagAIIcon className="size-4" />
                    <span className="text-sm font-medium">{t("aiRecommendedTags")}</span>
                    <span className="text-xs text-basic-5">{t("basedOnTagSystem")}</span>
                    {isLatestBatch ? (
                      <span className="ml-2 inline-flex items-center px-[13px] py-[2px] rounded-[4px] text-xs text-danger-6 border border-danger-3 bg-danger-1">
                        {t("latest")}
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-basic-5 flex items-center gap-1">
                      <ClockCircleIcon className="size-3" />
                      {formatDate(queueItem.createdAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {visibleAuditItems.length > 0 ? (
                      visibleAuditItems.map((auditItem) => (
                        <div
                          key={auditItem.id}
                          className={cn(
                            "relative py-[6px] px-2 rounded-[6px] border items-center flex gap-2",
                            {
                              "border-dashed":
                                (auditItem.leafTagId &&
                                  rejectedItems.includes(auditItem.leafTagId)) ||
                                auditItem.status === "rejected",
                            },
                            {
                              "text-primary-6 bg-primary-1 border-[#A6C1FF]": auditItem.score >= 80,
                              "text-[#52C41A] bg-[#F6FFED] border-[#95DE64]":
                                auditItem.score >= 70 && auditItem.score < 80,
                              "text-[#FA8C16] bg-[#FFF7E6] border-[#FFC069]": auditItem.score < 70,
                            },
                          )}
                        >
                          <div className="font-medium text-[13px] leading-[18px]">
                            {auditItem.tagPath.join(" > ")}
                          </div>
                          <div className="flex items-center gap-[6px]">
                            <Progress
                              value={auditItem.score}
                              className="bg-current/20 [&>[data-slot=progress-indicator]]:bg-current w-[60px]"
                            />
                            <span className="text-[10px]">{auditItem.score}%</span>
                          </div>
                          {auditItem.status === "pending" && auditItem.leafTagId ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="size-3 bg-transparent hover:bg-transparent text-basic-5 hover:text-current"
                                    onClick={() =>
                                      setRejectedItems((current) => {
                                        if (!auditItem.leafTagId) return [...current];
                                        const foundIndex = current.indexOf(auditItem.leafTagId);
                                        if (foundIndex >= 0) {
                                          return [
                                            ...current.slice(0, foundIndex),
                                            ...current.slice(foundIndex + 1),
                                          ];
                                        }
                                        return [...current, auditItem.leafTagId];
                                      })
                                    }
                                  >
                                    {rejectedItems.includes(auditItem.leafTagId) ? (
                                      <CheckIcon className="h-3 w-3" />
                                    ) : (
                                      <XIcon className="h-3 w-3" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>
                                    {rejectedItems.includes(auditItem.leafTagId)
                                      ? t("tooltipAdd")
                                      : t("tooltipRemove")}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-basic-5">{t("noPendingTags")}</div>
                    )}
                  </div>
                </div>

                <div className="w-full bg-[rgba(247,249,252,0.8)] dark:bg-basic-1 rounded-md p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BrandIcon className="size-4" />
                    <span className="text-sm font-medium">{t("brandRecommendedTags")}</span>
                    {isLatestBatch ? (
                      <span className="ml-2 inline-flex items-center px-[13px] py-[2px] rounded-[4px] text-xs text-danger-6 border border-danger-3 bg-danger-1">
                        {t("latest")}
                      </span>
                    ) : null}
                    {hasBrandTags && brandRecommendation?.bestMatch ? (
                      <span className="text-xs text-basic-5">
                        {brandRecommendation.bestMatch.logoName}
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-basic-5 flex items-center gap-1">
                      <ClockCircleIcon className="size-3" />
                      {formatDate(queueItem.createdAt)}
                    </span>
                  </div>
                  {hasBrandTags && brandRecommendation ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {brandRecommendation.recommendedTags.map((tag) => (
                        <div
                          key={`${queueItem.id}-${tag.assetTagId}`}
                          className={cn(
                            "relative py-[6px] px-2 rounded-[6px] border items-center flex gap-2",
                            {
                              "border-dashed": rejectedBrandItems.includes(tag.assetTagId),
                            },
                            {
                              "text-primary-6 bg-primary-1 border-[#A6C1FF]":
                                (brandRecommendation.bestMatch?.confidence ?? 0) >= 80,
                              "text-[#52C41A] bg-[#F6FFED] border-[#95DE64]":
                                (brandRecommendation.bestMatch?.confidence ?? 0) >= 70 &&
                                (brandRecommendation.bestMatch?.confidence ?? 0) < 80,
                              "text-[#FA8C16] bg-[#FFF7E6] border-[#FFC069]":
                                (brandRecommendation.bestMatch?.confidence ?? 0) < 70,
                            },
                          )}
                        >
                          <div className="font-medium text-[13px] leading-[18px]">
                            {tag.tagPath.join(" > ")}
                          </div>
                          <div className="flex items-center gap-[6px]">
                            <Progress
                              value={brandRecommendation.bestMatch?.confidence ?? 0}
                              className="bg-current/20 [&>[data-slot=progress-indicator]]:bg-current w-[60px]"
                            />
                            <span className="text-[10px]">
                              {brandRecommendation.bestMatch?.confidence ?? 0}%
                            </span>
                          </div>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-3 bg-transparent hover:bg-transparent text-basic-5 hover:text-current"
                                  onClick={() =>
                                    setRejectedBrandItems((current) => {
                                      const foundIndex = current.indexOf(tag.assetTagId);
                                      if (foundIndex >= 0) {
                                        return [
                                          ...current.slice(0, foundIndex),
                                          ...current.slice(foundIndex + 1),
                                        ];
                                      }
                                      return [...current, tag.assetTagId];
                                    })
                                  }
                                >
                                  {rejectedBrandItems.includes(tag.assetTagId) ? (
                                    <CheckIcon className="h-3 w-3" />
                                  ) : (
                                    <XIcon className="h-3 w-3" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>
                                  {rejectedBrandItems.includes(tag.assetTagId)
                                    ? t("tooltipAdd")
                                    : t("tooltipRemove")}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1 text-basic-5">
                      <div className="text-sm">{noBrandRecommendationText}</div>
                      {brandRecommendation?.noConfidentMatch && brandRecommendation.bestMatch ? (
                        <div className="text-xs">
                          {normalizedLocale === "zh-tw"
                            ? `目前最佳匹配為 ${brandRecommendation.bestMatch.logoName}（${brandRecommendation.bestMatch.confidence}%），但尚未達到推薦閾值`
                            : normalizedLocale.startsWith("zh")
                              ? `当前最佳匹配为 ${brandRecommendation.bestMatch.logoName}（${brandRecommendation.bestMatch.confidence}%），但尚未达到推荐阈值`
                              : `Best match is ${brandRecommendation.bestMatch.logoName} (${brandRecommendation.bestMatch.confidence}%), but it did not meet the recommendation threshold.`}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="w-full bg-[rgba(247,249,252,0.8)] dark:bg-basic-1 rounded-md p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <IpIcon className="size-4" />
                    <span className="text-sm font-medium">{ipRecommendedTagsTitle}</span>
                    {isLatestBatch ? (
                      <span className="ml-2 inline-flex items-center px-[13px] py-[2px] rounded-[4px] text-xs text-danger-6 border border-danger-3 bg-danger-1">
                        {t("latest")}
                      </span>
                    ) : null}
                    {hasIpTags && ipRecommendation?.bestMatch ? (
                      <span className="text-xs text-basic-5">
                        {ipRecommendation.bestMatch.ipName}
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-basic-5 flex items-center gap-1">
                      <ClockCircleIcon className="size-3" />
                      {formatDate(queueItem.createdAt)}
                    </span>
                  </div>
                  {hasIpTags && ipRecommendation ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {ipRecommendation.recommendedTags.map((tag) => (
                        <div
                          key={`${queueItem.id}-${tag.assetTagId}`}
                          className={cn(
                            "relative py-[6px] px-2 rounded-[6px] border items-center flex gap-2",
                            {
                              "border-dashed": rejectedIpItems.includes(tag.assetTagId),
                            },
                            {
                              "text-primary-6 bg-primary-1 border-[#A6C1FF]":
                                (ipRecommendation.bestMatch?.confidence ?? 0) >= 80,
                              "text-[#52C41A] bg-[#F6FFED] border-[#95DE64]":
                                (ipRecommendation.bestMatch?.confidence ?? 0) >= 70 &&
                                (ipRecommendation.bestMatch?.confidence ?? 0) < 80,
                              "text-[#FA8C16] bg-[#FFF7E6] border-[#FFC069]":
                                (ipRecommendation.bestMatch?.confidence ?? 0) < 70,
                            },
                          )}
                        >
                          <div className="font-medium text-[13px] leading-[18px]">
                            {tag.tagPath.join(" > ")}
                          </div>
                          <div className="flex items-center gap-[6px]">
                            <Progress
                              value={ipRecommendation.bestMatch?.confidence ?? 0}
                              className="bg-current/20 [&>[data-slot=progress-indicator]]:bg-current w-[60px]"
                            />
                            <span className="text-[10px]">
                              {ipRecommendation.bestMatch?.confidence ?? 0}%
                            </span>
                          </div>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-3 bg-transparent hover:bg-transparent text-basic-5 hover:text-current"
                                  onClick={() =>
                                    setRejectedIpItems((current) => {
                                      const foundIndex = current.indexOf(tag.assetTagId);
                                      if (foundIndex >= 0) {
                                        return [
                                          ...current.slice(0, foundIndex),
                                          ...current.slice(foundIndex + 1),
                                        ];
                                      }
                                      return [...current, tag.assetTagId];
                                    })
                                  }
                                >
                                  {rejectedIpItems.includes(tag.assetTagId) ? (
                                    <CheckIcon className="h-3 w-3" />
                                  ) : (
                                    <XIcon className="h-3 w-3" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>
                                  {rejectedIpItems.includes(tag.assetTagId)
                                    ? t("tooltipAdd")
                                    : t("tooltipRemove")}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-1 text-basic-5">
                      <div className="text-sm">{noIpRecommendationText}</div>
                      {ipRecommendation?.noConfidentMatch && ipRecommendation.bestMatch ? (
                        <div className="text-xs">
                          {getIpNoConfidentMatchText(
                            locale,
                            ipRecommendation.bestMatch.ipName,
                            ipRecommendation.bestMatch.confidence,
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
