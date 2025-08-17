"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExtractServerActionData } from "@/lib/serverAction";
import { AssetObject } from "@/prisma/client";
import { Calendar, File, Folder, Tag as TagIcon } from "lucide-react";
import { useState } from "react";
import { fetchTeamAssets } from "./actions";

interface AssetsClientProps {
  initialAssets: ExtractServerActionData<typeof fetchTeamAssets>["assets"];
}

export default function AssetsClient({ initialAssets }: AssetsClientProps) {
  const [assets, setAssets] = useState<AssetObject[]>(initialAssets);

  const refreshAssets = async () => {
    const result = await fetchTeamAssets();
    if (result.success) {
      setAssets(result.data.assets);
    }
  };

  const getFileIcon = (fileName: string) => {
    const extension = fileName.split(".").pop()?.toLowerCase();
    switch (extension) {
      case "jpg":
      case "jpeg":
      case "png":
      case "gif":
      case "webp":
        return "🖼️";
      case "mp4":
      case "mov":
      case "avi":
        return "🎬";
      case "pdf":
        return "📄";
      case "doc":
      case "docx":
        return "📝";
      case "xls":
      case "xlsx":
        return "📊";
      case "ppt":
      case "pptx":
        return "📑";
      case "psd":
        return "🎨";
      case "ai":
        return "✏️";
      default:
        return "📁";
    }
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

  const parseTags = (tags: any): string[] => {
    if (typeof tags === "string") {
      try {
        return JSON.parse(tags);
      } catch {
        return [];
      }
    }
    return Array.isArray(tags) ? tags : [];
  };

  return (
    <div className="space-y-6">
      {/* 标题和操作栏 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">资产管理</h1>
          <p className="text-muted-foreground">查看和管理团队的资产文件</p>
        </div>
        <div className="flex gap-2">
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
          assets.map((asset) => {
            const assetTags = parseTags(asset.tags);

            return (
              <Card key={asset.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    {/* 文件图标 */}
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 flex items-center justify-center bg-muted rounded-lg text-2xl">
                        {getFileIcon(asset.name)}
                      </div>
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
                              {asset.description}
                            </p>
                          )}

                          {/* 标签 */}
                          {assetTags.length > 0 && (
                            <div className="flex items-center gap-2 mt-3">
                              <TagIcon className="h-4 w-4 text-muted-foreground" />
                              <div className="flex flex-wrap gap-1">
                                {assetTags.map((tag, index) => (
                                  <span
                                    key={index}
                                    className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-primary/10 text-primary"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex gap-2 ml-4">
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

                        {/* 标签数量提示 */}
                        {assetTags.length === 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-orange-600 hover:text-orange-700"
                          >
                            添加标签
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* 统计信息 */}
      {assets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>显示统计</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {assets.length}
                </div>
                <div className="text-sm text-muted-foreground">显示资产</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {assets.filter((asset) => parseTags(asset.tags).length > 0).length}
                </div>
                <div className="text-sm text-muted-foreground">已标记</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                  {assets.filter((asset) => parseTags(asset.tags).length === 0).length}
                </div>
                <div className="text-sm text-muted-foreground">未标记</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                  {assets.filter((asset) => asset.description.trim() === "").length}
                </div>
                <div className="text-sm text-muted-foreground">无描述</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
