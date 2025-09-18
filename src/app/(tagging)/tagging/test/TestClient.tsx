"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { cn } from "@/lib/utils";
import { MuseDAMID } from "@/musedam/types";
import { BugPlayIcon, FileText, Loader2, PlayIcon, PlusIcon, TagsIcon, X } from "lucide-react";
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
  thumbnail?: string; // 缩略图链接
  width?: number; // 图片宽度（图片类型）
  height?: number; // 图片高度（图片类型）
  type?: string; // 素材类型
  folderId?: MuseDAMID; // 所在文件夹ID
  folderName?: string; // 所在文件夹名称
}

export default function TestClient() {
  const t = useTranslations("Tagging.Test");
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<SelectedAsset[]>([]);
  const [taggingResults, setTaggingResults] = useState<TaggingResult[]>([]);
  const [queueItemIds, setQueueItemIds] = useState<number[]>([]);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const pollingRef = useRef<boolean>(false);

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
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
  }, [pollingInterval]);

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
              // 按置信度分类标签
              const allTags = resultData?.tagsWithScore || [];
              const effectiveTags = allTags.filter(
                (tag: { score?: number }) => (tag.score || 0) >= 80,
              );
              const candidateTags = allTags.filter(
                (tag: { score?: number }) => (tag.score || 0) >= 60 && (tag.score || 0) < 80,
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
                      ? "精准模式"
                      : extra?.recognitionAccuracy === "balanced"
                        ? "平衡模式"
                        : "宽泛模式",
                },
                overallScore: resultData?.tagsWithScore?.[0]?.score || 0,
                // 生效标签
                effectiveTags: effectiveTags.map(
                  (tag: { tagPath?: string[]; matchingSource?: string; score?: number }) => ({
                    tagPath: tag.tagPath || [],
                    matchingSource: tag.matchingSource || "AI匹配",
                    confidence: Math.floor(tag.score || 0),
                    score: tag.score || 0,
                  }),
                ),
                // 候选标签
                candidateTags: candidateTags.map(
                  (tag: { tagPath?: string[]; matchingSource?: string; score?: number }) => ({
                    tagPath: tag.tagPath || [],
                    matchingSource: tag.matchingSource || "AI匹配",
                    confidence: Math.floor(tag.score || 0),
                    score: tag.score || 0,
                  }),
                ),
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
              `打标完成！成功 ${completedResults.length} 个，失败 ${failedResults.length} 个`,
            );
          } else {
            toast.error("所有打标任务都失败了");
          }
        }
      } catch (error) {
        console.error("轮询队列状态失败:", error);
      }
    },
    [stopPolling],
  );

  // 开始轮询
  const startPolling = useCallback(
    (ids: number[]) => {
      if (pollingRef.current) return;

      pollingRef.current = true;
      setQueueItemIds(ids);
      // 立即执行一次
      pollQueueStatus(ids);

      // 设置定时器，每2秒轮询一次
      const interval = setInterval(() => {
        pollQueueStatus(ids);
      }, 2000);

      setPollingInterval(interval);
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
  }, []);

  const handleAssetSelection = async () => {
    try {
      setIsProcessing(true);
      const res = await dispatchMuseDAMClientAction("assets-selector-modal-open", {});
      const { selectedAssets: assets } = res;
      if (assets && Array.isArray(assets) && assets.length > 0) {
        setSelectedAssets(assets);
        toast.success(t("assetsSelectedSuccess", { count: assets.length }));
      } else {
        console.log(t("noAssetsSelectedInfo"));
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
              onClick={() => dispatchMuseDAMClientAction("goto", { url: "/home/dashboard/tag" })}
            >
              <TagsIcon className="rotate-180 scale-y-[-1]" />
              管理标签体系
            </Button>
          </div>

          <div className="p-4 space-y-4">
            {/* 功能介绍 */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex gap-3">
              <BugPlayIcon className="size-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                  {t("testDescription")}
                </h3>
                <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                  <p>{t("testDescriptionText1")}</p>
                  <p>{t("testDescriptionText2")}</p>
                  <p>{t("testDescriptionText3")}</p>
                </div>
              </div>
            </div>

            {/* 素材选择区域 */}
            {selectedAssets.length === 0 ? (
              <div className="p-8 border border-dashed rounded-lg text-center">
                <h3 className="font-medium">{t("selectAssetsFromLibrary")}</h3>
                <p className="text-sm text-muted-foreground">{t("testOnlyDescription")}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
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
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="size-4 text-muted-foreground" />
                        <div>
                          <p className="font-medium text-sm">{asset.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {asset.extension} • {(asset.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAsset(asset.id)}
                        disabled={isProcessing}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-start gap-3">
              <Button
                onClick={handleStartTagging}
                className="gap-2"
                disabled={isProcessing || pollingRef.current}
              >
                {isProcessing || pollingRef.current ? (
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
                disabled={isProcessing || pollingRef.current}
              >
                <PlusIcon className="size-4" />
                {t("selectAssetFiles")}
              </Button>
              {/* {pollingRef.current && (
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
        {pollingRef.current && (
          <div className="bg-background border rounded-md">
            <div className="px-4 py-3 border-b">
              <h3 className="font-medium text-sm">处理状态</h3>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="size-4 animate-spin text-blue-600" />
                <div>
                  <p className="text-sm font-medium">正在处理 {queueItemIds.length} 个打标任务</p>
                  <p className="text-xs text-muted-foreground">
                    每2秒检查一次状态，完成后将自动显示结果
                  </p>
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
                  "py-2 px-3 border rounded-lg cursor-pointer transition-all hover:border-primary/50",
                  selectedScene === key ? "bg-primary/5 border-primary" : "hover:bg-muted/50",
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
                recommended: true,
              },
              { key: "broad", label: t("broadMode"), confidence: t("broadConfidence") },
            ].map(({ key, label, confidence, recommended }) => (
              <div
                key={key}
                className={cn(
                  "border rounded-lg p-3 cursor-pointer transition-all hover:border-primary/50",
                  recognitionAccuracy === key ? "border-primary bg-primary/5" : "",
                )}
                onClick={() => setRecognitionAccuracy(key as typeof recognitionAccuracy)}
              >
                <div className="text-center space-y-1">
                  <div className="flex items-center justify-center gap-1">
                    <h3 className="font-medium text-sm">{label}</h3>
                    {recommended && (
                      <span className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded">
                        {t("recommended")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    {confidence}
                  </div>
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
                className={cn("flex items-center gap-2", "py-2 px-3 border rounded-lg")}
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
