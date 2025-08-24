"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExtractServerActionData } from "@/lib/serverAction";
import {
  AssetObject,
  AssetObjectContentAnalysis,
  AssetObjectExtra,
  AssetObjectTags,
} from "@/prisma/client";
import { Bot, Calendar, File, Folder, Tag as TagIcon } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";
import { fetchSampleAssetsAction, fetchTeamAssets } from "./actions";
import TagPredictionDialog from "./TagPredictionDialog";

interface AssetsClientProps {
  initialAssets: ExtractServerActionData<typeof fetchTeamAssets>["assets"];
}

export default function AssetsClient({ initialAssets }: AssetsClientProps) {
  const [assets, setAssets] = useState<AssetObject[]>(initialAssets);
  const [selectedAsset, setSelectedAsset] = useState<AssetObject | null>(null);
  const [isPredictionDialogOpen, setIsPredictionDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const refreshAssets = async () => {
    const result = await fetchTeamAssets();
    if (result.success) {
      setAssets(result.data.assets);
    }
  };

  const getThumbnailUrl = (asset: AssetObject) => {
    const extra = asset.extra as AssetObjectExtra | null;
    return extra?.thumbnailAccessUrl;
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date));
  };

  const handleAIPrediction = (asset: AssetObject) => {
    setSelectedAsset(asset);
    setIsPredictionDialogOpen(true);
  };

  const handleClosePredictionDialog = () => {
    setIsPredictionDialogOpen(false);
    setSelectedAsset(null);
  };

  const fetchSampleAssets = useCallback(async () => {
    setIsLoading(true);
    try {
      await fetchSampleAssetsAction();
    } catch (error) {
      console.error("Failed to fetch sample assets:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* 标题和操作栏 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">资产管理</h1>
          <p className="text-muted-foreground">查看和管理团队的资产文件</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchSampleAssets} variant="outline" disabled={isLoading}>
            {isLoading ? "正在导入..." : "导入素材"}
          </Button>
          <Button onClick={refreshAssets} variant="outline">
            刷新
          </Button>
          <Button>上传资产</Button>
        </div>
      </div>

      {/* 资产列表 */}
      <div className="space-y-4">
        {assets.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center text-muted-foreground">
                <File className="h-12 w-12 mx-auto mb-4" />
                <p>暂无资产文件</p>
                <Button className="mt-4">上传第一个资产</Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          assets.map((asset) => (
            <Card key={asset.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  {/* 文件缩略图 */}
                  <div className="shrink-0 w-24 h-24 relative">
                    {getThumbnailUrl(asset) ? (
                      <Image
                        src={getThumbnailUrl(asset)!}
                        alt={asset.name}
                        fill
                        sizes="100px" // 这个是图片 optimize 的尺寸，不是前端显示的尺寸
                        className="object-cover rounded-sm"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <File className="h-6 w-6" />
                      </div>
                    )}
                  </div>

                  {/* 主要信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* 文件名 */}
                        <h3 className="font-semibold text-lg truncate" title={asset.name}>
                          {asset.name}
                        </h3>

                        {/* 路径 */}
                        <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                          <Folder className="h-4 w-4" />
                          <span className="truncate" title={asset.materializedPath}>
                            {asset.materializedPath}
                          </span>
                        </div>

                        {/* 描述 */}
                        {asset.description && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                            描述: {asset.description}
                          </p>
                        )}

                        {/* 标签 */}
                        {(asset.tags as AssetObjectTags).length > 0 && (
                          <div className="flex items-center gap-2 mt-3">
                            <TagIcon className="h-4 w-4 text-muted-foreground" />
                            <div className="flex flex-wrap gap-1">
                              {(asset.tags as AssetObjectTags).map((tag, index) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-primary/10 text-primary"
                                >
                                  {tag.tagPath.join(" > ")}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* 内容分析 */}
                        {asset.content && (
                          <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                            AI 解析: {(asset.content as AssetObjectContentAnalysis).aiDescription}
                          </p>
                        )}
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex gap-2 ml-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleAIPrediction(asset)}
                          className="flex items-center gap-1"
                        >
                          <Bot className="h-3 w-3" />
                          AI预测
                        </Button>
                        <Button variant="outline" size="sm">
                          编辑
                        </Button>
                        <Button variant="outline" size="sm">
                          下载
                        </Button>
                      </div>
                    </div>

                    {/* 底部信息 */}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>创建于 {formatDate(asset.createdAt)}</span>
                        </div>
                        <div className="hidden sm:block">
                          <span>ID: {asset.slug}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* AI标签预测Dialog */}
      <TagPredictionDialog
        asset={selectedAsset}
        isOpen={isPredictionDialogOpen}
        onClose={handleClosePredictionDialog}
      />
    </div>
  );
}
