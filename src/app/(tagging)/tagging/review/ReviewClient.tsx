"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExtractServerActionData } from "@/lib/serverAction";
import {
  Calendar,
  CheckCircle,
  File,
  Folder,
  RefreshCw,
  Search,
  Tag as TagIcon,
  XCircle,
} from "lucide-react";
import { useCallback, useState } from "react";
import {
  AssetWithAuditItems,
  fetchAssetsWithAuditItems,
  fetchReviewStats,
  ReviewStats,
} from "./actions";

type TaggingAuditStatus = "pending" | "approved" | "rejected";

interface ReviewClientProps {
  initialStats: ExtractServerActionData<typeof fetchReviewStats>["stats"];
  initialAssets: ExtractServerActionData<typeof fetchAssetsWithAuditItems>["assets"];
}

export default function ReviewClient({ initialStats, initialAssets }: ReviewClientProps) {
  const [stats, setStats] = useState<ReviewStats>(initialStats);
  const [assets, setAssets] = useState<AssetWithAuditItems[]>(initialAssets);
  const [isLoading, setIsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TaggingAuditStatus | "all">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "medium" | "low">(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");

  const refreshData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsResult, assetsResult] = await Promise.all([
        fetchReviewStats(),
        fetchAssetsWithAuditItems(
          1,
          20,
          statusFilter === "all" ? undefined : statusFilter,
          confidenceFilter === "all" ? undefined : confidenceFilter,
          searchQuery || undefined,
        ),
      ]);

      if (statsResult.success) {
        setStats(statsResult.data.stats);
      }
      if (assetsResult.success) {
        setAssets(assetsResult.data.assets);
      }
    } catch (error) {
      console.error("刷新数据失败:", error);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, confidenceFilter, searchQuery]);

  const handleFilterChange = useCallback(() => {
    refreshData();
  }, [refreshData]);

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

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "text-blue-600 dark:text-blue-400";
    if (confidence >= 0.6) return "text-green-600 dark:text-green-400";
    return "text-orange-600 dark:text-orange-400";
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return "精准";
    if (confidence >= 0.6) return "平衡";
    return "宽泛";
  };

  const getStatusColor = (status: TaggingAuditStatus) => {
    switch (status) {
      case "pending":
        return "text-orange-600 dark:text-orange-400";
      case "approved":
        return "text-green-600 dark:text-green-400";
      case "rejected":
        return "text-red-600 dark:text-red-400";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  const getStatusText = (status: TaggingAuditStatus) => {
    switch (status) {
      case "pending":
        return "待审核";
      case "approved":
        return "已采纳";
      case "rejected":
        return "已调整";
      default:
        return "未知状态";
    }
  };

  const buildTagPath = (auditItem: AssetWithAuditItems["TaggingAuditItem"][0]) => {
    const path: string[] = [];
    const currentTag = auditItem.leafTag;

    // 从叶子节点向上构建路径
    path.unshift(currentTag.name);

    if (currentTag.parent) {
      path.unshift(currentTag.parent.name);
      if (currentTag.parent.parent) {
        path.unshift(currentTag.parent.parent.name);
      }
    }

    return path;
  };

  const formatTagPath = (tagPath: string[]) => {
    return tagPath.join(" > ");
  };

  return (
    <div className="space-y-6">
      {/* 标题和刷新按钮 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">AI打标审核</h1>
          <p className="text-muted-foreground">审核AI自动打标的结果</p>
        </div>
        <Button onClick={refreshData} disabled={isLoading} variant="outline" size="sm">
          {isLoading ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {isLoading ? "刷新中..." : "刷新"}
        </Button>
      </div>

      {/* 筛选器和搜索 */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex gap-2">
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value as TaggingAuditStatus | "all");
              setTimeout(handleFilterChange, 100);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="pending">待审核</SelectItem>
              <SelectItem value="approved">已采纳</SelectItem>
              <SelectItem value="rejected">已调整</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={confidenceFilter}
            onValueChange={(value) => {
              setConfidenceFilter(value as "all" | "high" | "medium" | "low");
              setTimeout(handleFilterChange, 100);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="全部置信度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部置信度</SelectItem>
              <SelectItem value="high">精准 (≥80%)</SelectItem>
              <SelectItem value="medium">平衡 (60-79%)</SelectItem>
              <SelectItem value="low">宽泛 (&lt;60%)</SelectItem>
            </SelectContent>
          </Select>

          <Select disabled>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="打标发起时间" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部时间</SelectItem>
              <SelectItem value="today">今天</SelectItem>
              <SelectItem value="week">本周</SelectItem>
              <SelectItem value="month">本月</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索名称或标签"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleFilterChange();
              }
            }}
            className="pl-10"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左侧状态统计 */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">全部 {stats.total} 项</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                  <span className="text-sm">待审核</span>
                </div>
                <span className="font-semibold">{stats.pending.toLocaleString()}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm">已采纳</span>
                </div>
                <span className="font-semibold">{stats.approved}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                  <span className="text-sm">已调整</span>
                </div>
                <span className="font-semibold">{stats.rejected}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                  <span className="text-sm">未匹配</span>
                </div>
                <span className="font-semibold">0</span>
              </div>

              <div className="pt-2 border-t text-xs text-muted-foreground">基于标签体系匹配</div>
            </CardContent>
          </Card>
        </div>

        {/* 右侧主要内容 */}
        <div className="lg:col-span-3 space-y-4">
          {assets.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-muted-foreground">
                <File className="h-12 w-12 mx-auto mb-4" />
                <p>暂无待审核的资产</p>
              </CardContent>
            </Card>
          ) : (
            assets.map((asset) => (
              <Card key={asset.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  {/* 资产基本信息 */}
                  <div className="flex items-start gap-4 mb-4">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 flex items-center justify-center bg-muted rounded-lg text-2xl">
                        {getFileIcon(asset.name)}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-lg truncate" title={asset.name}>
                        {asset.name}
                      </h3>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                        <Folder className="h-4 w-4" />
                        <span className="truncate" title={asset.materializedPath}>
                          {asset.materializedPath}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                        <Calendar className="h-4 w-4" />
                        <span>{formatDate(asset.createdAt)}</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        添加
                      </Button>
                      <Button variant="outline" size="sm">
                        置盖
                      </Button>
                      <Button variant="outline" size="sm">
                        拒绝
                      </Button>
                    </div>
                  </div>

                  {/* 标签信息 */}
                  <div className="space-y-3">
                    {/* 现有标签 */}
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <TagIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">标签</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {/* TODO: 显示现有标签，暂时显示占位符 */}
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800">
                          现有标签
                        </span>
                      </div>
                    </div>

                    {/* AI推荐标签 */}
                    {asset.TaggingAuditItem.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="flex items-center gap-1">
                            <div className="w-4 h-4 bg-gradient-to-r from-blue-500 to-purple-500 rounded"></div>
                            <span className="text-sm font-medium">AI 推荐标签</span>
                          </div>
                          <span className="text-xs text-muted-foreground">基于标签体系匹配</span>
                        </div>

                        <div className="space-y-2">
                          {asset.TaggingAuditItem.map((auditItem) => {
                            const tagPath = buildTagPath(auditItem);
                            return (
                              <div
                                key={auditItem.id}
                                className="flex items-center justify-between p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
                              >
                                <div className="flex-1">
                                  <div className="font-medium text-sm">
                                    {formatTagPath(tagPath)}
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1">
                                    {tagPath.length}级标签 • ID: {auditItem.leafTagId}
                                  </div>
                                </div>

                                <div className="flex items-center gap-3">
                                  {/* 置信度条 */}
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 h-2 bg-muted-foreground/20 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          auditItem.confidence >= 0.8
                                            ? "bg-blue-500"
                                            : auditItem.confidence >= 0.6
                                              ? "bg-green-500"
                                              : "bg-orange-500"
                                        }`}
                                        style={{ width: `${auditItem.confidence * 100}%` }}
                                      />
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                      {Math.round(auditItem.confidence * 100)}%
                                    </span>
                                  </div>

                                  {/* 置信度标签 */}
                                  <span
                                    className={`text-xs px-2 py-1 rounded-full font-medium ${getConfidenceColor(
                                      auditItem.confidence,
                                    )} bg-current/10`}
                                  >
                                    {getConfidenceLabel(auditItem.confidence)}
                                  </span>

                                  {/* 状态 */}
                                  <span
                                    className={`text-xs font-medium ${getStatusColor(auditItem.status)}`}
                                  >
                                    {getStatusText(auditItem.status)}
                                  </span>

                                  {/* 操作按钮 */}
                                  {auditItem.status === "pending" && (
                                    <div className="flex gap-1">
                                      <Button size="sm" variant="outline" className="h-7 px-2">
                                        <CheckCircle className="h-3 w-3" />
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-7 px-2">
                                        <XCircle className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
