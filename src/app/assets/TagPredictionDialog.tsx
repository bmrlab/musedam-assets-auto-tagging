"use client";
import { SourceBasedTagPredictions } from "@/app/(tagging)/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { AssetObject } from "@/prisma/client";
import { Bot, CheckCircle, Sparkles, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { predictAssetTagsAction } from "./actions";

interface TagPredictionDialogProps {
  asset: AssetObject | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function TagPredictionDialog({ asset, isOpen, onClose }: TagPredictionDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [predictions, setPredictions] = useState<SourceBasedTagPredictions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startPrediction = useCallback(async () => {
    if (!asset) return;

    setIsLoading(true);
    setError(null);
    setPredictions(null);

    try {
      const result = await predictAssetTagsAction(asset.id);
      // const result = await predictAssetTagsAndWaitAction(asset.id);
      if (result.success) {
        toast.success("打标任务已发起");
        // setPredictions(result.data.predictions);
      } else {
        setError(result.message || "预测失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setIsLoading(false);
    }
  }, [asset]);

  const handleClose = useCallback(() => {
    setPredictions(null);
    setError(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen && asset) {
      startPrediction().finally(() => {
        handleClose();
      });
    }
  }, [isOpen, asset, startPrediction, handleClose]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "text-blue-600 dark:text-blue-400";
    if (confidence >= 0.7) return "text-green-600 dark:text-green-400";
    if (confidence >= 0.6) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return "精准";
    if (confidence >= 0.7) return "平衡";
    if (confidence >= 0.6) return "宽泛";
    return "低";
  };

  const formatTagPath = (tagPath: string[]) => {
    return tagPath.join(" > ");
  };

  const getSourceDisplayName = (sourceKey: string) => {
    switch (sourceKey) {
      case "basicInfo":
        return "基本信息";
      case "materializedPath":
        return "路径结构";
      case "contentAnalysis":
        return "内容分析";
      default:
        return sourceKey;
    }
  };

  const getSourceIcon = (sourceKey: string) => {
    switch (sourceKey) {
      case "basicInfo":
        return "📝";
      case "materializedPath":
        return "📁";
      case "contentAnalysis":
        return "💬";
      default:
        return "ℹ️";
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            AI 标签预测
          </DialogTitle>
          <DialogDescription>
            {asset && (
              <>
                正在为文件 <span className="font-medium">{asset.name}</span> 进行智能标签预测
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 加载状态 */}
          {isLoading && (
            <div className="text-center py-8">
              <div className="flex items-center justify-center mb-4">
                <Sparkles className="h-8 w-8 text-primary animate-pulse" />
              </div>
              <p className="text-basic-5 mb-4">AI 正在分析文件并预测标签...</p>
              <Progress value={undefined} className="w-full" />
            </div>
          )}

          {/* 错误状态 */}
          {error && (
            <div className="text-center py-8">
              <XCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
              <p className="text-red-600 dark:text-red-400">{error}</p>
              <Button onClick={startPrediction} className="mt-4" variant="outline">
                重试
              </Button>
            </div>
          )}

          {/* 预测结果 */}
          {predictions && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">预测完成！以下是各策略的分析结果：</span>
              </div>

              <div className="space-y-6">
                {predictions.map((sourceResult) => (
                  <div key={sourceResult.source} className="space-y-3">
                    {/* 策略标题 */}
                    <div className="flex items-center gap-2 pb-2 border-b">
                      <span className="text-lg">{getSourceIcon(sourceResult.source)}</span>
                      <h3 className="font-medium text-base">
                        {getSourceDisplayName(sourceResult.source)}
                      </h3>
                      <span className="text-xs text-basic-5">
                        ({sourceResult.tags.length} 个预测)
                      </span>
                    </div>

                    {/* 策略结果 */}
                    {sourceResult.tags.length > 0 ? (
                      <div className="space-y-2">
                        {sourceResult.tags.map((prediction, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-3 bg-muted rounded-lg hover:bg-muted/80 transition-colors"
                          >
                            <div className="flex-1">
                              <div className="font-medium text-sm">
                                {formatTagPath(prediction.tagPath)}
                              </div>
                              <div className="text-xs text-basic-5 mt-1">
                                {prediction.tagPath.length}级标签 • ID: {prediction.leafTagId}
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              {/* 置信度条 */}
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-2 bg-muted-foreground/20 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      prediction.confidence >= 0.8
                                        ? "bg-blue-500"
                                        : prediction.confidence >= 0.7
                                          ? "bg-green-500"
                                          : prediction.confidence >= 0.6
                                            ? "bg-yellow-500"
                                            : "bg-red-500"
                                    }`}
                                    style={{ width: `${prediction.confidence * 100}%` }}
                                  />
                                </div>
                                <span className="text-xs text-basic-5">
                                  {Math.round(prediction.confidence * 100)}%
                                </span>
                              </div>

                              {/* 置信度标签 */}
                              <span
                                className={`text-xs px-2 py-1 rounded-full font-medium ${getConfidenceColor(
                                  prediction.confidence,
                                )} bg-current/10`}
                              >
                                {getConfidenceLabel(prediction.confidence)}
                              </span>

                              {/* 操作按钮 */}
                              <Button size="sm" variant="outline">
                                应用
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-basic-5 bg-basic-1 rounded-lg">
                        <span className="text-sm">该策略未能生成有效的标签预测</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* 底部操作 */}
              <div className="flex justify-between items-center pt-4 border-t">
                <Button variant="outline" onClick={startPrediction}>
                  重新预测
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClose}>
                    关闭
                  </Button>
                  <Button>批量应用推荐标签</Button>
                </div>
              </div>
            </div>
          )}

          {/* 空状态（预测完成但无结果） */}
          {!isLoading &&
            !error &&
            predictions &&
            predictions.every((sourceResult) => sourceResult.tags.length === 0) &&
            asset && (
              <div className="text-center py-8">
                <Bot className="h-8 w-8 text-basic-5 mx-auto mb-4" />
                <p className="text-basic-5">所有策略均未能生成有效的标签预测</p>
                <p className="text-xs text-basic-5 mt-2">可能是文件信息不足或标签体系不匹配</p>
                <Button onClick={startPrediction} className="mt-4" variant="outline">
                  重新预测
                </Button>
              </div>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
