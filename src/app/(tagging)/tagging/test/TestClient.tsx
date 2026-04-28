"use client";

import { getBrandRecommendationFromQueueResult } from "@/app/(tagging)/brand-recommendation";
import { getIpRecommendationFromQueueResult } from "@/app/(tagging)/ip-recommendation";
import { AssetThumbnail } from "@/components/AssetThumbnail";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileImageIcon, TagsIcon } from "@/components/ui/icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { cn } from "@/lib/utils";
import { MuseDAMID } from "@/musedam/types";
import { Loader2, PlayIcon, PlusIcon, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { startTaggingTasksAction } from "./actions";
import { TaggingResult, TaggingResultDisplay } from "./components/TaggingResultDisplay";

interface SelectedAsset {
  id: MuseDAMID; // 素材唯一标识
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
  folderId?: MuseDAMID; // 所在文件夹ID
  folderName?: string; // 所在文件夹名称
}

type DisplayTag = TaggingResult["effectiveTags"][number];

const MATCHING_SOURCE_SEPARATOR = "，";

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

function buildMergedDisplayTags({
  aiTags,
  brandTags,
  brandConfidence,
  ipTags,
  ipConfidence,
  aiSourceLabel,
  brandSourceLabel,
  ipSourceLabel,
}: {
  aiTags: Array<{
    leafTagId?: number;
    tagPath?: string[];
    matchingSource?: string;
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
  aiSourceLabel: string;
  brandSourceLabel: string;
  ipSourceLabel: string;
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
    upsertTag({
      order: index,
      tagId: tag.leafTagId,
      tagPath: tag.tagPath,
      sourceLabel: tag.matchingSource || aiSourceLabel,
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

  return Array.from(mergedTags.values())
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((tag) => ({
      tagPath: tag.tagPath,
      matchingSource: tag.matchingSource,
      confidence: tag.confidence,
      score: tag.score,
    }));
}

export default function TestClient() {
  const t = useTranslations("Tagging.Test");
  const tClient = useTranslations("Tagging.TestClient");
  const tResult = useTranslations("TaggingResultDisplay");
  const tSidebar = useTranslations("Tagging.Sidebar");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<SelectedAsset[]>([]);
  const [taggingResults, setTaggingResults] = useState<TaggingResult[]>([]);
  const [queueItemIds, setQueueItemIds] = useState<number[]>([]);
  const pollingRef = useRef<boolean>(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
        const promises = ids.map(async (id) => {
          const response = await fetch(`/api/tagging/queue-status/${id}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch queue status for ${id}`);
          }
          const data = await response.json();
          return data.success ? data.data : null;
        });

        const results = await Promise.all(promises);
        const validResults = results.filter(Boolean);

        // 检查是否所有任务都已完成
        const allCompleted = validResults.every(
          (result) => result.status === "completed" || result.status === "failed",
        );

        if (allCompleted) {
          // 停止轮询
          stopPolling();

          // 处理完成的结果
          const completedResults = validResults.filter((result) => result.status === "completed");
          const failedResults = validResults.filter((result) => result.status === "failed");

          if (completedResults.length > 0) {
            // 转换结果格式以适配TaggingResultDisplay组件
            const formattedResults = completedResults.map((result) => {
              const { assetObject, result: resultData, extra } = result;
              const brandRecommendation = getBrandRecommendationFromQueueResult(resultData);
              const ipRecommendation = getIpRecommendationFromQueueResult(resultData);
              const linkedBrandTags: Array<{ assetTagId?: number; tagPath?: string[] }> =
                Array.isArray(result.brandLinkedTags) && result.brandLinkedTags.length > 0
                  ? result.brandLinkedTags
                  : (brandRecommendation?.recommendedTags ?? []);
              const linkedIpTags: Array<{ assetTagId?: number; tagPath?: string[] }> =
                Array.isArray(result.ipLinkedTags) && result.ipLinkedTags.length > 0
                  ? result.ipLinkedTags
                  : (ipRecommendation?.recommendedTags ?? []);
              const confidentBrandRecommendation =
                brandRecommendation && !brandRecommendation.noConfidentMatch
                  ? brandRecommendation
                  : null;
              const confidentIpRecommendation =
                ipRecommendation && !ipRecommendation.noConfidentMatch ? ipRecommendation : null;
              const allTags = resultData?.tagsWithScore || [];
              const mergedDisplayTags = buildMergedDisplayTags({
                aiTags: allTags,
                brandTags: confidentBrandRecommendation ? linkedBrandTags : [],
                brandConfidence: Math.round(brandRecommendation?.bestMatch?.confidence ?? 0),
                ipTags: confidentIpRecommendation ? linkedIpTags : [],
                ipConfidence: Math.round(ipRecommendation?.bestMatch?.confidence ?? 0),
                aiSourceLabel: tClient("aiMatching"),
                brandSourceLabel: tResult("brandRecognition"),
                ipSourceLabel: tSidebar("ip"),
              });
              const effectiveTags = mergedDisplayTags.filter((tag) => tag.score >= 80);
              const candidateTags = mergedDisplayTags.filter(
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
                  mergedDisplayTags[0]?.score || 0,
                  brandRecommendation?.bestMatch?.confidence || 0,
                  ipRecommendation?.bestMatch?.confidence || 0,
                ),
                brandRecognition: brandRecommendation
                  ? {
                      noConfidentMatch: brandRecommendation.noConfidentMatch,
                      logoName: brandRecommendation.bestMatch?.logoName || null,
                      confidence: brandRecommendation.bestMatch?.confidence ?? null,
                      similarity: brandRecommendation.bestMatch?.similarity ?? null,
                      recommendedTags: linkedBrandTags.map((tag) => ({
                        tagPath: tag.tagPath || [],
                      })),
                    }
                  : null,
                ipRecognition: ipRecommendation
                  ? {
                      noConfidentMatch: ipRecommendation.noConfidentMatch,
                      ipName: ipRecommendation.bestMatch?.ipName || null,
                      confidence: ipRecommendation.bestMatch?.confidence ?? null,
                      similarity: ipRecommendation.bestMatch?.similarity ?? null,
                      imageSimilarity: ipRecommendation.bestMatch?.imageSimilarity ?? null,
                      descriptionSimilarity:
                        ipRecommendation.bestMatch?.descriptionSimilarity ?? null,
                      recommendedTags: linkedIpTags.map((tag) => ({
                        tagPath: tag.tagPath || [],
                      })),
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
            toast.success(
              tClient("taggingCompleted", {
                successCount: completedResults.length,
                failedCount: failedResults.length,
              }),
            );
          } else {
            toast.error(tClient("allTaggingTasksFailed"));
          }
        }
      } catch (error) {
        console.error(tClient("pollingQueueStatusFailed"), error);
      }
    },
    [stopPolling, tClient, tResult, tSidebar],
  );

  // 开始轮询
  const startPolling = useCallback(
    (ids: number[]) => {
      if (pollingRef.current) return;

      pollingRef.current = true;
      setIsPolling(true);
      setQueueItemIds(ids);
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

  // useEffect(() => {
  //   startPolling([19, 20]);
  // }, [])

  // 组件卸载时清理轮询
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const handleAssetSelection = async () => {
    try {
      setIsProcessing(true);
      const res = await dispatchMuseDAMClientAction("assets-selector-modal-open", {});
      if (!res) return;
      const { selectedAssets: assets } = res;
      if (assets && Array.isArray(assets) && assets.length > 0) {
        // 转换 assets 中的 id 为 MuseDAMID 类型
        const convertedAssets = assets.map((asset) => ({
          ...asset,
          id: new MuseDAMID(asset.id),
        }));
        setSelectedAssets(convertedAssets);
        toast.success(t("assetsSelectedSuccess", { count: assets.length }));
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
                ? t("failedAssets", { assets: failedAssets.join(", ") })
                : undefined,
          });
        }

        // 开始轮询队列状态
        if (queueItemIds.length > 0) {
          startPolling(queueItemIds);
          // toast.info("正在处理中，请稍候...");
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
  }, [selectedAssets, matchingSources, recognitionAccuracy, startPolling, t]);

  const removeAsset = (assetId: MuseDAMID) => {
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
