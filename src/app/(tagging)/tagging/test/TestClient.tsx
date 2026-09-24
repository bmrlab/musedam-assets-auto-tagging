"use client";

import { getBrandRecommendationFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { getIpRecommendationFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import { getPersonRecommendationFromQueueResult } from "@/app/(tagging)/person-recommendation";
import { getProductRecommendationFromQueueResult } from "@/app/(tagging)/product-recommendation";
import { PROCESS_STATE_BADGE_CLASS_NAMES } from "@/app/(tagging)/tagging/components/process-state-badge-classes";
import { AssetThumbnail } from "@/components/AssetThumbnail";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileImageIcon, TagsIcon } from "@/components/ui/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { useFeatureLibraryFeatures } from "@/hooks/use-feature-library";
import { isAcceptedPersonFace } from "@/lib/person/person-match-policy";
import {
  deduplicateProductMatches,
  getAcceptedProductMatches,
  getProductMatches,
} from "@/lib/product/product-match-policy";
import { meetsFeatureConfidenceThreshold } from "@/lib/tagging/feature-confidence";
import { cn } from "@/lib/utils";
import { AlertCircleIcon, Loader2, PlayIcon, PlusIcon, RefreshCwIcon, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { startTaggingTasksAction } from "./actions";
import { TaggingResult, TaggingResultDisplay } from "./components/TaggingResultDisplay";

interface SelectedAsset {
  id: string; // 素材唯一标识
  name: string; // 素材名称
  extension: string; // 文件扩展名
  size: number; // 文件大小（字节）
  url?: string; // 素材访问链接
  thumbnail?: {
    url?: string; // 缩略图链接
  };
  width?: number; // 图片宽度（图片类型）
  height?: number; // 图片高度（图片类型）
  type?: string; // 素材类型
  folderId?: string; // 所在文件夹ID
  folderName?: string; // 所在文件夹名称
}

type DisplayTag = TaggingResult["effectiveTags"][number];

const MATCHING_SOURCE_SEPARATOR = "，";

function toPlainString(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (
      typeof record.value === "string" ||
      typeof record.value === "number" ||
      typeof record.value === "bigint"
    ) {
      return String(record.value);
    }
  }

  return "";
}

function toPlainNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeSelectedAsset(asset: unknown): SelectedAsset | null {
  if (!asset || typeof asset !== "object") {
    return null;
  }

  const record = asset as Record<string, unknown>;
  const id = toPlainString(record.id);
  if (!id) {
    return null;
  }

  const thumbnail = record.thumbnail;
  const thumbnailUrl =
    thumbnail && typeof thumbnail === "object"
      ? toPlainString((thumbnail as Record<string, unknown>).url)
      : "";

  return {
    id,
    name: toPlainString(record.name),
    extension: toPlainString(record.extension),
    size: toPlainNumber(record.size) ?? 0,
    url: toPlainString(record.url || record.downloadUrl) || undefined,
    thumbnail: thumbnailUrl ? { url: thumbnailUrl } : undefined,
    width: toPlainNumber(record.width),
    height: toPlainNumber(record.height),
    type: toPlainString(record.type) || undefined,
    folderId: toPlainString(record.folderId) || undefined,
    folderName: toPlainString(record.folderName) || undefined,
  };
}

function buildDisplayTagKey(tagPath: string[], tagId?: number | null) {
  if (Number.isInteger(tagId) && Number(tagId) > 0) {
    return `id:${tagId}`;
  }

  return `path:${tagPath.join(">")}`;
}

function mergeMatchingSources(current: string, next: string) {
  const sources = current
    .split(MATCHING_SOURCE_SEPARATOR)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!sources.includes(next)) {
    sources.push(next);
  }

  return sources.join(MATCHING_SOURCE_SEPARATOR);
}

// tagPredictionSchema.shape.source 的四个取值 -> 测试页展示用的中文标签，
// 用于把每条标签实际命中的信息源（可能不止一个）如实展示出来，而不是统一显示成"AI 匹配"。
const AI_SOURCE_KEYS = ["basicInfo", "materializedPath", "contentAnalysis", "tagKeywords"] as const;

