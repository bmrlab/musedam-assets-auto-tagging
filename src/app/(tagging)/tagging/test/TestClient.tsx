"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { cn } from "@/lib/utils";
import { MuseDAMID } from "@/musedam/types";
import { BugPlayIcon, FileText, Loader2, PlayIcon, PlusIcon, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { startTaggingTasksAction } from "./actions";

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
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<SelectedAsset[]>([]);

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

  const handleAssetSelection = async () => {
    try {
      setIsProcessing(true);
      const res: {
        selectedAssets: SelectedAsset[];
      } = await dispatchMuseDAMClientAction("assets-selector-modal-open", {});
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
      const result = await startTaggingTasksAction(selectedAssets, {
        matchingSources,
        recognitionAccuracy,
      });

      if (result.success) {
        const { successCount, failedCount, failedAssets } = result.data;

        if (failedCount === 0) {
          toast.success(t("taggingTasksStarted", { successCount }));
        } else {
          toast.warning(t("taggingTasksPartialSuccess", { successCount, failedCount }), {
            description:
              failedAssets.length > 0 ? t("failedAssets", { assets: failedAssets.join(", ") }) : undefined,
          });
        }

        router.push("/tagging/review");
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
  }, [selectedAssets, matchingSources, recognitionAccuracy, router, t]);

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
          <div className="px-4 py-3 border-b">
            <h3 className="font-medium text-sm">{t("uploadTestFiles")}</h3>
          </div>

          <div className="p-4 space-y-4">
            {/* 功能介绍 */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex gap-3">
              <BugPlayIcon className="size-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">{t("testDescription")}</h3>
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
                <p className="text-sm text-muted-foreground">
                  {t("testOnlyDescription")}
                </p>
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
              <Button onClick={handleStartTagging} className="gap-2" disabled={isProcessing}>
                {isProcessing ? (
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
              <Button variant="outline" onClick={handleAssetSelection} disabled={isProcessing}>
                <PlusIcon className="size-4" />
                {t("selectAssetFiles")}
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-background border rounded-md">
          <div className="px-4 py-3 border-b">
            <h3 className="font-medium text-sm">{t("taggingResults")}</h3>
          </div>
          <div className="p-4">...</div>
        </div>
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
              { key: "general", label: t("generalAssets"), icon: "📄" },
              { key: "brand", label: t("brandVisual"), icon: "👁️" },
              { key: "product", label: t("productDisplay"), icon: "📦" },
              { key: "marketing", label: t("marketingPromotion"), icon: "📢" },
              { key: "video", label: t("videoCreative"), icon: "🎬" },
              { key: "archive", label: t("archiveMaterial"), icon: "📚" },
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
