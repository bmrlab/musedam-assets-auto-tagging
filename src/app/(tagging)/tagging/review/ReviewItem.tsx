"use client";

import { getBrandRecommendationFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { getIpRecommendationFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import { getPersonRecommendationFromQueueResult } from "@/app/(tagging)/person-recommendation";
import { getProductRecommendationFromQueueResult } from "@/app/(tagging)/product-recommendation";
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
import { ClockCircleIcon, TagAIIcon, TagsIcon } from "@/components/ui/icons";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { useFeatureLibraryEnabled } from "@/hooks/use-feature-library";
import { slugToId } from "@/lib/slug";
import {
  getFeatureConfidenceToneClass,
  meetsFeatureConfidenceThreshold,
  normalizeFeatureConfidence,
} from "@/lib/tagging/feature-confidence";
import { cn, formatSize } from "@/lib/utils";
import { collectMuseFeatureIdentifierIdsForQueueItem } from "@/musedam/collect-muse-feature-identifier-ids";
import type { MuseDAMMaterialFeatureSnapshot } from "@/musedam/query-features-by-materials-types";
import { AssetObjectExtra, AssetObjectTags, TaggingAuditStatus } from "@/prisma/client";
import { CheckIcon, DotIcon, Loader2Icon, StarIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  approveAuditItemsAction,
  AssetWithAuditItemsBatch,
  rejectAuditItemsAction,
} from "./actions";
import { FeatureThumbnail } from "./components/FeatureThumbnail";

type ReviewAssetObject = AssetWithAuditItemsBatch["assetObject"];

function formatSnapshotTagPath(tagPath: string) {
  return tagPath.replace(/\s*->\s*/g, " > ");
}

function ExistingFeatureSnapshotRow({
  feature,
  featureClass,
}: {
  feature: MuseDAMMaterialFeatureSnapshot;
  featureClass: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-basic-3 bg-background p-3">
      <div className="relative size-10 shrink-0 overflow-hidden rounded bg-basic-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={feature.identifierImagePath}
          alt={feature.identifierName}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[13px] font-medium leading-[18px]"
          title={feature.identifierName}
        >
          {feature.identifierName}
        </div>
        <div
          className="mt-1 truncate text-xs text-basic-5"
          title={`${featureClass} > ${feature.identifierTypeName || "-"}`}
        >
          {featureClass} &gt; {feature.identifierTypeName || "-"}
        </div>
        {feature.tagPaths.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {feature.tagPaths.map((tagPath, index) => (
              <span
                key={`${feature.id}-${index}`}
                className="inline-flex max-w-full items-center truncate rounded-sm border bg-background px-2 py-0.5 text-[10px] text-basic-5"
                title={formatSnapshotTagPath(tagPath)}
              >
                {formatSnapshotTagPath(tagPath)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function toggleTagIds(current: number[], tagIds: number[]) {
  if (tagIds.length === 0) {
    return current;
  }

  const tagIdSet = new Set(tagIds);
  const allRejected = tagIds.every((tagId) => current.includes(tagId));

  if (allRejected) {
    return current.filter((tagId) => !tagIdSet.has(tagId));
  }

  return Array.from(new Set([...current, ...tagIds]));
}

function FeatureRecognitionRow({
  featureType,
  featureId,
  featureClass,
  featureTypeName,
  classifiedName,
  confidence,
  tagIds,
  rejectedTagIds,
  onToggleTagIds,
  tooltipAdd,
  tooltipRemove,
}: {
  featureType: "brand" | "ip" | "product" | "person";
  featureId: string;
  featureClass: string;
  featureTypeName?: string | null;
  classifiedName: string;
  confidence: number;
  tagIds: number[];
  rejectedTagIds: number[];
  onToggleTagIds: (tagIds: number[]) => void;
  tooltipAdd: string;
  tooltipRemove: string;
}) {
  const isRejected = tagIds.length > 0 && tagIds.every((tagId) => rejectedTagIds.includes(tagId));
  const tResult = useTranslations("TaggingResultDisplay");

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md border p-3",
        getFeatureConfidenceToneClass(confidence),
        {
          "border-dashed": isRejected,
        },
      )}
    >
      <div className="relative size-10 shrink-0 overflow-hidden rounded bg-background/70">
        <FeatureThumbnail
          featureType={featureType}
          featureId={featureId}
          alt={classifiedName}
          className="h-full w-full"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-[18px]" title={classifiedName}>
          {classifiedName}
        </div>
        <div
          className="mt-1 truncate text-xs text-current/75"
          title={`${featureClass} > ${featureTypeName || "-"}`}
        >
          {featureClass} &gt; {featureTypeName || "-"}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-current/60">
          {tResult("matchingSource")}: {tResult(`${featureType}Recognition`)}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-[6px]">
        <Progress
          value={confidence}
          className="w-[60px] bg-current/20 [&>[data-slot=progress-indicator]]:bg-current"
        />
        <span className="w-8 text-right text-[10px]">{confidence}%</span>
        {tagIds.length > 0 ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-3 bg-transparent text-basic-5 hover:bg-transparent hover:text-current"
                  onClick={() => onToggleTagIds(tagIds)}
                >
                  {isRejected ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isRejected ? tooltipAdd : tooltipRemove}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
    </div>
  );
}

export function ReviewItem({
  assetObject,
  existingFeatures = [],
  availableFeatureIds,
  batch,
  onSuccess,
  CheckboxComponent,
  batchLoading,
}: AssetWithAuditItemsBatch & {
  CheckboxComponent: React.ReactNode;
  batchLoading?: boolean;
}) {
  const t = useTranslations("Tagging.Review");
  const tResult = useTranslations("TaggingResultDisplay");
  const locale = useLocale();
  const featureLibraryEnabled = useFeatureLibraryEnabled();

  const getFeatureClassLabel = useCallback(
    (featureType: MuseDAMMaterialFeatureSnapshot["featureType"]) => {
      switch (featureType) {
        case "brand":
          return tResult("featureClassBrand");
        case "ip":
          return tResult("featureClassIp");
        case "product":
          return tResult("featureClassProduct");
        case "person":
          return tResult("featureClassPerson");
        default:
          return featureType;
      }
    },
    [tResult],
  );
  const [loading, setLoading] = useState(false);
  const [rejectedItems, setRejectedItems] = useState<number[]>([]);
  const [rejectedBrandItems, setRejectedBrandItems] = useState<number[]>([]);
  const [rejectedIpItems, setRejectedIpItems] = useState<number[]>([]);
  const [rejectedProductItems, setRejectedProductItems] = useState<number[]>([]);
  const [rejectedPersonItems, setRejectedPersonItems] = useState<number[]>([]);

  const realLoading = batchLoading || loading;
  const availableFeatureIdSets = useMemo(
    () => ({
      brand: new Set(featureLibraryEnabled ? availableFeatureIds.brand : []),
      ip: new Set(featureLibraryEnabled ? availableFeatureIds.ip : []),
      product: new Set(featureLibraryEnabled ? availableFeatureIds.product : []),
      person: new Set(featureLibraryEnabled ? availableFeatureIds.person : []),
    }),
    [availableFeatureIds, featureLibraryEnabled],
  );
  const availableMuseFeatureIdentifierIds = useMemo(
    () =>
      new Set([
        ...(featureLibraryEnabled ? availableFeatureIds.brand : []),
        ...(featureLibraryEnabled ? availableFeatureIds.ip : []),
        ...(featureLibraryEnabled ? availableFeatureIds.product : []),
        ...(featureLibraryEnabled ? availableFeatureIds.person : []),
      ]),
    [availableFeatureIds, featureLibraryEnabled],
  );

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
  const productRecommendationsByQueueId = useMemo(
    () =>
      new Map(
        finalBatch.map((group) => [
          group.queueItem.id,
          getProductRecommendationFromQueueResult(group.queueItem.result),
        ]),
      ),
    [finalBatch],
  );
  const personRecommendationsByQueueId = useMemo(
    () =>
      new Map(
        finalBatch.map((group) => [
          group.queueItem.id,
          getPersonRecommendationFromQueueResult(group.queueItem.result),
        ]),
      ),
    [finalBatch],
  );

  const brandTagIds = useMemo(() => {
    if (!featureLibraryEnabled) return [];
    return Array.from(
      new Set(
        Array.from(brandRecommendationsByQueueId.values()).flatMap((brandRecommendation) => {
          if (
            !brandRecommendation?.bestMatch ||
            !meetsFeatureConfidenceThreshold("brand", brandRecommendation.bestMatch.confidence) ||
            !availableFeatureIdSets.brand.has(brandRecommendation.bestMatch.assetLogoId) ||
            !brandRecommendation.recommendedTags
          ) {
            return [];
          }

          return brandRecommendation.recommendedTags
            .map((tag) => tag.assetTagId)
            .filter((tagId) => !rejectedBrandItems.includes(tagId));
        }),
      ),
    );
  }, [
    availableFeatureIdSets,
    brandRecommendationsByQueueId,
    featureLibraryEnabled,
    rejectedBrandItems,
  ]);
  const ipTagIds = useMemo(() => {
    if (!featureLibraryEnabled) return [];
    return Array.from(
      new Set(
        Array.from(ipRecommendationsByQueueId.values()).flatMap((ipRecommendation) => {
          if (
            !ipRecommendation?.bestMatch ||
            !meetsFeatureConfidenceThreshold("ip", ipRecommendation.bestMatch.confidence) ||
            !availableFeatureIdSets.ip.has(ipRecommendation.bestMatch.assetIpId) ||
            !ipRecommendation.recommendedTags
          ) {
            return [];
          }

          return ipRecommendation.recommendedTags
            .map((tag) => tag.assetTagId)
            .filter((tagId) => !rejectedIpItems.includes(tagId));
        }),
      ),
    );
  }, [availableFeatureIdSets, featureLibraryEnabled, ipRecommendationsByQueueId, rejectedIpItems]);
  const personTagIds = useMemo(() => {
    if (!featureLibraryEnabled) return [];
    return Array.from(
      new Set(
        Array.from(personRecommendationsByQueueId.values()).flatMap((personRecommendation) => {
          if (!personRecommendation?.faces) {
            return [];
          }

          const tagIds: number[] = [];
          for (const face of personRecommendation.faces) {
            if (
              !face.bestMatch ||
              !meetsFeatureConfidenceThreshold("person", face.bestMatch.confidence) ||
              !availableFeatureIdSets.person.has(face.bestMatch.assetPersonId)
            ) {
              continue;
            }

            for (const tag of face.bestMatch.recommendedTags ?? []) {
              if (
                Number.isInteger(tag.assetTagId) &&
                tag.assetTagId > 0 &&
                !rejectedPersonItems.includes(tag.assetTagId)
              ) {
                tagIds.push(tag.assetTagId);
              }
            }
          }

          return tagIds;
        }),
      ),
    );
  }, [
    availableFeatureIdSets,
    featureLibraryEnabled,
    personRecommendationsByQueueId,
    rejectedPersonItems,
  ]);
  const productTagIds = useMemo(() => {
    if (!featureLibraryEnabled) return [];
    return Array.from(
      new Set(
        Array.from(productRecommendationsByQueueId.values()).flatMap((productRecommendation) => {
          if (
            !productRecommendation?.bestMatch ||
            !meetsFeatureConfidenceThreshold(
              "product",
              productRecommendation.bestMatch.confidence,
            ) ||
            !availableFeatureIdSets.product.has(productRecommendation.bestMatch.assetProductId) ||
            !productRecommendation.recommendedTags
          ) {
            return [];
          }

          return productRecommendation.recommendedTags
            .map((tag) => tag.assetTagId)
            .filter((tagId) => !rejectedProductItems.includes(tagId));
        }),
      ),
    );
  }, [
    availableFeatureIdSets,
    featureLibraryEnabled,
    productRecommendationsByQueueId,
    rejectedProductItems,
  ]);

  const museFeatureIdentifierIds = useMemo(() => {
    if (!featureLibraryEnabled) return [];

    const ids = new Set<string>();
    for (const { queueItem } of finalBatch) {
      const br = brandRecommendationsByQueueId.get(queueItem.id);
      const ir = ipRecommendationsByQueueId.get(queueItem.id);
      const pr = productRecommendationsByQueueId.get(queueItem.id);
      const per = personRecommendationsByQueueId.get(queueItem.id);

      const brandTagIdsForQueue =
        br?.bestMatch &&
        meetsFeatureConfidenceThreshold("brand", br.bestMatch.confidence) &&
        availableFeatureIdSets.brand.has(br.bestMatch.assetLogoId)
          ? (br.recommendedTags
              ?.map((t) => t.assetTagId)
              .filter((id) => !rejectedBrandItems.includes(id)) ?? [])
          : [];
      const ipTagIdsForQueue =
        ir?.bestMatch &&
        meetsFeatureConfidenceThreshold("ip", ir.bestMatch.confidence) &&
        availableFeatureIdSets.ip.has(ir.bestMatch.assetIpId)
          ? (ir.recommendedTags
              ?.map((t) => t.assetTagId)
              .filter((id) => !rejectedIpItems.includes(id)) ?? [])
          : [];
      const productTagIdsForQueue =
        pr?.bestMatch &&
        meetsFeatureConfidenceThreshold("product", pr.bestMatch.confidence) &&
        availableFeatureIdSets.product.has(pr.bestMatch.assetProductId)
          ? (pr.recommendedTags
              ?.map((t) => t.assetTagId)
              .filter((id) => !rejectedProductItems.includes(id)) ?? [])
          : [];
      const personTagIdsForQueue =
        per?.faces.flatMap((face) => {
          if (
            !face.bestMatch ||
            !meetsFeatureConfidenceThreshold("person", face.bestMatch.confidence) ||
            !availableFeatureIdSets.person.has(face.bestMatch.assetPersonId)
          ) {
            return [];
          }

          return (
            face.bestMatch.recommendedTags
              ?.map((t) => t.assetTagId)
              .filter((id) => !rejectedPersonItems.includes(id)) ?? []
          );
        }) ?? [];

      for (const id of collectMuseFeatureIdentifierIdsForQueueItem({
        brandRecommendation: br ?? undefined,
        ipRecommendation: ir ?? undefined,
        productRecommendation: pr ?? undefined,
        personRecommendation: per ?? undefined,
        brandTagIds: brandTagIdsForQueue,
        ipTagIds: ipTagIdsForQueue,
        productTagIds: productTagIdsForQueue,
        personTagIds: personTagIdsForQueue,
      })) {
        if (availableMuseFeatureIdentifierIds.has(id)) {
          ids.add(id);
        }
      }
    }
    return [...ids];
  }, [
    availableFeatureIdSets,
    availableMuseFeatureIdentifierIds,
    featureLibraryEnabled,
    finalBatch,
    brandRecommendationsByQueueId,
    ipRecommendationsByQueueId,
    productRecommendationsByQueueId,
    personRecommendationsByQueueId,
    rejectedBrandItems,
    rejectedIpItems,
    rejectedProductItems,
    rejectedPersonItems,
  ]);

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

      if (
        !allAuditItems.length &&
        brandTagIds.length === 0 &&
        ipTagIds.length === 0 &&
        productTagIds.length === 0 &&
        personTagIds.length === 0
      ) {
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
          productTagIds,
          personTagIds,
          museFeatureIdentifierIds,
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
      museFeatureIdentifierIds,
      onSuccess,
      personTagIds,
      productTagIds,
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
          {(hasPendingAuditItems ||
            brandTagIds.length > 0 ||
            ipTagIds.length > 0 ||
            productTagIds.length > 0 ||
            personTagIds.length > 0) && (
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
            const isLatestBatch = finalBatch.length > 1 && index === 0;
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
                              "text-[#52C41A] bg-[#F6FFED] border-[#95DE64] dark:text-success-6 dark:bg-success-1 dark:border-success-3":
                                auditItem.score >= 70 && auditItem.score < 80,
                              "text-[#FA8C16] bg-[#FFF7E6] border-[#FFC069] dark:text-warning-6 dark:bg-warning-1 dark:border-warning-4":
                                auditItem.score < 70,
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
              </div>
            );
          })}
        </div>
      </div>

      {featureLibraryEnabled ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-1 rounded-md bg-[rgba(247,249,252,0.8)] p-4 dark:bg-basic-1">
            <div className="mb-2 flex items-center gap-2">
              <StarIcon className="size-4" />
              <span className="text-sm font-medium">{t("features")}</span>
            </div>
            <div className="space-y-2">
              {existingFeatures.length > 0
                ? existingFeatures.map((feature) => (
                    <ExistingFeatureSnapshotRow
                      key={`${feature.featureType}-${feature.identifierId}-${feature.id}`}
                      feature={feature}
                      featureClass={getFeatureClassLabel(feature.featureType)}
                    />
                  ))
                : null}
            </div>
          </div>

          <div className="col-span-1 flex flex-col gap-[6px]">
            {finalBatch.map(({ queueItem }, index) => {
              const brandRecommendation = brandRecommendationsByQueueId.get(queueItem.id);
              const ipRecommendation = ipRecommendationsByQueueId.get(queueItem.id);
              const productRecommendation = productRecommendationsByQueueId.get(queueItem.id);
              const personRecommendation = personRecommendationsByQueueId.get(queueItem.id);
              const isLatestBatch = finalBatch.length > 1 && index === 0;
              const featureRows: {
                key: string;
                featureType: "brand" | "ip" | "product" | "person";
                featureId: string;
                featureClass: string;
                featureTypeName?: string | null;
                classifiedName: string;
                confidence: number;
                tagIds: number[];
                rejectedTagIds: number[];
                onToggleTagIds: (tagIds: number[]) => void;
              }[] = [];

              if (
                brandRecommendation?.bestMatch &&
                meetsFeatureConfidenceThreshold(
                  "brand",
                  brandRecommendation.bestMatch.confidence,
                ) &&
                availableFeatureIdSets.brand.has(brandRecommendation.bestMatch.assetLogoId)
              ) {
                featureRows.push({
                  key: "brand",
                  featureType: "brand",
                  featureId: brandRecommendation.bestMatch.assetLogoId,
                  featureClass: tResult("featureClassBrand"),
                  featureTypeName: brandRecommendation.bestMatch.logoTypeName,
                  classifiedName: brandRecommendation.bestMatch.logoName,
                  confidence: normalizeFeatureConfidence(brandRecommendation.bestMatch.confidence),
                  tagIds:
                    brandRecommendation.bestMatch.recommendedTags?.map((tag) => tag.assetTagId) ??
                    [],
                  rejectedTagIds: rejectedBrandItems,
                  onToggleTagIds: (tagIds) =>
                    setRejectedBrandItems((current) => toggleTagIds(current, tagIds)),
                });
              }

              if (
                ipRecommendation?.bestMatch &&
                meetsFeatureConfidenceThreshold("ip", ipRecommendation.bestMatch.confidence) &&
                availableFeatureIdSets.ip.has(ipRecommendation.bestMatch.assetIpId)
              ) {
                featureRows.push({
                  key: "ip",
                  featureType: "ip",
                  featureId: ipRecommendation.bestMatch.assetIpId,
                  featureClass: tResult("featureClassIp"),
                  featureTypeName: ipRecommendation.bestMatch.ipTypeName,
                  classifiedName: ipRecommendation.bestMatch.ipName,
                  confidence: normalizeFeatureConfidence(ipRecommendation.bestMatch.confidence),
                  tagIds:
                    ipRecommendation.bestMatch.recommendedTags?.map((tag) => tag.assetTagId) ?? [],
                  rejectedTagIds: rejectedIpItems,
                  onToggleTagIds: (tagIds) =>
                    setRejectedIpItems((current) => toggleTagIds(current, tagIds)),
                });
              }

              if (
                productRecommendation?.bestMatch &&
                meetsFeatureConfidenceThreshold(
                  "product",
                  productRecommendation.bestMatch.confidence,
                ) &&
                availableFeatureIdSets.product.has(productRecommendation.bestMatch.assetProductId)
              ) {
                featureRows.push({
                  key: "product",
                  featureType: "product",
                  featureId: productRecommendation.bestMatch.assetProductId,
                  featureClass: tResult("featureClassProduct"),
                  featureTypeName: productRecommendation.bestMatch.productTypeName,
                  classifiedName: productRecommendation.bestMatch.productName,
                  confidence: normalizeFeatureConfidence(
                    productRecommendation.bestMatch.confidence,
                  ),
                  tagIds:
                    productRecommendation.bestMatch.recommendedTags?.map((tag) => tag.assetTagId) ??
                    [],
                  rejectedTagIds: rejectedProductItems,
                  onToggleTagIds: (tagIds) =>
                    setRejectedProductItems((current) => toggleTagIds(current, tagIds)),
                });
              }

              const totalPersonFaces =
                personRecommendation?.faces.filter(
                  (f) =>
                    f.bestMatch && availableFeatureIdSets.person.has(f.bestMatch.assetPersonId),
                ).length ?? 0;
              personRecommendation?.faces.forEach((face) => {
                if (
                  !face.bestMatch ||
                  !meetsFeatureConfidenceThreshold("person", face.bestMatch.confidence) ||
                  !availableFeatureIdSets.person.has(face.bestMatch.assetPersonId)
                ) {
                  return;
                }

                // Format: "人物N: personName" when multiple people, or just "personName" when single
                const personDisplayName =
                  totalPersonFaces > 1
                    ? `${tResult("featureClassPerson")}${face.detectionIndex + 1}: ${face.bestMatch.personName}`
                    : face.bestMatch.personName;

                featureRows.push({
                  key: `person-${face.detectionIndex}-${face.bestMatch.assetPersonId}`,
                  featureType: "person",
                  featureId: face.bestMatch.assetPersonId,
                  featureClass: tResult("featureClassPerson"),
                  featureTypeName: face.bestMatch.personTypeName,
                  classifiedName: personDisplayName,
                  confidence: normalizeFeatureConfidence(face.bestMatch.confidence),
                  tagIds: face.bestMatch.recommendedTags?.map((tag) => tag.assetTagId) ?? [],
                  rejectedTagIds: rejectedPersonItems,
                  onToggleTagIds: (tagIds) =>
                    setRejectedPersonItems((current) => toggleTagIds(current, tagIds)),
                });
              });

              // Sort features by confidence (high to low)
              featureRows.sort((a, b) => b.confidence - a.confidence);

              return (
                <div
                  key={`features-${queueItem.id}`}
                  className="w-full rounded-md bg-[rgba(247,249,252,0.8)] p-4 dark:bg-basic-1"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <StarIcon className="size-4" />
                    <span className="text-sm font-medium">{t("featureRecognition")}</span>
                    <span className="text-xs text-basic-5">{t("basedOnFeatureLibrary")}</span>
                    {isLatestBatch ? (
                      <span className="ml-2 inline-flex items-center rounded-[4px] border border-danger-3 bg-danger-1 px-[13px] py-[2px] text-xs text-danger-6">
                        {t("latest")}
                      </span>
                    ) : null}
                    <span className="ml-auto flex items-center gap-1 text-xs text-basic-5">
                      <ClockCircleIcon className="size-3" />
                      {formatDate(queueItem.createdAt)}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {featureRows.length > 0 ? (
                      featureRows.map((feature) => (
                        <FeatureRecognitionRow
                          key={feature.key}
                          featureType={feature.featureType}
                          featureId={feature.featureId}
                          featureClass={feature.featureClass}
                          featureTypeName={feature.featureTypeName}
                          classifiedName={feature.classifiedName}
                          confidence={feature.confidence}
                          tagIds={feature.tagIds}
                          rejectedTagIds={feature.rejectedTagIds}
                          onToggleTagIds={feature.onToggleTagIds}
                          tooltipAdd={t("tooltipAdd")}
                          tooltipRemove={t("tooltipRemove")}
                        />
                      ))
                    ) : (
                      <div className="text-sm text-basic-5">{tResult("noRecognizedFeatures")}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