function buildMergedDisplayTags({
  aiTags,
  brandTags,
  brandConfidence,
  ipTags,
  ipConfidence,
  productTags,
  productConfidence,
  personTags,
  aiSourceLabels,
  aiFallbackSourceLabel,
  brandSourceLabel,
  ipSourceLabel,
  productSourceLabel,
  personSourceLabel,
}: {
  aiTags: Array<{
    leafTagId?: number;
    tagPath?: string[];
    confidenceBySources?: Partial<Record<(typeof AI_SOURCE_KEYS)[number], number>>;
    score?: number;
  }>;
  brandTags: Array<{
    assetTagId?: number;
    tagPath?: string[];
  }>;
  brandConfidence: number;
  ipTags: Array<{
    assetTagId?: number;
    tagPath?: string[];
  }>;
  ipConfidence: number;
  productTags: Array<{
    assetTagId?: number;
    tagPath?: string[];
  }>;
  productConfidence: number;
  personTags: Array<{
    assetTagId?: number;
    tagPath?: string[];
    confidence?: number;
  }>;
  aiSourceLabels: Record<(typeof AI_SOURCE_KEYS)[number], string>;
  aiFallbackSourceLabel: string;
  brandSourceLabel: string;
  ipSourceLabel: string;
  productSourceLabel: string;
  personSourceLabel: string;
}): DisplayTag[] {
  const mergedTags = new Map<string, DisplayTag & { order: number }>();

  const upsertTag = ({
    order,
    tagId,
    tagPath,
    sourceLabel,
    score,
  }: {
    order: number;
    tagId?: number | null;
    tagPath?: string[];
    sourceLabel: string;
    score: number;
  }) => {
    if (!tagPath || tagPath.length === 0) {
      return;
    }

    const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
    const key = buildDisplayTagKey(tagPath, tagId);
    const existing = mergedTags.get(key);

    if (existing) {
      existing.matchingSource = mergeMatchingSources(existing.matchingSource, sourceLabel);
      existing.score = Math.max(existing.score, normalizedScore);
      existing.confidence = Math.max(existing.confidence, normalizedScore);
      return;
    }

    mergedTags.set(key, {
      tagPath,
      matchingSource: sourceLabel,
      confidence: normalizedScore,
      score: normalizedScore,
      order,
    });
  };

  aiTags.forEach((tag, index) => {
    const contributingSourceLabels = AI_SOURCE_KEYS.filter(
      (source) => tag.confidenceBySources?.[source] !== undefined,
    ).map((source) => aiSourceLabels[source]);

    upsertTag({
      order: index,
      tagId: tag.leafTagId,
      tagPath: tag.tagPath,
      // 如实展示这条标签实际是被哪个/哪些信息源命中的（可能不止一个），
      // 而不是笼统地都显示成"AI 匹配"。理论上不应该出现空的情况，兜底用回旧的通用文案。
      sourceLabel:
        contributingSourceLabels.length > 0
          ? contributingSourceLabels.join(MATCHING_SOURCE_SEPARATOR)
          : aiFallbackSourceLabel,
      score: tag.score || 0,
    });
  });

  brandTags.forEach((tag, index) => {
    upsertTag({
      order: aiTags.length + index,
      tagId: tag.assetTagId,
      tagPath: tag.tagPath,
      sourceLabel: brandSourceLabel,
      score: brandConfidence,
    });
  });

  ipTags.forEach((tag, index) => {
    upsertTag({
      order: aiTags.length + brandTags.length + index,
      tagId: tag.assetTagId,
      tagPath: tag.tagPath,
      sourceLabel: ipSourceLabel,
      score: ipConfidence,
    });
  });

  productTags.forEach((tag, index) => {
    upsertTag({
      order: aiTags.length + brandTags.length + ipTags.length + index,
      tagId: tag.assetTagId,
      tagPath: tag.tagPath,
      sourceLabel: productSourceLabel,
      score: productConfidence,
    });
  });

  personTags.forEach((tag, index) => {
    upsertTag({
      order: aiTags.length + brandTags.length + ipTags.length + productTags.length + index,
      tagId: tag.assetTagId,
      tagPath: tag.tagPath,
      sourceLabel: personSourceLabel,
      score: tag.confidence ?? 0,
    });
  });

  return Array.from(mergedTags.values())
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((tag) => ({
      tagPath: tag.tagPath,
      matchingSource: tag.matchingSource,
      confidence: tag.confidence,
      score: tag.score,
    }));
}

type QueueItemStatus = "pending" | "processing" | "completed" | "failed";

// 轮询接口返回的、用于展示进度的最小信息
interface QueueProgressItem {
  id: number;
  status: QueueItemStatus;
  assetName: string;
  createdAt?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  queueEstimate?: {
    aheadCount: number;
    processingCount: number;
    avgProcessingSeconds: number;
    estimatedWaitSeconds: number;
  } | null;
  errorCode?: string;
  errorMessage?: string;
}

interface FailedTaggingResult {
  assetName: string;
  errorCode?: string;
  errorMessage?: string;
}

// 后端 processQueueItem / recoverStaleProcessingItems 会写入 result.error 的已知错误码
const KNOWN_ERROR_CODES = [
  "NO_VALID_TAGS",
  "NO_TAG_TREE",
  "NO_MATCHING_SOURCES_ENABLED",
  "PROCESSING_STALE_TIMEOUT",
  "UNKNOWN",
] as const;
type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

function isKnownErrorCode(code: unknown): code is KnownErrorCode {
  return typeof code === "string" && (KNOWN_ERROR_CODES as readonly string[]).includes(code);
}

// 连续多少次拉取状态失败后停止轮询并提示（2 秒一次，5 次 ≈ 10 秒）
const MAX_CONSECUTIVE_POLL_FAILURES = 5;
// 轮询兜底上限：超过这个时长仍未全部完成，停止轮询并提示（避免后台服务不可用时无限转圈）
const MAX_POLLING_DURATION_MS = 30 * 60 * 1000;
// 排队超过该时长且前面没有任务、也没有任务在处理中，提示后台处理服务可能未运行
const WORKER_IDLE_WARNING_MS = 3 * 60 * 1000;

// 切换页面 / 刷新后恢复测试页状态用（sessionStorage 仅限当前标签页，关闭即清理）
const TEST_PAGE_STATE_STORAGE_KEY = "musedam-tagging-test-page-state";
const TEST_PAGE_STATE_VERSION = 1;

interface PersistedTestPageState {
  version: number;
  selectedAssets: SelectedAsset[];
  taggingResults: TaggingResult[];
  failedResults: FailedTaggingResult[];
  queueItemIds: number[];
  isPolling: boolean;
  pollingStartedAt: number | null;
  selectedScene: string;
  recognitionAccuracy: "precise" | "balanced" | "broad";
  matchingSources: {
    basicInfo: boolean;
    materializedPath: boolean;
    contentAnalysis: boolean;
    tagKeywords: boolean;
  };
}

function loadPersistedTestPageState(): PersistedTestPageState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(TEST_PAGE_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTestPageState> | null;
    if (!parsed || parsed.version !== TEST_PAGE_STATE_VERSION) return null;
    return {
      version: TEST_PAGE_STATE_VERSION,
      selectedAssets: Array.isArray(parsed.selectedAssets) ? parsed.selectedAssets : [],
      taggingResults: Array.isArray(parsed.taggingResults) ? parsed.taggingResults : [],
      failedResults: Array.isArray(parsed.failedResults) ? parsed.failedResults : [],
      queueItemIds: Array.isArray(parsed.queueItemIds)
        ? parsed.queueItemIds.filter((id): id is number => Number.isInteger(id))
        : [],
      isPolling: parsed.isPolling === true,
      pollingStartedAt:
        typeof parsed.pollingStartedAt === "number" ? parsed.pollingStartedAt : null,
      selectedScene: typeof parsed.selectedScene === "string" ? parsed.selectedScene : "general",
      recognitionAccuracy:
        parsed.recognitionAccuracy === "precise" ||
        parsed.recognitionAccuracy === "balanced" ||
        parsed.recognitionAccuracy === "broad"
          ? parsed.recognitionAccuracy
          : "balanced",
      matchingSources: {
        basicInfo: parsed.matchingSources?.basicInfo ?? true,
        materializedPath: parsed.matchingSources?.materializedPath ?? true,
        contentAnalysis: parsed.matchingSources?.contentAnalysis ?? true,
        tagKeywords: parsed.matchingSources?.tagKeywords ?? true,
      },
    };
  } catch {
    return null;
  }
}

