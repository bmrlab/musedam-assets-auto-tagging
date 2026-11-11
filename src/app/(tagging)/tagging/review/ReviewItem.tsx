"use client";
import { applyMetadataReviewSelection } from "./metadata-review-selection";
import { ReviewConfidence } from "./components/ReviewConfidence";
import { ReviewEvidenceDropdown } from "./components/ReviewEvidenceDropdown";
import { FeatureEvidence } from "./components/FeatureEvidence";
import type { FeatureDecisionMatch } from "@/lib/feature-decision/types";
import { MetadataInlineReview } from "./MetadataInlineReview";
import { reviewMetadata } from "./metadata-actions";
import { BatchImageModeBadge } from "./components/BatchImageModeBadge";

import { hasFeatureRecognitionFailure } from "@/lib/feature-decision/completion";

import { MatchedKeywordsBadge } from "../components/MatchedKeywordsBadge";

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
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ClockCircleIcon, TagAIIcon } from "@/components/ui/icons";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { useFeatureLibraryFeatures } from "@/hooks/use-feature-library";
import {
  getAcceptedBrandMatches,
  getAcceptedIpMatches,
  getBrandMatches,
  getIpMatches,
} from "@/lib/feature-decision/match-policy";
import { isFeatureTypeEnabled, isVideoAssetExtension } from "@/lib/feature-library";
import {
  PRIMARY_FACE_SIM_THRESHOLD,
  getPersonFaceBestRawSimilarity,
  isReviewablePersonFace,
  personSimilarityToConfidence,
} from "@/lib/person/person-match-policy";
import { getAcceptedProductMatches, getProductMatches } from "@/lib/product/product-match-policy";
import { slugToId } from "@/lib/slug";
import {
  getFeatureConfidenceToneClass,
  getPersonReviewConfidenceToneClass,
  meetsFeatureConfidenceThreshold,
  normalizeFeatureConfidence,
} from "@/lib/tagging/feature-confidence";
import { cn, formatSize } from "@/lib/utils";
import type { MuseDAMMaterialFeatureSnapshot } from "@/musedam/query-features-by-materials-types";
import {
  AssetObjectExtra,
  AssetObjectTags,
  TaggingAuditStatus,
  TaggingQueueItemResult,
} from "@/prisma/client";
import {
  CheckIcon,
  DotIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlusIcon,
  StarIcon,
  XIcon,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  approveAuditItemsAction,
  reviewScopedAssetsAction,
  AssetWithAuditItemsBatch,
  rejectAuditItemsAction,
  setAuditItemsRejectedAction,
  type ReviewTagSearchResult,
} from "./actions";
import { AddFeatureDialog } from "./components/AddFeatureDialog";
import { AddTagDialog } from "./components/AddTagDialog";
import { FeatureThumbnail } from "./components/FeatureThumbnail";
import {
  FEATURE_REVIEW_CHANGED,
  featureKey,
  getFeatureReviewVersions,
  isScopedFeatureReviewComplete,
  getReviewedManualFeatures,
  getReviewFeatures,
  type FeatureThumbnailImage,
  type ReviewFeature,
  type ReviewFeatureSearchResult,
} from "./feature-review";


type PreviewImage = { src: string; alt: string };

