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
        toast.success(`已选择 ${assets.length} 个素材`);
      } else {
        console.log("没有选择素材或返回格式不正确");
        toast.info("未选择任何素材");
      }
    } catch (error) {
      console.error("选择素材失败:", error);
      toast.error("选择素材失败");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartTagging = useCallback(async () => {
    if (selectedAssets.length === 0) {
      toast.error("请先选择素材");
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
          toast.success(`成功发起 ${successCount} 个素材的打标任务`);
        } else {
          toast.warning(`发起打标任务完成：成功 ${successCount} 个，失败 ${failedCount} 个`, {
            description:
              failedAssets.length > 0 ? `失败的素材：${failedAssets.join(", ")}` : undefined,
          });
        }

        router.push("/tagging/review");
      } else {
        toast.error("发起打标任务失败", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("发起打标任务时出错:", error);
      toast.error("发起打标任务时出错");
    } finally {
      setIsProcessing(false);
    }
  }, [selectedAssets, matchingSources, recognitionAccuracy, router]);

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
            <h3 className="font-medium text-sm">上传测试文件</h3>
          </div>

          <div className="p-4 space-y-4">
            {/* 功能介绍 */}
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 flex gap-3">
              <BugPlayIcon className="size-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">测试说明</h3>
                <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                  <p>• AI 将运用现有配置及系统标签体系对指定素材进行打标</p>
                  <p>• 请确保已创建标签体系；也可使用 AI 助手快速生成行业标签体系</p>
                  <p>• AI 匹配测试中的配置仅为测试使用，与 AI 打标设置互不影响</p>
                </div>
              </div>
            </div>

            {/* 素材选择区域 */}
            {selectedAssets.length === 0 ? (
              <div className="p-8 border border-dashed rounded-lg text-center">
                <h3 className="font-medium">选择素材库的文件</h3>
                <p className="text-sm text-muted-foreground">
                  仅测试使用，文件及结果不会保存或进入企业库
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    已选择 {selectedAssets.length} 个文件
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
                    正在处理...
                  </>
                ) : (
                  <>
                    <PlayIcon className="size-4" />
                    开始测试
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleAssetSelection} disabled={isProcessing}>
                <PlusIcon className="size-4" />
                选择资产库文件
              </Button>
            </div>
          </div>
        </div>

        <div className="bg-background border rounded-md">
          <div className="px-4 py-3 border-b">
            <h3 className="font-medium text-sm">打标结果</h3>
          </div>
          <div className="p-4">...</div>
        </div>
      </div>

      {/* 右侧：配置面板 */}
      <div className="space-y-4">
        {/* 选择打标场景 */}
        <div className="bg-background border rounded-md">
          <div className="px-4 py-3 border-b">
            <h3 className="font-medium text-sm">选择打标场景</h3>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {[
              { key: "general", label: "通用素材", icon: "📄" },
              { key: "brand", label: "品牌视觉", icon: "👁️" },
              { key: "product", label: "产品展示", icon: "📦" },
              { key: "marketing", label: "营销推广", icon: "📢" },
              { key: "video", label: "视频创意", icon: "🎬" },
              { key: "archive", label: "历史资料", icon: "📚" },
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
            <h3 className="font-medium text-sm">推荐 AI 识别模式</h3>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {[
              { key: "precise", label: "精准模式", confidence: "80-100% 置信度" },
              {
                key: "balanced",
                label: "平衡模式",
                confidence: "70-100% 置信度",
                recommended: true,
              },
              { key: "broad", label: "宽泛模式", confidence: "60-100% 置信度" },
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
                        推荐
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
            <h3 className="font-medium text-sm">推荐匹配策略</h3>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {[
              { key: "materializedPath", label: "文件类路径匹配" },
              { key: "basicInfo", label: "素材名称匹配" },
              { key: "contentAnalysis", label: "素材内容匹配" },
              { key: "tagKeywords", label: "标签关键词匹配" },
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