function savePersistedTestPageState(state: PersistedTestPageState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TEST_PAGE_STATE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用（隐私模式 / 配额）时静默忽略，不影响主流程
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueueStatusPayload = Record<string, any>;

async function fetchQueueItemStatus(id: number): Promise<QueueStatusPayload> {
  const response = await fetch(`/api/tagging/queue-status/${id}`);
  let payload: {
    success?: boolean;
    data?: QueueStatusPayload;
    error?: string;
    message?: string;
  } = {};
  try {
    payload = await response.json();
  } catch {
    // 非 JSON 响应（网关 502 页面等），走下面的 status 提示
  }
  if (!response.ok || !payload.success || !payload.data) {
    const detail = payload.message || payload.error || `HTTP ${response.status}`;
    throw new Error(`#${id}: ${detail}`);
  }
  return payload.data;
}

function formatDurationParts(totalSeconds: number) {
  const safe = Math.max(0, Math.round(totalSeconds));
  return { minutes: Math.floor(safe / 60), seconds: safe % 60 };
}

export default function TestClient() {
  const t = useTranslations("Tagging.Test");
  const tClient = useTranslations("Tagging.TestClient");
  const tResult = useTranslations("TaggingResultDisplay");
  const tSidebar = useTranslations("Tagging.Sidebar");
  const featureLibraryFeatures = useFeatureLibraryFeatures();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<SelectedAsset[]>([]);
  const [taggingResults, setTaggingResults] = useState<TaggingResult[]>([]);
  const [failedResults, setFailedResults] = useState<FailedTaggingResult[]>([]);
  const [queueItemIds, setQueueItemIds] = useState<number[]>([]);
  // 每个队列任务的实时进度（排队位置 / 预估等待 / 失败原因）
  const [queueProgress, setQueueProgress] = useState<Record<number, QueueProgressItem>>({});
  // 轮询被异常中断的原因（拉取状态连续失败 / 超时），非空时展示错误与"重新检查"按钮
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [pollingStartedAt, setPollingStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pollingRef = useRef<boolean>(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const consecutivePollFailuresRef = useRef(0);
  const pollingStartedAtRef = useRef<number | null>(null);
  // 是否已从 sessionStorage 恢复过状态；恢复前不要把默认值写回去覆盖已保存的内容
  const [hydrated, setHydrated] = useState(false);

  // 配置状态
  const [selectedScene, setSelectedScene] = useState("general");
  const [recognitionAccuracy, setRecognitionAccuracy] = useState<"precise" | "balanced" | "broad">(
    "balanced",
  );
  const [matchingSources, setMatchingSources] = useState({
    basicInfo: true,
    materializedPath: true,
    contentAnalysis: true,
    tagKeywords: true,
  });

  // 场景默认配置
  const sceneConfigs = {
    general: {
      recognitionAccuracy: "balanced" as const,
      matchingSources: {
        basicInfo: true,
        materializedPath: true,
        contentAnalysis: true,
        tagKeywords: true,
      },
    },
    brand: {
      recognitionAccuracy: "precise" as const,
      matchingSources: {
        basicInfo: true,
        materializedPath: false,
        contentAnalysis: true,
        tagKeywords: true,
      },
    },
    product: {
      recognitionAccuracy: "precise" as const,
      matchingSources: {
        basicInfo: true,
        materializedPath: true,
        contentAnalysis: true,
        tagKeywords: false,
      },
    },
    marketing: {
      recognitionAccuracy: "broad" as const,
      matchingSources: {
        basicInfo: true,
        materializedPath: true,
        contentAnalysis: true,
        tagKeywords: true,
      },
    },
    video: {
      recognitionAccuracy: "balanced" as const,
      matchingSources: {
        basicInfo: true,
        materializedPath: true,
        contentAnalysis: false,
        tagKeywords: true,
      },
    },
    archive: {
      recognitionAccuracy: "broad" as const,
      matchingSources: {
        basicInfo: true,
        materializedPath: true,
        contentAnalysis: false,
        tagKeywords: false,
      },
    },
  };

  // 停止轮询
  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    setIsPolling(false);

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // 轮询获取队列状态
  const pollQueueStatus = useCallback(
    async (ids: number[]) => {
      if (!pollingRef.current || ids.length === 0) return;

      try {
        const validResults = await Promise.all(ids.map((id) => fetchQueueItemStatus(id)));
        consecutivePollFailuresRef.current = 0;

        // 更新进度面板：排队位置 / 预估等待 / 失败原因
        setQueueProgress(
          Object.fromEntries(
            validResults.map((item) => [
              item.id,
              {
                id: item.id,
                status: item.status as QueueItemStatus,
                assetName: item.assetObject?.name || `#${item.id}`,
                createdAt: item.createdAt,
                startsAt: item.startsAt,
                endsAt: item.endsAt,
                queueEstimate: item.queueEstimate ?? null,
                errorCode: item.result?.error,
                errorMessage: item.result?.message,
              } satisfies QueueProgressItem,
            ]),
          ),
        );

        // 检查是否所有任务都已完成
        const allCompleted = validResults.every(
          (result) => result.status === "completed" || result.status === "failed",
        );

        if (!allCompleted) {
          // 兜底：轮询时间过长（后台处理服务不可用等）时停止，并明确告知用户
          const startedAt = pollingStartedAtRef.current;
          if (startedAt && Date.now() - startedAt > MAX_POLLING_DURATION_MS) {
            stopPolling();
            const message = tClient("pollingTimeout");
            setPollingError(message);
            toast.error(message);
          }
          return;
        }

        if (allCompleted) {
          // 停止轮询
          stopPolling();
          setPollingError(null);

          // 处理完成的结果
          const completedResults = validResults.filter((result) => result.status === "completed");
          const failedQueueItems = validResults.filter((result) => result.status === "failed");
          const failedDetails: FailedTaggingResult[] = failedQueueItems.map((item) => ({
            assetName: item.assetObject?.name || `#${item.id}`,
            errorCode: typeof item.result?.error === "string" ? item.result.error : undefined,
            errorMessage:
              typeof item.result?.message === "string" ? item.result.message : undefined,
          }));
          setFailedResults(failedDetails);
          const failedDescription =
            failedDetails.length > 0
              ? failedDetails
                  .map(
                    (item) =>
                      `${item.assetName}: ${
                        isKnownErrorCode(item.errorCode)
                          ? tClient(`errorReason.${item.errorCode}`)
                          : item.errorMessage || item.errorCode || tClient("errorReason.UNKNOWN")
                      }`,
                  )
                  .join("\n")
              : undefined;

          if (completedResults.length > 0) {
            // 转换结果格式以适配TaggingResultDisplay组件
            const formattedResults = completedResults.map((result) => {
              const { assetObject, result: resultData, extra } = result;
              const brandRecommendation = featureLibraryFeatures.featureBrand
                ? getBrandRecommendationFromQueueResult(resultData)
                : null;
              const ipRecommendation = featureLibraryFeatures.featureIp
                ? getIpRecommendationFromQueueResult(resultData)
                : null;
              const productRecommendation = featureLibraryFeatures.featureProduct
                ? getProductRecommendationFromQueueResult(resultData)
                : null;
              const personRecommendation = featureLibraryFeatures.featurePerson
                ? getPersonRecommendationFromQueueResult(resultData)
                : null;
              const linkedBrandTags: Array<{ assetTagId?: number; tagPath?: string[] }> =
                Array.isArray(result.brandLinkedTags) && result.brandLinkedTags.length > 0
                  ? result.brandLinkedTags
                  : (brandRecommendation?.recommendedTags ?? []);
              const linkedIpTags: Array<{ assetTagId?: number; tagPath?: string[] }> =
                Array.isArray(result.ipLinkedTags) && result.ipLinkedTags.length > 0
                  ? result.ipLinkedTags
                  : (ipRecommendation?.recommendedTags ?? []);
              const linkedProductTags: Array<{
                assetProductId?: string;
                assetTagId?: number;
                tagPath?: string[];
              }> = Array.isArray(result.productLinkedTags) ? result.productLinkedTags : [];
              const acceptedProducts = getAcceptedProductMatches(productRecommendation);
              // Retain weak candidates so the empty state can explain why no feature is shown.
              const products = deduplicateProductMatches(
                getProductMatches(productRecommendation).filter(
                  (match) =>
                    typeof match?.assetProductId === "string" && match.assetProductId.length > 0,
                ),
              ).map((match) => {
                const refreshedTags = linkedProductTags.filter(
                  (tag) =>
                    tag.assetProductId === match.assetProductId ||
                    (!tag.assetProductId && acceptedProducts.length === 1),
                );
                const recommendedTags = Array.isArray(result.productLinkedTags)
                  ? refreshedTags
                  : match.recommendedTags;

                return {
                  noConfidentMatch: !meetsFeatureConfidenceThreshold("product", match.confidence),
                  productName: match.productName,
                  productTypeName: match.productTypeName,
                  confidence: match.confidence,
                  similarity: match.similarity,
                  imageSimilarity: match.imageSimilarity,
                  descriptionSimilarity: match.descriptionSimilarity,
                  assetProductId: match.assetProductId,
                  recommendedTags: recommendedTags.map((tag) => ({ tagPath: tag.tagPath || [] })),
                };
              });
              const bestProductConfidence = Math.max(
                0,
                ...acceptedProducts.map((product) => product.confidence),
              );
              const linkedPersonTags: Array<{
                assetPersonId?: string;
                assetTagId?: number;
                tagPath?: string[];
              }> = Array.isArray(result.personLinkedTags) ? result.personLinkedTags : [];
              const totalPersonFaces =
                personRecommendation?.faces.filter(isAcceptedPersonFace).length ?? 0;
              const personRecognitionFaces =
                personRecommendation?.faces.map((face) => {
                  const bestMatch = face.bestMatch;
                  const accepted = isAcceptedPersonFace(face);
                  const refreshedTags =
                    accepted && bestMatch && linkedPersonTags.length > 0
                      ? linkedPersonTags.filter(
                          (tag) => tag.assetPersonId === bestMatch.assetPersonId,
                        )
                      : [];
                  const recommendedTags =
                    accepted && refreshedTags.length > 0
                      ? refreshedTags
                      : accepted
                        ? (bestMatch?.recommendedTags ?? [])
                        : [];

                  // Format: "人物N: personName" when multiple people, or just "personName" when single
                  const personDisplayName =
                    totalPersonFaces > 1 && bestMatch?.personName
                      ? `${tResult("featureClassPerson")}${face.detectionIndex + 1}: ${bestMatch.personName}`
                      : (bestMatch?.personName ?? null);

                  return {
                    detectionIndex: face.detectionIndex,
                    noConfidentMatch: !accepted,
                    personName: personDisplayName,
                    personTypeName: bestMatch?.personTypeName ?? null,
                    confidence: bestMatch?.confidence ?? null,
                    similarity: bestMatch?.similarity ?? null,
                    assetPersonId: bestMatch?.assetPersonId,
                    recommendedTags: recommendedTags.map((tag) => ({
                      assetTagId: tag.assetTagId,
                      tagPath: tag.tagPath || [],
                    })),
                  };
                }) ?? [];
              const bestPersonConfidence = Math.max(
                0,
                ...personRecognitionFaces.map((face) => face.confidence ?? 0),
              );
              const allTags = resultData?.tagsWithScore || [];
              const aiDisplayTags = buildMergedDisplayTags({
                aiTags: allTags,
                brandTags: [],
                brandConfidence: Math.round(brandRecommendation?.bestMatch?.confidence ?? 0),
                ipTags: [],
                ipConfidence: Math.round(ipRecommendation?.bestMatch?.confidence ?? 0),
                productTags: [],
                productConfidence: bestProductConfidence,
                personTags: [],
                aiSourceLabels: {
                  basicInfo: t("nameMatching"),
                  materializedPath: t("pathMatching"),
                  contentAnalysis: t("contentMatching"),
                  tagKeywords: t("tagKeywordMatching"),
                },
                aiFallbackSourceLabel: tClient("aiMatching"),
                brandSourceLabel: tResult("brandRecognition"),
                ipSourceLabel: tSidebar("ip"),
                productSourceLabel: tSidebar("product"),
                personSourceLabel: tSidebar("person"),
              });
              const effectiveTags = aiDisplayTags.filter((tag) => tag.score >= 80);
              const candidateTags = aiDisplayTags.filter(
                (tag) => tag.score >= 60 && tag.score < 80,
              );

              return {
                asset: {
                  id: assetObject?.id?.toString() || "",
                  name: assetObject?.name || "",
                  extension: assetObject.extra?.extension || "",
                  size: assetObject.extra?.size || 0,
                  thumbnail: assetObject.extra?.thumbnailAccessUrl,
                  materializedPath: assetObject.materializedPath,
                  categories: [], // 从result中提取
                  processingTime:
                    result.startsAt && result.endsAt
                      ? (new Date(result.endsAt).getTime() - new Date(result.startsAt).getTime()) /
                        1000
                      : 0,
                  recognitionMode:
                    extra?.recognitionAccuracy === "precise"
                      ? tClient("preciseMode")
                      : extra?.recognitionAccuracy === "balanced"
                        ? tClient("balancedMode")
                        : tClient("broadMode"),
                },
                overallScore: Math.max(
                  aiDisplayTags[0]?.score || 0,
                  brandRecommendation?.bestMatch?.confidence || 0,
                  ipRecommendation?.bestMatch?.confidence || 0,
                  bestProductConfidence,
                  bestPersonConfidence,
                ),
                brandRecognition: brandRecommendation
                  ? {
                      noConfidentMatch: brandRecommendation.noConfidentMatch,
                      logoName: brandRecommendation.bestMatch?.logoName || null,
                      logoTypeName: brandRecommendation.bestMatch?.logoTypeName || null,
                      confidence: brandRecommendation.bestMatch?.confidence ?? null,
                      similarity: brandRecommendation.bestMatch?.similarity ?? null,
                      assetLogoId: brandRecommendation.bestMatch?.assetLogoId,
                      recommendedTags: linkedBrandTags.map((tag) => ({
                        tagPath: tag.tagPath || [],
                      })),
                    }
                  : null,
                ipRecognition: ipRecommendation
                  ? {
                      noConfidentMatch: ipRecommendation.noConfidentMatch,
                      ipName: ipRecommendation.bestMatch?.ipName || null,
                      ipTypeName: ipRecommendation.bestMatch?.ipTypeName || null,
                      confidence: ipRecommendation.bestMatch?.confidence ?? null,
                      similarity: ipRecommendation.bestMatch?.similarity ?? null,
                      imageSimilarity: ipRecommendation.bestMatch?.imageSimilarity ?? null,
                      descriptionSimilarity:
                        ipRecommendation.bestMatch?.descriptionSimilarity ?? null,
                      assetIpId: ipRecommendation.bestMatch?.assetIpId,
                      recommendedTags: linkedIpTags.map((tag) => ({
                        tagPath: tag.tagPath || [],
                      })),
                    }
                  : null,
                products,
                personRecognition: personRecommendation
                  ? {
                      noConfidentMatch: personRecommendation.noConfidentMatch,
                      faceCount: personRecommendation.faceCount,
                      faces: personRecognitionFaces,
                    }
                  : null,
                effectiveTags,
                candidateTags,
                // 策略分析详情 - 从所有标签的confidenceBySources中提取
                strategyAnalysis: (() => {
                  const strategyMap = new Map<string, { weight: number; score: number }>();

                  // 遍历所有标签的confidenceBySources
                  allTags.forEach((tag: { confidenceBySources?: Record<string, number> }) => {
                    if (tag.confidenceBySources) {
                      Object.entries(tag.confidenceBySources).forEach(
                        ([source, confidence]: [string, number]) => {
                          if (!strategyMap.has(source)) {
                            strategyMap.set(source, { weight: 0, score: 0 });
                          }
                          const current = strategyMap.get(source)!;
                          current.weight += confidence;
                          current.score = Math.max(current.score, confidence * 100); // 转换为百分比
                        },
                      );
                    }
                  });

                  // 转换为数组格式
                  return Array.from(strategyMap.entries()).map(([key, value]) => ({
                    key,
                    weight: Math.round(value.weight * 100), // 转换为百分比
                    score: Math.round(value.score),
                  }));
                })(),
              };
            });
            setTaggingResults(formattedResults);
            const completedMessage = tClient("taggingCompleted", {
              successCount: completedResults.length,
              failedCount: failedQueueItems.length,
            });
            if (failedQueueItems.length > 0) {
              toast.warning(completedMessage, { description: failedDescription });
            } else {
              toast.success(completedMessage);
            }
          } else {
            toast.error(tClient("allTaggingTasksFailed"), { description: failedDescription });
          }
        }
      } catch (error) {
        console.error(tClient("pollingQueueStatusFailed"), error);
        consecutivePollFailuresRef.current += 1;
        if (consecutivePollFailuresRef.current >= MAX_CONSECUTIVE_POLL_FAILURES) {
          // 后端接口持续异常：不再无声地转圈，停止轮询并把错误原因展示出来
          stopPolling();
          const message = tClient("pollingErrorStopped", {
            message: error instanceof Error ? error.message : String(error),
          });
          setPollingError(message);
          toast.error(tClient("pollingQueueStatusFailed"), {
            description: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
    [featureLibraryFeatures, stopPolling, t, tClient, tResult, tSidebar],
  );

  // 开始轮询
  const startPolling = useCallback(
    (ids: number[]) => {
      if (pollingRef.current) return;

      pollingRef.current = true;
      consecutivePollFailuresRef.current = 0;
      setIsPolling(true);
      setQueueItemIds(ids);
      setPollingError(null);
      // 立即执行一次
      pollQueueStatus(ids);

      // 设置定时器，每2秒轮询一次
      const interval = setInterval(() => {
        pollQueueStatus(ids);
      }, 2000);

      pollingIntervalRef.current = interval;
    },
    [pollQueueStatus],
  );

  // 重新开始一轮轮询（首次发起 / 从其它页面切回来恢复 / 拉取状态失败后手动重试）
  const beginPollingSession = useCallback(
    (ids: number[], startedAt: number) => {
      pollingStartedAtRef.current = startedAt;
      setPollingStartedAt(startedAt);
      startPolling(ids);
    },
    [startPolling],
  );

  // 首次挂载：从 sessionStorage 恢复上一次的选择、结果与进行中的任务，切页回来不丢
  useEffect(() => {
    const persisted = loadPersistedTestPageState();
    if (persisted) {
      setSelectedAssets(persisted.selectedAssets);
      setTaggingResults(persisted.taggingResults);
      setFailedResults(persisted.failedResults);
      setQueueItemIds(persisted.queueItemIds);
      setSelectedScene(persisted.selectedScene);
      setRecognitionAccuracy(persisted.recognitionAccuracy);
      setMatchingSources(persisted.matchingSources);
      if (persisted.isPolling && persisted.queueItemIds.length > 0) {
        beginPollingSession(persisted.queueItemIds, persisted.pollingStartedAt ?? Date.now());
      }
    }
    setHydrated(true);
    // 仅在挂载时恢复一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 状态变化时写回 sessionStorage
  useEffect(() => {
    if (!hydrated) return;
    savePersistedTestPageState({
      version: TEST_PAGE_STATE_VERSION,
      selectedAssets,
      taggingResults,
      failedResults,
      queueItemIds,
      isPolling,
      pollingStartedAt,
      selectedScene,
      recognitionAccuracy,
      matchingSources,
    });
  }, [
    hydrated,
    selectedAssets,
    taggingResults,
    failedResults,
    queueItemIds,
    isPolling,
    pollingStartedAt,
    selectedScene,
    recognitionAccuracy,
    matchingSources,
  ]);

  // 轮询期间每秒刷新一次"已用时"
  useEffect(() => {
    if (!isPolling) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isPolling]);

  // 组件卸载时清理轮询（isPolling 已持久化，切回页面会自动恢复）
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const formatDuration = useCallback(
    (totalSeconds: number) => {
      const { minutes, seconds } = formatDurationParts(totalSeconds);
      return minutes > 0
        ? tClient("durationMinutes", { minutes, seconds })
        : tClient("durationSeconds", { seconds });
    },
    [tClient],
  );

  const describeFailure = useCallback(
    (item: { errorCode?: string; errorMessage?: string }) => {
      if (isKnownErrorCode(item.errorCode) && item.errorCode !== "UNKNOWN") {
        return tClient(`errorReason.${item.errorCode}`);
      }
      return item.errorMessage || item.errorCode || tClient("errorReason.UNKNOWN");
    },
    [tClient],
  );

  // 进度汇总：完成数、最长预估等待、是否疑似后台服务未运行
  const progressSummary = useMemo(() => {
    const items = queueItemIds
      .map((id) => queueProgress[id])
      .filter((item): item is QueueProgressItem => Boolean(item));
    const doneCount = items.filter(
      (item) => item.status === "completed" || item.status === "failed",
    ).length;
    const activeItems = items.filter(
      (item) => item.status === "pending" || item.status === "processing",
    );
    const estimatedWaitSeconds = activeItems.reduce(
      (max, item) => Math.max(max, item.queueEstimate?.estimatedWaitSeconds ?? 0),
      0,
    );
    const elapsedMs = pollingStartedAt ? Math.max(0, now - pollingStartedAt) : 0;
    const workerMayBeIdle =
      elapsedMs > WORKER_IDLE_WARNING_MS &&
      activeItems.length > 0 &&
      activeItems.every(
        (item) =>
          item.status === "pending" &&
          (item.queueEstimate?.aheadCount ?? 0) === 0 &&
          (item.queueEstimate?.processingCount ?? 0) === 0,
      );
    return { items, doneCount, estimatedWaitSeconds, elapsedMs, workerMayBeIdle };
  }, [queueItemIds, queueProgress, pollingStartedAt, now]);

  const handleRetryPolling = useCallback(() => {
    if (queueItemIds.length === 0) return;
    beginPollingSession(queueItemIds, pollingStartedAtRef.current ?? Date.now());
  }, [beginPollingSession, queueItemIds]);

  const handleAssetSelection = async () => {
    try {
      setIsProcessing(true);
      const res = await dispatchMuseDAMClientAction("assets-selector-modal-open", {});
      if (!res) return;
      const { selectedAssets: assets } = res;
      if (assets && Array.isArray(assets) && assets.length > 0) {
        const convertedAssets = assets
          .map((asset) => normalizeSelectedAsset(asset))
          .filter((asset): asset is SelectedAsset => Boolean(asset));
        if (convertedAssets.length === 0) {
          toast.info(t("noAssetsSelected"));
          return;
        }

        setSelectedAssets(convertedAssets);
        toast.success(t("assetsSelectedSuccess", { count: convertedAssets.length }));
      } else {
        toast.info(t("noAssetsSelected"));
      }
    } catch (error) {
      console.error(t("assetSelectionFailed"), error);
      toast.error(t("assetSelectionFailed"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartTagging = useCallback(async () => {
    if (selectedAssets.length === 0) {
      toast.error(t("selectAssetsFirst"));
      return;
    }

    try {
      setIsProcessing(true);
      setTaggingResults([]); // 清空之前的结果
      setFailedResults([]);
      setQueueProgress({});
      setPollingError(null);

      const result = await startTaggingTasksAction(selectedAssets, {
        matchingSources,
        recognitionAccuracy,
      });

      if (result.success) {
        const { successCount, failedCount, failedAssets, queueItemIds } = result.data;

        if (failedCount === 0) {
          toast.success(t("taggingTasksStarted", { successCount }));
        } else {
          toast.warning(t("taggingTasksPartialSuccess", { successCount, failedCount }), {
            description:
              failedAssets.length > 0
                ? t("failedAssets", {
                    assets: failedAssets.map((item) => `${item.name}（${item.reason}）`).join(", "),
                  })
                : undefined,
          });
          // 发起阶段就失败的素材也列入失败结果，避免用户只看到数字看不到原因
          setFailedResults(
            failedAssets.map((item) => ({ assetName: item.name, errorMessage: item.reason })),
          );
        }

        // 开始轮询队列状态
        if (queueItemIds.length > 0) {
          beginPollingSession(queueItemIds, Date.now());
        }

        // 不再跳转到review页面，而是在当前页面显示结果
        // router.push("/tagging/review");
      } else {
        toast.error(t("startTaggingFailed"), {
          description: result.message,
        });
      }
    } catch (error) {
      console.error(t("startTaggingError"), error);
      toast.error(t("startTaggingError"));
    } finally {
      setIsProcessing(false);
    }
  }, [selectedAssets, matchingSources, recognitionAccuracy, beginPollingSession, t]);

  const removeAsset = (assetId: string) => {
    setSelectedAssets((prev) => prev.filter((asset) => asset.id !== assetId));
  };

  const handleMatchingSourceChange = (key: keyof typeof matchingSources, checked: boolean) => {
    setMatchingSources((prev) => ({ ...prev, [key]: checked }));
  };

  const handleSceneSelect = (sceneKey: string) => {
    setSelectedScene(sceneKey);
    const config = sceneConfigs[sceneKey as keyof typeof sceneConfigs];
    if (config) {
      setRecognitionAccuracy(config.recognitionAccuracy);
      setMatchingSources(config.matchingSources);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 左侧：素材选择区域 */}
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-background border rounded-md">
          <div className="px-4 py-3 border-b flex justify-between items-center">
            <h3 className="font-medium text-sm">{t("uploadTestFiles")}</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                dispatchMuseDAMClientAction("goto", {
                  url: "/home/dashboard/tag",
                  target: "_blank",
                })
              }
            >
              <TagsIcon />
              {tClient("manageTagSystem")}
            </Button>
          </div>

          <div className="p-4 space-y-5">
            {/* 功能介绍 */}
            <div className="text-basic-8 bg-primary-1 border-primary-5 border rounded-md p-4 flex gap-3">
              <div className="text-[13px] leading-[18px]">
                <h3 className="font-medium mb-2">💡 {t("testDescription")}</h3>
                <ul className="space-y-1 ">
                  <li>{t("testDescriptionText1")}</li>
                  <li>{t("testDescriptionText2")}</li>
                  <li>{t("testDescriptionText3")}</li>
                </ul>
              </div>
            </div>

            {/* 素材选择区域 */}
            {selectedAssets.length === 0 ? (
              <div
                className="w-full h-[200px] flex flex-col justify-center items-center border border-dashed border-basic-4 rounded-md text-center bg-basic-1 hover:border-primary-6 ease-in-out duration-300 transition-all cursor-pointer"
                onClick={handleAssetSelection}
              >
                <FileImageIcon className="size-12 text-primary-6 mb-5" />
                <h3 className="leading-6 mb-1">{t("selectAssetsFromLibrary")}</h3>
                <p className="text-xs text-basic-5">{t("testOnlyDescription")}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-basic-5">
                    {t("selectedFilesCount", { count: selectedAssets.length })}
                  </p>
                  {/*<Button
                      variant="outline"
                      size="sm"
                      onClick={handleAssetSelection}
                      disabled={isProcessing}
                    >
                      添加更多文件
                    </Button>*/}
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {selectedAssets.map((asset) => (
                    <div
                      key={asset.id.toString()}
                      className="flex items-center justify-between p-3 border border-basic-4 rounded-md"
                    >
                      <div className="flex items-center gap-3 shrink-0">
                        <AssetThumbnail
                          asset={{
                            thumbnailUrl: asset.thumbnail?.url,
                            extension: asset.extension,
                          }}
                          className="rounded size-8"
                          maxWidth={32}
                          maxHeight={32}
                        />
                        <div>
                          <p className="font-medium text-sm">{asset.name}</p>
                          <p className="text-xs text-basic-5">
                            {asset.extension} • {(asset.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              disabled={isProcessing}
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeAsset(asset.id);
                              }}
                              className="text-basic-5 size-8 p-0 hover:text-danger-6"
                            >
                              <Trash className="text-current" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t("removeAsset")}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-start gap-3">
              <Button
                onClick={handleStartTagging}
                className="gap-2"
                disabled={isProcessing || isPolling}
                size="sm"
              >
                {isProcessing || isPolling ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("processing")}
                  </>
                ) : (
                  <>
                    <PlayIcon className="size-4" />
                    {t("startTest")}
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleAssetSelection}
                disabled={isProcessing || isPolling}
                size="sm"
              >
                <PlusIcon className="size-4" />
                {t("selectAssetFiles")}
              </Button>
              {/* {isPolling && (
                <Button
                  variant="outline"
                  onClick={stopPolling}
                  className="text-orange-600 hover:text-orange-700"
                >
                  停止轮询
                </Button>
              )} */}
            </div>

            {/* 处理进度：排队位置 / 预估等待时长 / 每个素材的状态与失败原因 */}
            {(isPolling || pollingError || progressSummary.items.length > 0) &&
              queueItemIds.length > 0 && (
                <div className="border border-basic-4 rounded-md">
                  <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {isPolling && <Loader2 className="size-4 animate-spin text-primary-6" />}
                      <span>{tClient("processingStatus")}</span>
                      <span className="text-basic-5 font-normal">
                        {tClient("progressCount", {
                          done: progressSummary.doneCount,
                          total: queueItemIds.length,
                        })}
                      </span>
                    </div>
                    {isPolling && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-basic-5">
                        {progressSummary.estimatedWaitSeconds > 0 && (
                          <span>
                            {tClient("queueWaitEstimate", {
                              duration: formatDuration(progressSummary.estimatedWaitSeconds),
                            })}
                          </span>
                        )}
                        <span>
                          {tClient("elapsed", {
                            duration: formatDuration(progressSummary.elapsedMs / 1000),
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-4 space-y-3">
                    {pollingError && (
                      <div className="flex items-start gap-2 rounded-md border border-danger-6/40 bg-danger-1 px-3 py-2 text-xs text-danger-6">
                        <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-2">
                          <p>{pollingError}</p>
                          <Button size="sm" variant="outline" onClick={handleRetryPolling}>
                            <RefreshCwIcon className="size-3.5" />
                            {tClient("retryPolling")}
                          </Button>
                        </div>
                      </div>
                    )}
                    {isPolling && progressSummary.workerMayBeIdle && (
                      <div className="flex items-start gap-2 rounded-md border border-warning-6/40 bg-warning-1 px-3 py-2 text-xs text-warning-6">
                        <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
                        <p>{tClient("workerIdleWarning")}</p>
                      </div>
                    )}
                    {isPolling && progressSummary.items.length === 0 && (
                      <p className="text-xs text-basic-5">{tClient("pollingDescription")}</p>
                    )}
                    {progressSummary.items.length > 0 && (
                      <ul className="space-y-2">
                        {progressSummary.items.map((item) => {
                          const statusLabel = tClient(`status.${item.status}`);
                          let detail: string | null = null;
                          if (item.status === "pending") {
                            detail = tClient("queueAhead", {
                              count: item.queueEstimate?.aheadCount ?? 0,
                            });
                          } else if (item.status === "processing") {
                            const startedAtMs = item.startsAt
                              ? new Date(item.startsAt).getTime()
                              : NaN;
                            detail = Number.isFinite(startedAtMs)
                              ? tClient("processingFor", {
                                  duration: formatDuration((now - startedAtMs) / 1000),
                                })
                              : null;
                          } else if (item.status === "failed") {
                            detail = describeFailure(item);
                          }
                          return (
                            <li
                              key={item.id}
                              className="flex items-start justify-between gap-3 text-xs"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium text-sm">{item.assetName}</p>
                                {detail && (
                                  <p
                                    className={cn(
                                      "mt-0.5 break-all",
                                      item.status === "failed" ? "text-danger-6" : "text-basic-5",
                                    )}
                                  >
                                    {detail}
                                  </p>
                                )}
                              </div>
                              <span
                                className={cn(
                                  "shrink-0 rounded border px-2 py-0.5",
                                  item.status === "pending"
                                    ? "border-basic-4 bg-basic-1 text-basic-6"
                                    : PROCESS_STATE_BADGE_CLASS_NAMES[item.status],
                                )}
                              >
                                {statusLabel}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}
          </div>
        </div>

        {/* 轮询状态显示 */}
        {isPolling && (
          <div className="bg-background border rounded-md">
            <div className="px-4 py-3 border-b">
              <h3 className="font-medium text-sm">{tClient("processingStatus")}</h3>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="size-4 animate-spin text-blue-600" />
                <div>
                  <p className="text-sm font-medium">
                    {tClient("processingTasks", { count: queueItemIds.length })}
                  </p>
                  <p className="text-xs text-basic-5">{tClient("pollingDescription")}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 失败的素材：把后端的失败原因展示出来，而不是只有一句"失败 N 个" */}
        {!isPolling && failedResults.length > 0 && (
          <div className="bg-background border rounded-md">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <AlertCircleIcon className="size-4 text-danger-6" />
              <h3 className="font-medium text-sm">
                {tClient("failedResultsTitle", { count: failedResults.length })}
              </h3>
            </div>
            <ul className="p-4 space-y-2">
              {failedResults.map((item, index) => (
                <li key={`${item.assetName}-${index}`} className="text-sm">
                  <span className="font-medium">{item.assetName}</span>
                  <span className="text-basic-5">：</span>
                  <span className="text-danger-6 break-all">{describeFailure(item)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {taggingResults.length > 0 && (
          <div className="bg-background border rounded-md">
            <div className="px-4 py-3 border-b">
              <h3 className="font-medium text-sm">{t("taggingResults")}</h3>
            </div>
            <div className="p-4">
              <div className="space-y-6">
                {taggingResults.map((result, index) => (
                  <TaggingResultDisplay key={index} result={result} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 右侧：配置面板 */}
      <div className="space-y-4">
        {/* 选择打标场景 */}
        <div className="bg-background border rounded-md">
          <div className="px-4 py-3 border-b">
            <h3 className="font-medium text-sm">{t("selectTaggingScene")}</h3>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {[
              { key: "general", label: t("generalAssets"), icon: "📂" },
              { key: "brand", label: t("brandVisual"), icon: "🧑‍🎨" },
              { key: "product", label: t("productDisplay"), icon: "📸" },
              { key: "marketing", label: t("marketingPromotion"), icon: "🎯" },
              { key: "video", label: t("videoCreative"), icon: "🎬" },
              { key: "archive", label: t("archiveMaterial"), icon: "🗃️" },
            ].map(({ key, label, icon }) => (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-2",
                  "py-2 px-3 border border-basic-4 rounded-md cursor-pointer transition-all ",
                  selectedScene === key
                    ? "bg-primary-1 border-primary-6 ring ring-primary-6"
                    : "hover:border-primary-6",
                )}
                onClick={() => handleSceneSelect(key)}
              >
                <div className="text-xl">{icon}</div>
                <div className="text-sm font-medium">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* AI识别模式 */}
        <div className="bg-background border rounded-md">
          <div className="px-4 py-3 border-b">
            <h3 className="font-medium text-sm">{t("recommendedAIRecognition")}</h3>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {[
              { key: "precise", label: t("preciseMode"), confidence: t("preciseConfidence") },
              {
                key: "balanced",
                label: t("balancedMode"),
                confidence: t("balancedConfidence"),
              },
              { key: "broad", label: t("broadMode"), confidence: t("broadConfidence") },
            ].map(({ key, label, confidence }) => (
              <div
                key={key}
                className={cn(
                  "border rounded-md p-3 cursor-pointer border-basic-4 transition-all hover:border-primary/50",
                  recognitionAccuracy === key
                    ? "bg-primary-1 border-primary-6 ring ring-primary-6"
                    : "hover:border-primary-6",
                )}
                onClick={() => setRecognitionAccuracy(key as typeof recognitionAccuracy)}
              >
                <div className="text-center space-y-1">
                  <div className="flex items-center justify-center gap-1">
                    <h3 className="font-medium text-sm">{label}</h3>
                  </div>
                  <div className="text-xs font-medium text-basic-5">{confidence}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 匹配策略 */}
        <div className="bg-background border rounded-md">
          <div className="px-4 py-3 border-b">
            <h3 className="font-medium text-sm">{t("recommendedMatchingStrategy")}</h3>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {[
              { key: "materializedPath", label: t("pathMatching") },
              { key: "basicInfo", label: t("nameMatching") },
              { key: "contentAnalysis", label: t("contentMatching") },
              { key: "tagKeywords", label: t("tagKeywordMatching") },
            ].map(({ key, label }) => (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-2",
                  "py-2 px-3 border rounded-md border-basic-4",
                )}
              >
                <Checkbox
                  checked={matchingSources[key as keyof typeof matchingSources]}
                  onCheckedChange={(checked) =>
                    handleMatchingSourceChange(
                      key as keyof typeof matchingSources,
                      checked as boolean,
                    )
                  }
                />
                <div className="space-y-1">
                  <h3 className="font-medium text-sm">{label}</h3>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