function ImagePreviewDialog({
  image,
  closeLabel,
  onOpenChange,
}: {
  image: PreviewImage | null;
  closeLabel: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(image)} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[90vh] w-auto max-w-[90vw] overflow-visible rounded-[12px] border-none bg-black/10 p-1 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      >
        <DialogTitle className="sr-only">{image?.alt}</DialogTitle>
        {image ? (
          <div className="relative inline-flex">
            <DialogClose className="absolute top-3 right-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/75">
              <XIcon className="size-4" />
              <span className="sr-only">{closeLabel}</span>
            </DialogClose>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.src}
              alt={image.alt}
              className="block max-h-[90vh] max-w-[90vw] rounded-[8px] object-contain"
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FeatureRecognitionRow({
  featureType,
  featureId,
  featureClass,
  featureTypeName,
  classifiedName,
  confidence,
  rawSimilarity,
  matchingSource,
  tagPaths,
  isRejected,
  onToggle,
  disabled,
  tooltipAdd,
  tooltipRemove,
  onPreview,
  thumbnail,
  decision,
  showToggle = true,
}: {
  decision?: FeatureDecisionMatch;
  showToggle?: boolean;
  featureType: "brand" | "ip" | "product" | "person";
  featureId: string;
  /** undefined → 列表未预签名，由 FeatureThumbnail 自行请求 */
  thumbnail?: FeatureThumbnailImage | null;
  featureClass: string;
  featureTypeName?: string | null;
  classifiedName: string;
  confidence: number;
  rawSimilarity?: number;
  matchingSource?: "assetName";
  tagPaths: string[][];
  isRejected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  tooltipAdd: string;
  tooltipRemove: string;
  onPreview: (image: PreviewImage) => void;
}) {
  const tResult = useTranslations("TaggingResultDisplay");
  const t = useTranslations("Tagging.Review");

  return (
    <div
      className={cn(
        "group flex items-center justify-between gap-3 rounded-md border p-3",
        rawSimilarity === undefined
          ? getFeatureConfidenceToneClass(confidence)
          : getPersonReviewConfidenceToneClass(rawSimilarity, confidence),
        {
          "border-dashed": isRejected,
        },
      )}
    >
      <div className="relative size-10 shrink-0 overflow-hidden rounded bg-background/70">
        <FeatureThumbnail
          featureType={featureType}
          featureId={featureId}
          initialImage={thumbnail}
          alt={classifiedName}
          className="h-full w-full"
          previewLabel={t("previewImage", { name: classifiedName })}
          onPreview={(imageUrl) => onPreview({ src: imageUrl, alt: classifiedName })}
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
          {tResult("matchingSource")}: {tResult(matchingSource === "assetName" ? "productNameMatch" : `${featureType}Recognition`)}
        </div>
        {tagPaths.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {tagPaths.map((tagPath, index) => (
              <span
                key={index}
                className="inline-flex items-center rounded-sm border border-current/30 bg-background/60 px-1.5 py-0.5 text-[10px] text-current/80"
              >
                {tagPath.join(" > ")}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-[6px]">
        <Progress
          value={confidence}
          className="w-[60px] bg-current/20 [&>[data-slot=progress-indicator]]:bg-current"
        />
        <ReviewConfidence
          score={confidence}
          high={95}
          medium={90}
          level={rawSimilarity === undefined ? undefined : rawSimilarity < PRIMARY_FACE_SIM_THRESHOLD ? "low" : confidence >= 95 ? "high" : "medium"}
        />
        <ReviewEvidenceDropdown name={classifiedName}>
          <FeatureEvidence evidence={decision?.evidence} reason={decision?.reason} />
        </ReviewEvidenceDropdown>
        {showToggle ? <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-3 bg-transparent text-basic-5 hover:bg-transparent hover:text-current"
                aria-label={isRejected ? tooltipAdd : tooltipRemove}
                disabled={disabled}
                onClick={onToggle}
              >
                {isRejected ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isRejected ? tooltipAdd : tooltipRemove}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider> : null}
      </div>
    </div>
  );
}

function ManualFeatureRow({
  feature,
  featureClass,
  onRemove,
  disabled,
  onPreview,
  thumbnail,
}: {
  feature: ReviewFeature;
  featureClass: string;
  thumbnail?: FeatureThumbnailImage | null;
  /** Omitted for features already recorded in an applied review (read-only). */
  onRemove?: () => void;
  disabled?: boolean;
  onPreview: (image: PreviewImage) => void;
}) {
  const tResult = useTranslations("TaggingResultDisplay");
  const t = useTranslations("Tagging.Review");

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-basic-3 bg-background p-3">
      <div className="relative size-10 shrink-0 overflow-hidden rounded bg-basic-2">
        <FeatureThumbnail
          featureType={feature.featureType}
          featureId={feature.id}
          initialImage={thumbnail}
          alt={feature.name}
          className="h-full w-full"
          previewLabel={t("previewImage", { name: feature.name })}
          onPreview={(imageUrl) => onPreview({ src: imageUrl, alt: feature.name })}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-[18px]" title={feature.name}>
          {feature.name}
        </div>
        <div
          className="mt-1 truncate text-xs text-basic-5"
          title={`${featureClass} > ${feature.typeName || "-"}`}
        >
          {featureClass} &gt; {feature.typeName || "-"}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-basic-5">
          {tResult("matchingSource")}: {t("manuallyAdded")}
        </div>
        {feature.tags.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {feature.tags.map((tag) => (
              <span
                key={tag.assetTagId}
                className="inline-flex items-center rounded-sm border bg-background px-1.5 py-0.5 text-[10px] text-basic-5"
              >
                {tag.tagPath.join(" > ")}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {onRemove ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-3 shrink-0 bg-transparent text-basic-5 hover:bg-transparent hover:text-current"
                aria-label={t("tooltipRemove")}
                disabled={disabled}
                onClick={onRemove}
              >
                <XIcon className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t("tooltipRemove")}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  );
}

export function ReviewItem({
  assetObject,
  existingFeatures = [],
  excludedMetadataIds = [],
  onToggleMetadata = () => {},
  metadataReviews = [],
  metadataAvailable = false,
  contentScope = "all",
  availableFeatureIds,
  featureThumbnails,
  batch,
  onSuccess,
  CheckboxComponent,
  batchLoading,
  rejectedFeatureKeys,
  onToggleFeatureKey,
  manualTags = [],
  onAddManualTags,
  onRemoveManualTag,
  manualFeatures,
  onAddManualFeatures,
  onRemoveManualFeature,
}: AssetWithAuditItemsBatch & {
  CheckboxComponent: React.ReactNode;
  batchLoading?: boolean;
  excludedMetadataIds?: number[];
  onToggleMetadata?: (id: number) => void;
  metadataAvailable?: boolean;
  contentScope?: "all" | "tags" | "features";
  rejectedFeatureKeys: string[];
  onToggleFeatureKey: (key: string) => void;
  manualTags?: ReviewTagSearchResult[];
  onAddManualTags: (tags: ReviewTagSearchResult[]) => void;
  onRemoveManualTag: (id: number) => void;
  manualFeatures: ReviewFeatureSearchResult[];
  onAddManualFeatures: (features: ReviewFeatureSearchResult[]) => void;
  onRemoveManualFeature: (key: string) => void;
}) {
  const t = useTranslations("Tagging.Review");
  const tResult = useTranslations("TaggingResultDisplay");
  const locale = useLocale();
  const featureLibraryFeatures = useFeatureLibraryFeatures();
  const hasEnabledFeatures = contentScope !== "tags" && (
    featureLibraryFeatures.featureBrand ||
    featureLibraryFeatures.featureIp ||
    featureLibraryFeatures.featureProduct ||
    featureLibraryFeatures.featurePerson);

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
  // 初始值来自数据库：上次点 x 已即时持久化为 rejected 的标签，刷新后仍以虚线展示并可恢复
  const [rejectedItems, setRejectedItems] = useState<number[]>(() =>
    Array.from(
      new Set(
        batch.flatMap(({ taggingAuditItems }) =>
          taggingAuditItems.flatMap((auditItem) =>
            auditItem.status === "rejected" && auditItem.leafTagId ? [auditItem.leafTagId] : [],
          ),
        ),
      ),
    ),
  );
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [addTagOpen, setAddTagOpen] = useState(false);
  const [addFeatureOpen, setAddFeatureOpen] = useState(false);
  // 历史打标记录默认折叠：只展示最新一次，避免过往错误结果一直挂在页面上
  const [showHistory, setShowHistory] = useState(false);

  const assetExtra = assetObject.extra as AssetObjectExtra | null;
  const sourceDeleted = assetExtra?.reviewAssetDeleted === true;
  const assetPreviewUrl = assetExtra?.thumbnailAccessUrl;
  const isVideoAsset = isVideoAssetExtension(assetExtra?.extension);

  const realLoading = batchLoading || loading;
  const availableFeatureIdSets = useMemo(
    () => ({
      brand: new Set(featureLibraryFeatures.featureBrand ? availableFeatureIds.brand : []),
      ip: new Set(featureLibraryFeatures.featureIp ? availableFeatureIds.ip : []),
      product: new Set(featureLibraryFeatures.featureProduct ? availableFeatureIds.product : []),
      person: new Set(featureLibraryFeatures.featurePerson ? availableFeatureIds.person : []),
    }),
    [availableFeatureIds, featureLibraryFeatures],
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

  // 历史常规任务也保留展示，但不改变 finalBatch 定义的本次审核范围。
  // 本次会提交的 pending 批次始终展开，其余批次通过历史入口查看。
  const collapsibleBatch = useMemo(
    () =>
      batch.filter(
        (group, index) =>
          index > 0 &&
          (!finalBatch.includes(group) ||
            !group.taggingAuditItems.some(({ status }) => status === "pending")),
      ),
    [batch, finalBatch],
  );
  const visibleBatch = useMemo(
    () =>
      showHistory ? batch : batch.filter((group) => !collapsibleBatch.includes(group)),
    [batch, collapsibleBatch, showHistory],
  );
  const historyCount = collapsibleBatch.length;

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
        batch.map((group) => [
          group.queueItem.id,
          getBrandRecommendationFromQueueResult(group.queueItem.result),
        ]),
      ),
    [batch],
  );
  const ipRecommendationsByQueueId = useMemo(
    () =>
      new Map(
        batch.map((group) => [
          group.queueItem.id,
          getIpRecommendationFromQueueResult(group.queueItem.result),
        ]),
      ),
    [batch],
  );
  const productRecommendationsByQueueId = useMemo(
    () =>
      new Map(
        batch.map((group) => [
          group.queueItem.id,
          getProductRecommendationFromQueueResult(group.queueItem.result),
        ]),
      ),
    [batch],
  );
  const personRecommendationsByQueueId = useMemo(
    () =>
      new Map(
        batch.map((group) => [
          group.queueItem.id,
          getPersonRecommendationFromQueueResult(group.queueItem.result),
        ]),
      ),
    [batch],
  );

  const featureReviewVersions = useMemo(() => getFeatureReviewVersions(finalBatch), [finalBatch]);
  const manualFeatureKeys = useMemo(
    () => manualFeatures.map((feature) => featureKey(feature.featureType, feature.id)),
    [manualFeatures],
  );
  const visibleManualFeatures = useMemo(
    () =>
      manualFeatures.filter((feature) =>
        isFeatureTypeEnabled(featureLibraryFeatures, feature.featureType),
      ),
    [featureLibraryFeatures, manualFeatures],
  );
  // 本次应用会带上的特征（素材已绑定 + 手动添加 + 待应用批次的 AI 识别结果），弹窗里置灰避免重复添加。
  // AI 部分与应用逻辑一致：只取 featureReviewVersions 里的批次（有 pending 审核项、会随本次应用提交），
  // 用 getReviewFeatures 按置信度阈值筛选。已应用过的历史批次不算，否则只在历史里识别过、
  // 这次不会应用的特征也会显示"已添加"，导致无法手动添加。
  const addedFeatureKeys = useMemo(
    () =>
      new Set(
        [
          ...manualFeatureKeys,
          ...existingFeatures.map((feature) =>
            featureKey(feature.featureType, feature.identifierId),
          ),
          ...finalBatch
            .filter(({ queueItem }) => featureReviewVersions[queueItem.id] !== undefined)
            .flatMap(({ queueItem }) => getReviewFeatures(queueItem.result))
            .filter((feature) => availableFeatureIdSets[feature.featureType].has(feature.id))
            .map((feature) => featureKey(feature.featureType, feature.id)),
        ].filter((key) => !rejectedFeatureKeys.includes(key)),
      ),
    [
      availableFeatureIdSets,
      existingFeatures,
      featureReviewVersions,
      finalBatch,
      manualFeatureKeys,
      rejectedFeatureKeys,
    ],
  );

  // 点 x / 再点恢复：先乐观更新本地状态，同时把该标签在本素材下的所有审核项即时持久化为 rejected / pending，
  // 这样顶部"批量应用"和刷新页面都能看到 x 的结果；失败则回滚本地状态。
  const toggleRejectedTag = useCallback(
    async (leafTagId: number) => {
      const nextRejected = !rejectedItems.includes(leafTagId);
      setRejectedItems((current) =>
        nextRejected ? [...current, leafTagId] : current.filter((id) => id !== leafTagId),
      );
      const auditItemIds = Array.from(auditItemsSet)
        .filter((auditItem) => auditItem.leafTagId === leafTagId)
        .map(({ id }) => id);
      try {
        const result = await setAuditItemsRejectedAction({
          assetSlug: assetObject.slug,
          auditItemIds,
          rejected: nextRejected,
        });
        if (!result.success) throw new Error(result.message || t("applyFailed"));
      } catch (error) {
        console.error(error);
        setRejectedItems((current) =>
          nextRejected ? current.filter((id) => id !== leafTagId) : [...current, leafTagId],
        );
        toast.error(error instanceof Error ? error.message : t("applyFailed"));
      }
    },
    [assetObject.slug, auditItemsSet, rejectedItems, t],
  );

  const hasPendingAuditItems = useMemo(
    () => Array.from(auditItemsSet).some((auditItem) => auditItem.status === "pending") || metadataReviews.some(item => item.status === "pending"),
    [auditItemsSet, metadataReviews],
  );

  const reviewScoped = async (decision: "approve" | "reject") => {
    if (contentScope === "all") return;
    const result = await reviewScopedAssetsAction({
      content: contentScope,
      decision,
      assetObjects: [
        {
          id: assetObject.id,
          slug: assetObject.slug,
          auditItemIds: finalBatch.flatMap(group => group.taggingAuditItems.map(item => item.id)),
          featureReviewVersions,
          rejectedFeatureKeys,
          manualFeatureKeys,
          manualTagIds: manualTags.map((tag) => tag.id),
        },
      ],
    });
    if (!result.success) throw new Error(result.message);
    toast.success(t(decision === "approve" ? "applySuccess" : "rejectSuccess"));
    onSuccess?.();
  };

  const approveAuditItems = useCallback(
    async ({ append }: { append: boolean }) => {
      setLoading(true);

      if (contentScope !== "all") {
        try { await reviewScoped("approve"); }
        catch (error) { toast.error(error instanceof Error ? error.message : t("applyFailed")); }
        finally { setLoading(false); }
        return;
      }

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

      if (!allAuditItems.length && !metadataReviews.some(item => item.status === "pending")) {
        toast.error(t("noCorrespondingTag"));
        setLoading(false);
        return;
      }

      try {
        await applyMetadataReviewSelection(metadataReviews, excludedMetadataIds, reviewMetadata);
        if (!allAuditItems.length) { onSuccess?.(); return; }
        const result = await approveAuditItemsAction({
          assetSlug: assetObject.slug,
          auditItems: allAuditItems,
          featureReviewVersions,
          rejectedFeatureKeys,
          manualFeatureKeys,
          manualTagIds: manualTags.map((tag) => tag.id),
          append,
        });

        if (!result.success) {
          if (result.message === FEATURE_REVIEW_CHANGED) {
            toast.warning(t("featureReviewChanged"));
            onSuccess?.();
            return;
          }
          if (result.message === "Asset not found") {
            toast.warning(t("assetDeleted"));
            onSuccess?.();
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
      assetObject.id,
      assetObject.slug,
      auditItemsSet,
      contentScope,
      filteredOutAuditItems,
      featureReviewVersions,
      finalBatch,
      rejectedFeatureKeys,
      manualFeatureKeys,
      manualTags,
      metadataReviews,
      excludedMetadataIds,
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
      if (contentScope !== "all") { await reviewScoped("reject"); return; }
      const metadataIds = metadataReviews.filter(item => item.status === "pending").map(item => item.id);
      for (let start = 0; start < metadataIds.length; start += 100) await reviewMetadata(metadataIds.slice(start,start+100), "reject");
      if (!batch.length) { onSuccess?.(); return; }
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
  }, [assetObject.id, assetObject.slug, batch.length, contentScope, featureReviewVersions, rejectedFeatureKeys, manualFeatureKeys, manualTags, metadataReviews, onSuccess, t, finalBatch]);

  return (
    <div className="bg-background border rounded-[6px] px-6 pt-8 pb-6 space-y-6">
      <div className="flex items-center gap-4">
        {CheckboxComponent}
        <button
          type="button"
          aria-label={t("previewImage", { name: assetObject.name })}
          className="relative size-[86px] shrink-0 cursor-zoom-in disabled:cursor-default"
          disabled={!assetPreviewUrl}
          onClick={() =>
            assetPreviewUrl && setPreviewImage({ src: assetPreviewUrl, alt: assetObject.name })
          }
        >
          <AssetThumbnail
            asset={{
              thumbnailUrl: assetExtra?.thumbnailAccessUrl,
              extension: assetExtra?.extension,
            }}
            maxWidth={86}
            maxHeight={86}
            className="rounded-[10px] size-[86px] object-contain"
          />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-basic" title={assetObject.name}>
              {assetObject.name}
            </h3>
            {sourceDeleted && (
              <span className="inline-flex rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                {t("assetDeletedLabel")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 text-xs text-basic-5 mt-1">
            <span>{assetExtra?.extension?.toUpperCase()}</span>
            <DotIcon className="size-3" />
            <span>{formatSize(assetExtra?.size)?.toLocaleString()}</span>
          </div>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary-6 transition-opacity hover:opacity-80"
            onClick={() => {
              const assetId = slugToId("assetObject", assetObject.slug);
              dispatchMuseDAMClientAction("goto", {
                url: `/detail/${assetId.toString()}`,
                target: "_blank",
              });
            }}
          >
            <ExternalLinkIcon className="size-3" />
            {t("openInMuseDAM")}
          </button>
        </div>

        <div className="flex gap-2">
          {hasPendingAuditItems && !sourceDeleted && (
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

      {contentScope !== "features" ? (
      <div className="flex w-full min-w-0 flex-col gap-[6px]">
          {visibleBatch.map(({ queueItem, taggingAuditItems, reviewSummary }, index) => {
            const isLatestBatch = batch.length > 1 && index === 0;
            const visibleAuditItems = taggingAuditItems.filter(
              (auditItem) => auditItem.tagPath.length > 0,
            );
            // Completion includes rejected-only and mixed outcomes; it does not imply adoption.
            const isReviewed =
              reviewSummary?.reviewed ??
              (taggingAuditItems.length > 0 &&
                taggingAuditItems.every((auditItem) => auditItem.status !== "pending"));
            const approvedCount =
              reviewSummary?.approved ??
              visibleAuditItems.filter((item) => item.status === "approved").length;
            const rejectedCount =
              reviewSummary?.rejected ??
              visibleAuditItems.filter((item) => item.status === "rejected").length;
            const resultTagsWithScore = (queueItem.result as TaggingQueueItemResult | null)
              ?.tagsWithScore;
            const keywordsByLeafTagId = new Map(
              (Array.isArray(resultTagsWithScore) ? resultTagsWithScore : [])
                .map((tag) => [tag.leafTagId, tag.matchedKeywords] as const),
            );
            const originByLeafTagId = new Map(
              (Array.isArray(resultTagsWithScore) ? resultTagsWithScore : [])
                .filter((tag) => tag.origin)
                .map((tag) => [tag.leafTagId, tag.origin] as const),
            );

            return (
              <div key={queueItem.id} className="flex flex-col gap-[6px]">
                <div className="w-full bg-[rgba(247,249,252,0.8)] dark:bg-basic-1 rounded-md p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <TagAIIcon className="size-4" />
                    <span className="text-sm font-medium">{t("aiRecommendedTags")}</span>
                    <span className="text-xs text-basic-5">{t("basedOnTagSystem")}</span>
                    <BatchImageModeBadge extra={queueItem.extra} />
                    {isLatestBatch ? (
                      <span className="ml-2 inline-flex items-center px-[13px] py-[2px] rounded-[4px] text-xs text-danger-6 border border-danger-3 bg-danger-1">
                        {t("latest")}
                      </span>
                    ) : null}
                    {isReviewed ? (
                      <>
                        <span className="ml-2 inline-flex items-center px-2 py-[1px] rounded-[4px] text-xs text-primary-6 border border-primary-3 bg-primary-1">
                          {t("reviewedBadge")}
                        </span>
                        <span className="text-xs text-basic-5">
                          {t("reviewOutcomeCounts", {
                            approved: approvedCount,
                            rejected: rejectedCount,
                          })}
                        </span>
                      </>
                    ) : null}
                    <span className="text-xs text-basic-5 flex items-center gap-1">
                      <ClockCircleIcon className="size-3" />
                      {formatDate(queueItem.createdAt)}
                    </span>
                    {index === 0 && hasPendingAuditItems && !sourceDeleted ? (
                      <button
                        type="button"
                        disabled={realLoading}
                        className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-primary-6 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => setAddTagOpen(true)}
                      >
                        <PlusIcon className="size-3" />
                        {t("addTagManually")}
                      </button>
                    ) : null}
                  </div>
                  {index === 0 && hasPendingAuditItems && !sourceDeleted && manualTags.length > 0 ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {manualTags.map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-flex items-center gap-2 rounded-md border border-primary-3 bg-primary-1 px-2 py-1 text-xs text-primary-6"
                        >
                          {tag.tagPath.join(" > ")}
                          <span className="text-basic-5">{t("manuallyAdded")}</span>
                          <button
                            type="button"
                            disabled={realLoading}
                            aria-label={`${t("tooltipRemove")} ${tag.tagPath.join(" > ")}`}
                            onClick={() => onRemoveManualTag(tag.id)}
                          >
                            <XIcon className="size-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    {visibleAuditItems.length > 0 ? (
                      visibleAuditItems.map((auditItem) => {
                        const isRejectedItem =
                          (auditItem.leafTagId && rejectedItems.includes(auditItem.leafTagId)) ||
                          auditItem.status === "rejected";
                        return (
                          <div
                            key={auditItem.id}
                            className={cn(
                              "group relative max-w-full flex-wrap py-[6px] px-2 rounded-[6px] border items-center flex gap-2",
                              isRejectedItem
                                ? "border-dashed text-basic-5 bg-basic-2 border-basic-4 dark:bg-basic-2"
                                : {
                                    "text-primary-6 bg-primary-1 border-[#A6C1FF]":
                                      auditItem.score >= 80,
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
                            {auditItem.leafTagId && originByLeafTagId.get(auditItem.leafTagId) ? (
                              <span className="inline-flex items-center px-1 rounded-[3px] text-[10px] leading-4 border border-current/40 bg-background/60">
                                {originByLeafTagId.get(auditItem.leafTagId) === "aspectRatio"
                                  ? t("aspectRatioBadge")
                                  : originByLeafTagId.get(auditItem.leafTagId) === "sizeAI"
                                    ? t("sizeAIBadge")
                                    : t("requiredFallbackBadge")}
                              </span>
                            ) : null}
                            <MatchedKeywordsBadge
                              keywords={auditItem.leafTagId ? keywordsByLeafTagId.get(auditItem.leafTagId) : undefined}
                            />
                            <div className="flex items-center gap-[6px]">
                              <Progress
                                value={auditItem.score}
                                className="bg-current/20 [&>[data-slot=progress-indicator]]:bg-current w-[60px]"
                              />
                              <ReviewConfidence score={auditItem.score} />
                            </div>
                            <ReviewEvidenceDropdown name={auditItem.tagPath.join(" > ")}>
                              {(() => {
                                const predictions = (queueItem.result as TaggingQueueItemResult | null)?.predictions ?? [];
                                const hits = predictions.flatMap(group => group.tags
                                  .filter(tag => tag.leafTagId === auditItem.leafTagId)
                                  .map(tag => ({ source: group.source, evidence: tag.evidence, keywords: tag.matchedKeywords })));
                                return hits.length ? hits.map((hit, index) => (
                                  <div key={index} className="flex min-w-0 flex-col gap-1">
                                    <span className="text-xs text-basic-5 dark:text-basic-6">{t(`tagEvidenceSources.${hit.source}`)}</span>
                                    <p className="whitespace-pre-wrap break-words">{hit.evidence || (hit.keywords?.length ? hit.keywords.join("、") : t("evidenceNotRecorded"))}</p>
                                  </div>
                                )) : <p>{t("evidenceNotRecorded")}</p>;
                              })()}
                            </ReviewEvidenceDropdown>
                            {finalBatch.some((group) => group.queueItem.id === queueItem.id) &&
                            (auditItem.status === "pending" || auditItem.status === "rejected") &&
                            auditItem.leafTagId ? (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="size-3 bg-transparent hover:bg-transparent text-basic-5 hover:text-current"
                                      disabled={realLoading}
                                      onClick={() => toggleRejectedTag(auditItem.leafTagId!)}
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
                        );
                      })
                    ) : (
                      <div className="text-sm text-basic-5">{t("noPendingTags")}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {hasEnabledFeatures ? (
        <div className="flex w-full min-w-0 flex-col gap-[6px]">
            {visibleBatch.map(({ queueItem, taggingAuditItems }, index) => {
              const brandRecommendation = brandRecommendationsByQueueId.get(queueItem.id);
              const ipRecommendation = ipRecommendationsByQueueId.get(queueItem.id);
              const productRecommendation = productRecommendationsByQueueId.get(queueItem.id);
              const personRecommendation = personRecommendationsByQueueId.get(queueItem.id);
              const isLatestBatch = batch.length > 1 && index === 0;
              // 已应用批次：展示该次审核快照里记录的手动添加特征（只读）；
              // 待审核时手动添加特征展示在当前特征区。
              const reviewedManualFeatures = taggingAuditItems.some(
                ({ status }) => status === "pending",
              )
                ? []
                : getReviewedManualFeatures(queueItem.extra).filter((feature) =>
                    isFeatureTypeEnabled(featureLibraryFeatures, feature.featureType),
                  );
              const hasManualRows = reviewedManualFeatures.length > 0;
              const hasFeatureBelowConfidenceThreshold =
                (featureLibraryFeatures.featureBrand &&
                  getBrandMatches(brandRecommendation).some(
                    (brand) =>
                      availableFeatureIdSets.brand.has(brand.assetLogoId) &&
                      !meetsFeatureConfidenceThreshold("brand", brand.confidence, brandRecommendation?.confidenceThreshold),
                  )) ||
                (featureLibraryFeatures.featureIp &&
                  getIpMatches(ipRecommendation).some(
                    (ip) =>
                      availableFeatureIdSets.ip.has(ip.assetIpId) &&
                      !meetsFeatureConfidenceThreshold("ip", ip.confidence, ipRecommendation?.confidenceThreshold),
                  )) ||
                (featureLibraryFeatures.featureProduct &&
                  getProductMatches(productRecommendation).some(
                    (product) =>
                      availableFeatureIdSets.product.has(product.assetProductId) &&
                      !meetsFeatureConfidenceThreshold("product", product.confidence, productRecommendation?.confidenceThreshold),
                  )) ||
                (featureLibraryFeatures.featurePerson &&
                  personRecommendation?.faces.some((face) => {
                    const rawSimilarity = getPersonFaceBestRawSimilarity(face);
                    return (
                      face.bestMatch !== null &&
                      availableFeatureIdSets.person.has(face.bestMatch.assetPersonId) &&
                      rawSimilarity !== null &&
                      !isReviewablePersonFace(face)
                    );
                  }));
              const featureRows: {
                key: string;
                featureType: "brand" | "ip" | "product" | "person";
                featureId: string;
                featureClass: string;
                featureTypeName?: string | null;
                classifiedName: string;
                confidence: number;
                rawSimilarity?: number;
                matchingSource?: "assetName";
                tagPaths: string[][];
                isRejected: boolean;
                onToggle: () => void;
              }[] = [];

              for (const brand of featureLibraryFeatures.featureBrand
                ? getAcceptedBrandMatches(brandRecommendation)
                : []) {
                if (!availableFeatureIdSets.brand.has(brand.assetLogoId)) continue;
                featureRows.push({
                  key: `brand-${brand.assetLogoId}`,
                  featureType: "brand",
                  featureId: brand.assetLogoId,
                  featureClass: tResult("featureClassBrand"),
                  featureTypeName: brand.logoTypeName,
                  classifiedName: brand.logoName,
                  confidence: normalizeFeatureConfidence(brand.confidence),
                  tagPaths: brand.recommendedTags?.map((tag) => tag.tagPath) ?? [],
                  isRejected: rejectedFeatureKeys.includes(featureKey("brand", brand.assetLogoId)),
                  onToggle: () => onToggleFeatureKey(featureKey("brand", brand.assetLogoId)),
                });
              }

              for (const ip of featureLibraryFeatures.featureIp
                ? getAcceptedIpMatches(ipRecommendation)
                : []) {
                if (!availableFeatureIdSets.ip.has(ip.assetIpId)) continue;
                featureRows.push({
                  key: `ip-${ip.assetIpId}`,
                  featureType: "ip",
                  featureId: ip.assetIpId,
                  featureClass: tResult("featureClassIp"),
                  featureTypeName: ip.ipTypeName,
                  classifiedName: ip.ipName,
                  confidence: normalizeFeatureConfidence(ip.confidence),
                  tagPaths: ip.recommendedTags?.map((tag) => tag.tagPath) ?? [],
                  isRejected: rejectedFeatureKeys.includes(featureKey("ip", ip.assetIpId)),
                  onToggle: () => onToggleFeatureKey(featureKey("ip", ip.assetIpId)),
                });
              }

              for (const product of featureLibraryFeatures.featureProduct
                ? getAcceptedProductMatches(productRecommendation)
                : []) {
                if (!availableFeatureIdSets.product.has(product.assetProductId)) continue;
                featureRows.push({
                  key: `product-${product.assetProductId}`,
                  featureType: "product",
                  featureId: product.assetProductId,
                  featureClass: tResult("featureClassProduct"),
                  featureTypeName: product.productTypeName,
                  classifiedName: product.productName,
                  confidence: normalizeFeatureConfidence(product.confidence),
                  matchingSource: product.matchingSource,
                  tagPaths: product.recommendedTags?.map((tag) => tag.tagPath) ?? [],
                  isRejected: rejectedFeatureKeys.includes(
                    featureKey("product", product.assetProductId),
                  ),
                  onToggle: () => onToggleFeatureKey(featureKey("product", product.assetProductId)),
                });
              }

              const totalPersonFaces = featureLibraryFeatures.featurePerson
                ? (personRecommendation?.faces.filter(
                    (f) =>
                      isReviewablePersonFace(f) &&
                      f.bestMatch &&
                      availableFeatureIdSets.person.has(f.bestMatch.assetPersonId),
                  ).length ?? 0)
                : 0;
              if (featureLibraryFeatures.featurePerson)
                personRecommendation?.faces.forEach((face) => {
                  if (
                    !isReviewablePersonFace(face) ||
                    !face.bestMatch ||
                    !availableFeatureIdSets.person.has(face.bestMatch.assetPersonId)
                  ) {
                    return;
                  }

                  // Format: "人物N: personName" when multiple people, or just "personName" when single
                  const personDisplayName =
                    totalPersonFaces > 1
                      ? `${tResult("featureClassPerson")}${face.detectionIndex + 1}: ${face.bestMatch.personName}`
                      : face.bestMatch.personName;

                  const rawSimilarity = getPersonFaceBestRawSimilarity(face);
                  if (rawSimilarity === null) {
                    return;
                  }

                  featureRows.push({
                    key: `person-${face.detectionIndex}-${face.bestMatch.assetPersonId}`,
                    featureType: "person",
                    featureId: face.bestMatch.assetPersonId,
                    featureClass: tResult("featureClassPerson"),
                    featureTypeName: face.bestMatch.personTypeName,
                    classifiedName: personDisplayName,
                    confidence: personSimilarityToConfidence(rawSimilarity),
                    rawSimilarity,
                    tagPaths: face.bestMatch.recommendedTags?.map((tag) => tag.tagPath) ?? [],
                    isRejected: rejectedFeatureKeys.includes(
                      featureKey("person", face.bestMatch.assetPersonId),
                    ),
                    onToggle: () =>
                      onToggleFeatureKey(featureKey("person", face.bestMatch!.assetPersonId)),
                  });
                });

              // Sort features by confidence (high to low)
              featureRows.sort((a, b) => b.confidence - a.confidence);

              return (
                <div
                  key={`features-${queueItem.id}`}
                  className="w-full rounded-md bg-[rgba(247,249,252,0.8)] p-4 dark:bg-basic-1"
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <StarIcon className="size-4" />
                    <span className="text-sm font-medium">{t("featureRecognition")}</span>
                    <span className="text-xs text-basic-5">{t("basedOnFeatureLibrary")}</span>
                    <BatchImageModeBadge extra={queueItem.extra} />
                    {!taggingAuditItems.some(({ status }) => status === "pending") ? (
                      <span className="rounded border border-basic-3 px-2 py-0.5 text-xs text-basic-5">{t("reviewedBadge")}</span>
                    ) : null}
                    {isLatestBatch ? (
                      <span className="ml-2 inline-flex items-center rounded-[4px] border border-danger-3 bg-danger-1 px-[13px] py-[2px] text-xs text-danger-6">
                        {t("latest")}
                      </span>
                    ) : null}
                    <span className="flex items-center gap-1 text-xs text-basic-5">
                      <ClockCircleIcon className="size-3" />
                      {formatDate(queueItem.createdAt)}
                    </span>
                    {index === 0 && hasPendingAuditItems && !sourceDeleted ? (
                      <button
                        type="button"
                        disabled={realLoading}
                        className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-primary-6 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => setAddFeatureOpen(true)}
                      >
                        <PlusIcon className="size-3" />
                        {t("addFeatureManually")}
                      </button>
                    ) : null}
                  </div>
                  {index === 0 && hasPendingAuditItems && !sourceDeleted && hasEnabledFeatures && visibleManualFeatures.length > 0 ? (
                    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {visibleManualFeatures.map((feature) => (
                        <ManualFeatureRow
                          key={`manual-${featureKey(feature.featureType, feature.id)}`}
                          feature={feature}
                          featureClass={getFeatureClassLabel(feature.featureType)}
                          thumbnail={
                            feature.thumbnail !== undefined
                              ? feature.thumbnail
                              : featureThumbnails[featureKey(feature.featureType, feature.id)]
                          }
                          disabled={realLoading}
                          onRemove={() => onRemoveManualFeature(featureKey(feature.featureType, feature.id))}
                          onPreview={setPreviewImage}
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    {hasFeatureRecognitionFailure((queueItem.result as TaggingQueueItemResult | null)?.featureDecision) ? (
                      <div role="status" className="rounded-md border border-warning-3 bg-warning-1 p-3 text-sm text-warning-7">
                        {tResult("featureRecognitionIncomplete")}
                      </div>
                    ) : null}
                    {hasManualRows || featureRows.length > 0 ? (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {reviewedManualFeatures.map((feature) => (
                          <ManualFeatureRow
                            key={`reviewed-manual-${featureKey(feature.featureType, feature.id)}`}
                            feature={feature}
                            featureClass={getFeatureClassLabel(feature.featureType)}
                            thumbnail={featureThumbnails[featureKey(feature.featureType, feature.id)]}
                            onPreview={setPreviewImage}
                          />
                        ))}
                        {featureRows.map((feature) => (
                          <FeatureRecognitionRow
                            key={feature.key}
                            decision={(queueItem.result as TaggingQueueItemResult | null)?.featureDecision?.decision.result?.matches.find(match => match.candidateId === `${feature.featureType === "brand" ? "logo" : feature.featureType}:${feature.featureId}`)}
                            featureType={feature.featureType}
                            featureId={feature.featureId}
                            thumbnail={
                              featureThumbnails[featureKey(feature.featureType, feature.featureId)]
                            }
                            featureClass={feature.featureClass}
                            featureTypeName={feature.featureTypeName}
                            classifiedName={feature.classifiedName}
                            confidence={feature.confidence}
                            rawSimilarity={feature.rawSimilarity}
                            matchingSource={feature.matchingSource}
                            tagPaths={feature.tagPaths}
                            isRejected={feature.isRejected}
                            onToggle={feature.onToggle}
                            disabled={realLoading || sourceDeleted}
                            showToggle={finalBatch.some((group) => group.queueItem.id === queueItem.id) && !isScopedFeatureReviewComplete(queueItem) && taggingAuditItems.some(({ status }) => status === "pending")}
                            tooltipAdd={t("tooltipAdd")}
                            tooltipRemove={t("tooltipRemove")}
                            onPreview={setPreviewImage}
                          />
                        ))}
                      </div>
                    ) : hasFeatureRecognitionFailure((queueItem.result as TaggingQueueItemResult | null)?.featureDecision) ? null : (
                      <div className="text-sm text-basic-5">
                        {tResult(
                          isVideoAsset
                            ? "videoFeatureLibraryLimited"
                            : hasFeatureBelowConfidenceThreshold
                              ? "featureConfidenceNotCredible"
                              : "noRecognizedFeatures",
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
      ) : null}

      {historyCount > 0 ? (
        <button
          type="button"
          className="self-start text-xs text-basic-5 hover:text-basic-8 underline-offset-2 hover:underline"
          onClick={() => setShowHistory((current) => !current)}
        >
          {showHistory ? t("hideHistory") : t("showHistory", { count: historyCount })}
        </button>
      ) : null}
      <AddTagDialog
        open={addTagOpen}
        onOpenChange={setAddTagOpen}
        addedIds={
          new Set([
            ...(assetObject.tags as AssetObjectTags).flatMap((tag) =>
              tag.tagId ? [tag.tagId] : [],
            ),
            ...Array.from(auditItemsSet).flatMap((item) =>
              item.leafTagId && !rejectedItems.includes(item.leafTagId) ? [item.leafTagId] : [],
            ),
            ...manualTags.map((tag) => tag.id),
          ])
        }
        onConfirm={onAddManualTags}
      />
      {hasEnabledFeatures ? (
        <AddFeatureDialog
          open={addFeatureOpen}
          onOpenChange={setAddFeatureOpen}
          addedKeys={addedFeatureKeys}
          onConfirm={onAddManualFeatures}
        />
      ) : null}
      {metadataAvailable && contentScope === "all" && <MetadataInlineReview assetObjectId={assetObject.id} rows={metadataReviews} busy={realLoading || sourceDeleted} excludedIds={excludedMetadataIds} onToggle={onToggleMetadata} />}
      <ImagePreviewDialog
        image={previewImage}
        closeLabel={t("closePreview")}
        onOpenChange={(open) => !open && setPreviewImage(null)}
      />
    </div>
  );
}
